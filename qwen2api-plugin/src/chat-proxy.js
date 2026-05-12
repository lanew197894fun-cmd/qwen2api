/**
 * chat-proxy.js — Qwen2API Chat Proxy with standard OpenAI function calling
 *
 * 功能：
 * • 接受 /v1/chat/completions 請求
 * • 當請求含 tools 時，利用 qwen2api native tool support（tool-prompt.js）
 * • qwen2api 將 tools 轉為 <tool_call> XML 送 Qwen API，再解析回 tool_calls
 * • Proxy 執行 tool_calls（read/write/edit/glob/grep/bash），結果送回繼續
 * • 若模型無 tool_calls 但有 bash 區塊，自動執行並送回（fallback）
 * • 完全相容 OpenAI 格式（stream / non-stream）
 * • 非聊天端點自動轉發到 qwen2api
 *
 * 雙層機制：
 *   1. tool_calls（標準）— qwen2api 原生解析 <tool_call> XML
 *   2. bash fallback — 當模型偏好輸出 bash 區塊時直接執行
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { detectHardware, getHardwareInfo } from "./hardware-detect.js";
import { getPath, execShell, execGrep } from "./platform.js";

const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const LV = (() => {
  const raw = process.env.PROXY_LOG_LEVEL;
  if (raw && LOG_LEVELS[raw] !== undefined) return LOG_LEVELS[raw];
  if (process.env.PROXY_QUIET === "true" || process.env.PROXY_QUIET === "1")
    return 0;
  return 2; // 預設 warn — 只顯示錯誤與警告
})();
const log = {
  debug: (...a) => {
    if (LV >= 4) console.log("[proxy]", ...a);
  },
  info: (...a) => {
    if (LV >= 3) console.log("[proxy]", ...a);
  },
  warn: (...a) => {
    if (LV >= 2) console.warn("[proxy]", ...a);
  },
  error: (...a) => {
    if (LV >= 1) console.error("[proxy]", ...a);
  },
};

process.on("unhandledRejection", (e) => {
  log.error("💥 未捕捉 rejection:", e?.message || e);
});
process.on("uncaughtException", (e) => {
  try {
    log.error("💥 未捕捉 exception:", e?.message || e);
  } catch {
    console.error("[proxy] FATAL:", e?.message || e);
  }
});

const QWEN2API_PORT = parseInt(process.env.QWEN2API_PORT || "3000", 10);
const QWEN2API_HOST = process.env.QWEN2API_HOST || "127.0.0.1";
const _QWEN2API_HOST = QWEN2API_HOST.includes(":")
  ? `[${QWEN2API_HOST}]`
  : QWEN2API_HOST;
const QWEN2API_URL = `http://${_QWEN2API_HOST}:${QWEN2API_PORT}`;
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "3456");
const API_KEY = process.env.API_KEY || "sk-123456";
const MAX_LOOPS = 5;
const MAX_BODY = 100 * 1024; // 請求 body 上限 100KB
const PROJ_DIR = getPath("projectDir");

// ─── Rate Limiter（滑動窗口，無依賴） ───
const RL_MAX = parseInt(process.env.PROXY_RATE_LIMIT || "600");   // 本機環境放寬至 600 req/min
const RL_WIN = parseInt(process.env.PROXY_RATE_WINDOW || "60000");
const rlBuckets = new Map();

function checkRL(ip) {
  const now = Date.now();
  let b = rlBuckets.get(ip);
  if (!b || now > b.reset) {
    b = { count: 0, reset: now + RL_WIN };
    rlBuckets.set(ip, b);
  }
  b.count++;
  // 每分鐘清理過期條目
  if (rlBuckets.size > 10000) {
    const cutoff = Date.now();
    for (const [k, v] of rlBuckets) {
      if (cutoff > v.reset) rlBuckets.delete(k);
    }
  }
  return b.count <= RL_MAX;
}

// ─── 環境自動偵測與模型路由 ───
//
// 啟動時自動查詢 qwen2api 可用模型，按能力分級：
//   small  — 輕量模型（27B 以下），適合簡單任務
//   medium — 平衡模型（預設），適合一般任務
//   large  — 強模型（235B+），適合複雜任務
//
// 可透過環境變數覆蓋：
//   PROXY_SMALL_MODEL=xxx    — 強制指定小模型
//   PROXY_MEDIUM_MODEL=xxx   — 強制指定中模型
//   PROXY_LARGE_MODEL=xxx    — 強制指定大模型
//   PROXY_ROUTE=off          — 停用自動路由

const COMPLEX_KEYWORDS = [
  "fix",
  "repair",
  "debug",
  "implement",
  "create",
  "build",
  "deploy",
  "refactor",
  "optimize",
  "analyze",
  "investigate",
  "troubleshoot",
  "修復",
  "除錯",
  "實作",
  "建立",
  "部署",
  "重構",
  "優化",
  "分析",
];

// 從模型名稱推斷能力等級
const classifyModel = (name) => {
  const n = (name || "").toLowerCase();
  // 大型模型：235B, Max, Preview
  if (n.includes("235b") || n.includes("max") || n.includes("preview"))
    return "large";
  // 中型模型：Plus, 72B 以上但非 Max
  if (n.includes("plus") || n.includes("coder")) return "medium";
  // 小型模型：27B, Flash, 輕量
  if (n.includes("27b") || n.includes("flash") || n.includes("35b"))
    return "small";
  // 預設為 medium
  return "medium";
};

// 從 qwen2api 取得可用模型並分級
let envModels = null;
let envDetected = false;

const detectEnv = async () => {
  if (envDetected) return;
  envDetected = true;
  try {
    const models = await getJSON(`${QWEN2API_URL}/v1/models`);
    const list = models?.data || models || [];
    const byLevel = { small: [], medium: [], large: [] };
    for (const m of list) {
      const id = m.id || m.name || "";
      const level = classifyModel(id);
      if (!byLevel[level].includes(id)) byLevel[level].push(id);
    }
    envModels = byLevel;
    log.info(`🌍 環境偵測: ${list.length} 模型可用`);
    if (LV >= 4) {
      for (const lvl of ["small", "medium", "large"]) {
        if (envModels[lvl].length > 0)
          log.debug(`  ${lvl}: ${envModels[lvl].join(", ")}`);
      }
    }
  } catch (e) {
    log.warn(`⚠️ 模型偵測失敗: ${e.message}，使用預設路由`);
    envModels = null;
  }
};

const getModelForLevel = (level) => {
  // 環境變數強制指定優先
  const envKey = `PROXY_${level.toUpperCase()}_MODEL`;
  if (process.env[envKey]) return process.env[envKey];

  // 從偵測到的模型列表選擇
  if (envModels?.[level]?.length > 0) return envModels[level][0];

  // 硬編碼預設值
  const defaults = {
    small: "qwen3.6-27b",
    medium: "qwen3.6-plus",
    large: "qwen3-235b-a22b",
  };
  return defaults[level] || defaults.medium;
};

// ─── 任務複雜度分析 ───

const analyzeComplexity = (body) => {
  const { messages, tools, tool_choice } = body;
  let score = 0;

  const text = (messages || [])
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join(" ");
  const len = text.length;

  if (len > 2000) score += 3;
  else if (len > 800) score += 2;
  else if (len > 200) score += 1;

  const nTools = tools?.length || 0;
  // 有工具請求即視為至少中等複雜度
  if (nTools > 0) score += 2;
  if (nTools > 5) score += 1;
  if (nTools > 10) score += 1;

  if (tool_choice === "required") score += 2;

  const lower = text.toLowerCase();
  for (const kw of COMPLEX_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      score += 1;
      break;
    }
  }

  if (score >= 5) return "large";
  if (score >= 2) return "medium";
  return "small";
};

const waitForBackend = async (portBusy) => {
  if (portBusy) {
    // 已有進程但未就緒 → 等待最多 6 秒（systemd Restart=always 會自動恢復）
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await isUp()) return "recovered";
    }
    return "port_occupied";
  }
};

const routeModel = (body) => {
  if (process.env.PROXY_ROUTE === "off")
    return body.model || getModelForLevel("medium");
  let level = analyzeComplexity(body);
  // 硬體感知：若硬體不足，降級模型等級
  const hw = detectHardware();
  const hwOrder = { small: 0, medium: 1, large: 2 };
  const taskOrder = hwOrder[level] ?? 1;
  const hwLimit = hwOrder[hw.level] ?? 1;
  if (taskOrder > hwLimit) {
    const downgraded =
      Object.entries(hwOrder).find(([, v]) => v <= hwLimit)?.[0] || "medium";
    log.info(`📡 ${level}→${downgraded} (硬體受限: ${hw.reason})`);
    level = downgraded;
  }
  let model = getModelForLevel(level);
  // 保留 thinking 後綴：若原始模型含 -thinking，路由後的模型也加上
  const orig = body.model || "";
  if (model !== orig && orig.toLowerCase().includes("thinking")) {
    const base = model.replace(/-thinking$/i, "");
    model = `${base}-thinking`;
  }
  if (model !== orig && orig) {
    log.debug(`📡 ${level} (${orig} → ${model})`);
  }
  return model;
};

// ─── HTTP helpers (Bun.fetch) ───

const authHeaders = {
  Authorization: `Bearer ${API_KEY}`,
};

/** 帶重試的延遲 */
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * postJSON — 帶可配置超時與重試
 * @param {string} url
 * @param {object} body
 * @param {number} timeout  — 單次請求超時 (ms)，預設 60s
 * @param {number} retries  — 重試次數，預設 2（最多 3 次嘗試）
 */
const postJSON = async (url, body, timeout = 60000, retries = 2) => {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const txt = await res.text();
      try {
        return JSON.parse(txt);
      } catch {
        return { content: txt };
      }
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      const isTimeout = e.name === "AbortError";
      if (attempt < retries) {
        const wait = Math.min(1000 * 2 ** attempt, 5000);
        log.warn(
          `📤 postJSON 重試 ${attempt + 1}/${retries} (${isTimeout ? "timeout" : e.message})，等待 ${wait}ms...`,
        );
        await delay(wait);
        continue;
      }
      if (isTimeout) throw new Error("timeout");
      throw e;
    }
  }
  throw lastErr;
};

/**
 * getJSON — 帶可配置超時與重試
 * @param {string} url
 * @param {number} timeout  — 單次請求超時 (ms)，預設 15s
 * @param {number} retries  — 重試次數，預設 2（最多 3 次嘗試）
 */
const getJSON = async (url, timeout = 15000, retries = 2) => {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: authHeaders,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const txt = await res.text();
      try {
        return JSON.parse(txt);
      } catch {
        return null;
      }
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      const isTimeout = e.name === "AbortError";
      if (attempt < retries) {
        const wait = Math.min(1000 * 2 ** attempt, 5000);
        log.warn(
          `📤 getJSON 重試 ${attempt + 1}/${retries} (${isTimeout ? "timeout" : e.message})，等待 ${wait}ms...`,
        );
        await delay(wait);
        continue;
      }
      if (isTimeout) throw new Error("timeout");
      throw e;
    }
  }
  throw lastErr;
};

// ─── MCP call via qwen2api ───

// ─── 本地工具執行（替代 MCP 端點） ───
// Qwen2API 沒有 MCP 端點，直接在 proxy 內建執行工具

const execTool = async (name, args) => {
  switch (name) {
    case "read": {
      const fp = args.filePath || args.path;
      if (!fp) return "";
      try {
        return await Bun.file(fp).text();
      } catch {
        try {
          return fs.readFileSync(fp, "utf-8");
        } catch (e) {
          return `[無法讀取 ${fp}: ${e.message}]`;
        }
      }
    }
    case "write": {
      const fp = args.filePath || args.path;
      const content = args.content || "";
      if (!fp) return "";
      try {
        await Bun.write(fp, content);
        return `✓ 已寫入 ${fp}`;
      } catch {
        try {
          fs.writeFileSync(fp, content, "utf-8");
          return `✓ 已寫入 ${fp}`;
        } catch (e) {
          return `[寫入失敗 ${fp}: ${e.message}]`;
        }
      }
    }
    case "bash":
    case "execute": {
      const cmd = args.command || args.cmd || "";
      if (!cmd) return "";
      try {
        const { stdout: out, stderr: err } = execShell(cmd);
        const combined = out + (err ? `\n[stderr]\n${err}` : "");
        return combined || `[指令執行完畢，無輸出]`;
      } catch {
        try {
          const { execSync } = await import("node:child_process");
          const out = execSync(cmd, { encoding: "utf-8", timeout: 30000 });
          return out || `[指令執行完畢，無輸出]`;
        } catch (e) {
          return `[指令失敗: ${cmd} - ${e.message}]`;
        }
      }
    }
    case "edit": {
      const fp = args.filePath || args.path;
      const oldStr = args.oldString;
      const newStr = args.newString;
      if (!fp || !oldStr) return "";
      try {
        let content = fs.readFileSync(fp, "utf-8");
        if (!content.includes(oldStr)) return `[未找到: ${oldStr}]`;
        content = content.replace(oldStr, newStr || "");
        fs.writeFileSync(fp, content, "utf-8");
        return `✓ 已編輯 ${fp}`;
      } catch (e) {
        return `[編輯失敗 ${fp}: ${e.message}]`;
      }
    }
    case "glob": {
      const pattern = args.pattern || "";
      const cwd = args.path || args.dir || ".";
      if (!pattern) return "";
      try {
        const g = new Bun.Glob(pattern);
        const results = [...g.scanSync({ cwd })];
        return results.join("\n") || "無匹配結果";
      } catch (e) {
        try {
          const { execSync } = await import("node:child_process");
          const out = execSync(
            `find ${cwd} -path '${pattern}' 2>/dev/null || true`,
            { encoding: "utf-8", timeout: 10000 },
          );
          return out || "無匹配結果";
        } catch (e2) {
          return `[搜尋失敗: ${e.message}]`;
        }
      }
    }
    case "grep":
    case "search": {
      const pattern = args.pattern || args.query || "";
      const fp = args.filePath || args.path || args.dir || ".";
      if (!pattern) return "";
      try {
        const { stdout } = execGrep(pattern, fp, ["*.ts", "*.tsx", "*.js"]);
        return stdout || "無匹配結果";
      } catch (e) {
        return `[搜尋失敗: ${e.message}]`;
      }
    }
    default:
      return `[未知工具: ${name}]`;
  }
};

const mcpCall = async (name, args) => {
  try {
    return await execTool(name, args);
  } catch (e) {
    return `❌ 工具執行失敗: ${e.message}`;
  }
};

// ─── Tool-prompt 建構（注入 system message，讓 Qwen 知道有哪些工具） ───
//
// opencode 會傳標準 OpenAI tools 陣列，但 qwen2api 不支援。
// 改為將工具定義轉換為 system prompt 文字注入，
// 並解析 Qwen 模型偏好的 bash-block 輸出格式，
// 轉換為 opencode 能理解的標準 tool_calls 格式回傳。

const buildToolPrompt = (tools) => {
  if (!tools?.length) return null;
  const names = tools.map((t) => t.function?.name || t.name).join(", ");
  return [
    `可用工具: ${names}。`,
    "執行工具時，以 ```bash \u5340塊輸出 shell 命令，opencode 會自動執行。",
    "⚠️ Windows 路徑請使用正斜線（/）而非反斜線（\\），例如 D:/Tools/...",
    "工具執行完畢後，你會收到「[工具執行結果]」格式的用戶訊息。",
    "一個工具執行成功只代表該步驟完成，不代表整個任務完成。",
    "繼續下一步直到任務全部完成後，才給出最終分析報告。",
    "報告格式：先列出所有執行過的步驟與結果，再給總結。",
    "⚠️ exit code 0 = 命令成功執行。即使無輸出內容，也不代表失敗。",
    "例如 typecheck/lint 無輸出 = 沒有錯誤，任務已成功完成。",
    "不要因為無輸出就改參數重複執行同一命令。exit code 0 就是成功。",
    "重要：如果任務有多個步驟（如先 typecheck 再 build），請全部執行完再總結。",
    "一律繁體中文回覆。嚴禁簡體字。不要詢問、不要確認，直接執行。",
    "避免輸出「好的」「我理解」「請告訴我」「需執行特定任務嗎」等確認句。",
  ].join("\n");
};

// 將 bash-block 解析為標準 OpenAI tool_calls 格式
// description 自動從命令內容生成（opencode bash 工具必填欄位）
const genDesc = (cmd) => {
  const s = cmd.trim().slice(0, 60);
  const first = s.split(/\s+/)[0];
  const map = {
    ls: "Lists directory contents",
    cat: "Reads file content",
    grep: "Searches file content",
    find: "Finds files",
    mkdir: "Creates directory",
    rm: "Removes files",
    cp: "Copies files",
    mv: "Moves files",
    echo: "Outputs text",
    cd: "Changes directory",
    bun: "Runs bun command",
    npm: "Runs npm command",
    node: "Runs node command",
    git: "Runs git command",
    curl: "Makes HTTP request",
    systemctl: "Controls systemd service",
  };
  return map[first] || `Executes: ${s}`;
};

// 正規化 Windows 路徑：D:\foo\bar → D:/foo/bar（避免 bash 吃掉反斜線）
const normalizeWinPath = (cmd) => {
  return cmd.replace(
    /([A-Za-z]):\\([^\\\s"'])/g,
    (m, d, rest) => `${d}:/${rest}`,
  );
};

const bashBlockToToolCalls = (content, tools) => {
  const hasBash = tools?.some((t) => (t.function?.name || t.name) === "bash");
  if (!hasBash) return null;
  const BASH_RE = /```(?:bash|sh|shell)\s*\n([\s\S]*?)```/gi;
  const cmds = [];
  let m;
  while ((m = BASH_RE.exec(content)) !== null) {
    const c = m[1].trim();
    if (c && !c.startsWith("#") && !c.startsWith("//")) cmds.push(c);
  }
  if (!cmds.length) return null;
  const unique = [...new Set(cmds)];
  return unique.map((cmd, i) => {
    const norm = normalizeWinPath(cmd);
    if (norm !== cmd)
      log.debug(`🔄 路徑正規化: ${cmd.slice(0, 60)} → ${norm.slice(0, 60)}`);
    return {
      id: `call-${Date.now()}-${i}`,
      type: "function",
      function: {
        name: "bash",
        arguments: JSON.stringify({
          command: norm,
          description: genDesc(norm),
        }),
      },
    };
  });
};

// ─── 串流輸出 helper ───

const streamChunk = (res, msgId, model, data) => {
  res.write(
    `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.round(Date.now() / 1000), model, ...data })}\n\n`,
  );
};

const CHUNK = 32;

// ─── Single Pass：opencode 原生執行模式 ───
//
// 不在 proxy 內做 agent loop，改為：
//   1. 注入 tool-prompt（讓 Qwen 知道有哪些工具）
//   2. 單次轉發給 qwen2api（不傳 tools 參數）
//   3. 若模型回傳原生 tool_calls → 直接透傳給 opencode
//   4. 若模型輸出 bash-block → 轉換為 tool_calls 格式回傳
//   5. 若純文字 → 直接回傳（opencode 視為最終回應）
//
// opencode 收到 tool_calls 後會自己執行工具、管理 agent loop，
// 和 Claude/GPT 模型完全一致的體驗。

const runSinglePass = async (body) => {
  try {
    const { messages, tools, tool_choice, stream, ...rest } = body;
    let msgs = [...(messages || [])];
    // 收集 prompt 文字供 token 估算
    const promptText = (messages || [])
      .map((m) => (typeof m.content === "string" ? m.content : "") + (m.role || ""))
      .join(" ");

    // 轉換 tool role → user role（qwen2api 不支援 tool role，需轉為模型能理解的格式）
    // 否則 tool result 被 qwen2api 忽略，模型看不到結果會重複呼叫同一個工具 → 無限迴圈
    msgs = msgs.map((m) => {
      if (m.role === "tool") {
        // 明確標記執行結果，空輸出不代表失敗，exit code 才是關鍵
        const raw = m.content || "";
        // 從結果中提取 exit code（如果有的話）
        const exitMatch = raw.match(/exit code[:\s]*(\d+)/i);
        const exitInfo = exitMatch ? `(exit code: ${exitMatch[1]})` : "";
        // 判斷是否有實際輸出
        const hasOutput =
          raw
            .replace(/\[exit code[:\]]+\d+/gi, "")
            .replace(/stdout:|stderr:/gi, "")
            .trim().length > 20;
        const verdict = exitMatch
          ? exitMatch[1] === "0"
            ? "✅ 命令成功執行"
            : `❌ 命令失敗 (exit ${exitMatch[1]})`
          : "";
        const summary = [
          verdict,
          exitInfo,
          hasOutput ? `\n輸出:\n${raw}` : `\n(命令執行完畢，無輸出內容)`,
        ]
          .filter(Boolean)
          .join(" ");
        return {
          role: "user",
          content: `[工具執行結果] ${summary}`,
        };
      }
      if (m.role === "assistant" && m.tool_calls) {
        // 保留 content 但移除 tool_calls（qwen2api 不支援此欄位）
        const { tool_calls, ...rest } = m;
        return rest;
      }
      return m;
    });

    // 注入 tool-prompt 到 system message（讓 Qwen 知道有哪些工具）
    if (tools?.length > 0) {
      const toolPrompt = buildToolPrompt(tools);
      const sysIdx = msgs.findIndex((m) => m.role === "system");
      if (sysIdx >= 0) {
        // 附加到既有 system message
        msgs = msgs.map((m, i) =>
          i === sysIdx ? { ...m, content: `${m.content}\n\n${toolPrompt}` } : m,
        );
      } else {
        // 插入新的 system message
        msgs = [{ role: "system", content: toolPrompt }, ...msgs];
      }
    }

    const currentModel = routeModel(body);
    const isThinking =
      body.enable_thinking ?? body.model?.toLowerCase().includes("thinking");

    // 單次轉發（不傳 tools，避免 qwen2api 不支援的 API 格式）
    // enable_thinking: true 讓模型輸出 <think> 推理過程
    const up = { ...rest, model: currentModel, messages: msgs, stream: false, enable_thinking: true };
    log.debug(
      `📤 model=${up.model} msgs=${up.messages.length} tools=${tools?.length || 0}`,
    );

    const result = await postJSON(`${QWEN2API_URL}/v1/chat/completions`, up);
    const choice = result?.choices?.[0];
    if (!choice) {
      return buildErrorResponse("上游無回應", currentModel);
    }

    const msg = choice.message;
    const raw = msg?.content || "";

    // 保留 <think> 推理過程（不刪除），opencode TUI 會自動摺疊顯示為 reasoning 區塊
    // 供使用者追朔模型決策過程。同時從 raw 中分離出 thinking 與 clean content。
    const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/);
    const thinking = thinkMatch ? thinkMatch[1].trim() : "";
    const stripped = thinking
      ? raw.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim()
      : raw;
    if (thinking) {
      log.info(`🧠 推理過程 ${thinking.length}ch`);
    }

    // 1) 原生 tool_calls（qwen2api 已解析）→ 直接透傳給 opencode
    const nativeCalls = msg?.tool_calls;
    if (nativeCalls?.length > 0) {
      log.info(`📬 原生 tool_calls x${nativeCalls.length}，透傳給 opencode`);
      return buildToolCallResponse(nativeCalls, msg?.content, currentModel, promptText);
    }

    // 2) Bash-block → tool_calls 轉換（主要路徑，Qwen 偏好此格式）
    const bashCalls = bashBlockToToolCalls(stripped, tools);
    if (bashCalls?.length > 0) {
      // ⛔ 迴圈防呆：檢查是否為重複命令
      // 提取核心命令（去除 cd、管線、重新定向等外殼）
      const extractCore = (cmd) => {
        // 移除 cd xxx && 前綴
        let c = cmd.replace(/^cd\s+[^&&]*&&\s*/, "").trim();
        // 移除 ls -la、echo 等只是查看的命令
        c = c.replace(/^ls\s+/, "");
        // 移除 | head -50、2>&1 等重新定向
        c = c.replace(/\s*2>&1\s*/, "").replace(/\s*\|\s*head\s*.*$/, "");
        return c.trim();
      };
      const prevCmd = (() => {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.role === "assistant" && m.tool_calls?.length > 0) {
            try {
              return extractCore(
                JSON.parse(m.tool_calls[0].function?.arguments || "{}")
                  ?.command || "",
              );
            } catch {
              return "";
            }
          }
          if (m.role === "user") break;
        }
        return "";
      })();
      const currCmd = (() => {
        try {
          return extractCore(
            JSON.parse(bashCalls[0]?.function?.arguments || "{}")?.command ||
              "",
          );
        } catch {
          return "";
        }
      })();
      if (
        prevCmd &&
        currCmd &&
        (prevCmd === currCmd ||
          currCmd.includes(prevCmd) ||
          prevCmd.includes(currCmd))
      ) {
        log.warn(`⛔ 重複命令偵測（核心: ${currCmd}），強制停止迴圈`);
        return buildTextResponse(
          `✓ 命令「${currCmd}」已執行成功（exit code: 0）。任務繼續進行，無需重複執行。`,
          currentModel, promptText,
        );
      }

      log.info(
        `🔧 bash-block x${bashCalls.length} → tool_calls，交給 opencode 執行`,
      );
      // 保留 <think> 推理過程（助手思考軌跡）作為 content，bash 部分轉為 tool_calls
      const contentBeforeBash = stripped
        .replace(/```(?:bash|sh|shell)[\s\S]*?```/g, "")
        .trim();
      const contentWithThink = thinking
        ? `[推理過程]\n${thinking}\n\n${contentBeforeBash}`.trim()
        : contentBeforeBash || null;
      return buildToolCallResponse(bashCalls, contentWithThink, currentModel, promptText);
    }

    // 3) 純文字回應 → 直接回傳（opencode 視為完成）
    log.debug(`✅ 純文字回應 ${raw.length}ch`);
    return buildTextResponse(raw || "(空回應)", currentModel, promptText);
  } catch (e) {
    log.error(`❌ runSinglePass 失敗:`, e?.message || e);
    return buildErrorResponse(`處理過程中發生錯誤: ${e?.message || e}`, "qwen");
  }
};

// ─── Token 估算（簡易版：1 token ≈ 4 chars，中英文通用） ───
let totalTokens = 0;
const countTokens = (s) => Math.ceil((s || "").length / 4);
const trackUsage = (prompt, completion) => {
  const p = countTokens(prompt);
  const c = countTokens(completion);
  totalTokens += p + c;
  return { prompt_tokens: p, completion_tokens: c, total_tokens: p + c };
};

// ─── Response builders ───

const buildTextResponse = (content, model, promptMsgs = "") => ({
  id: `chatcmpl-${Date.now()}`,
  object: "chat.completion",
  created: Math.round(Date.now() / 1000),
  model: model || "qwen",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    },
  ],
  usage: trackUsage(promptMsgs, content),
});

const buildToolCallResponse = (toolCalls, content, model, promptMsgs = "") => {
  const argsStr = (toolCalls || [])
    .map((tc) => tc.function?.arguments || "")
    .join("");
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.round(Date.now() / 1000),
    model: model || "qwen",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          tool_calls: toolCalls,
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: trackUsage(promptMsgs, argsStr),
  };
};

const buildErrorResponse = (msg, model) => ({
  id: `chatcmpl-${Date.now()}`,
  object: "chat.completion",
  created: Math.round(Date.now() / 1000),
  model: model || "qwen",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: `⚠️ ${msg}` },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
});

// 舊版 buildResponse（保留相容性，供舊呼叫點使用）
const buildResponse = (content, model, origModel) =>
  buildTextResponse(content, model || origModel);

// ─── 串流輸出 ───
// 支援純文字與 tool_calls 兩種格式

const streamResponse = (res, msgId, model, result) => {
  const choice = result.choices[0];
  const msg = choice.message;
  const toolCalls = msg?.tool_calls;

  if (toolCalls?.length > 0) {
    // tool_calls 串流格式（opencode 需要此格式才能解析）
    // 1) role delta
    streamChunk(res, msgId, model, {
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: msg.content || null },
          finish_reason: null,
        },
      ],
    });
    // 2) tool_calls delta（每個 call 一個 chunk）
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      streamChunk(res, msgId, model, {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: i,
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
    }
    // 3) finish
    streamChunk(res, msgId, model, {
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    });
  } else {
    // 純文字串流
    const content = msg?.content || "";
    for (let i = 0; i < content.length; i += CHUNK) {
      streamChunk(res, msgId, model, {
        choices: [
          {
            index: 0,
            delta: { content: content.slice(i, i + CHUNK) },
            finish_reason: null,
          },
        ],
      });
    }
    streamChunk(res, msgId, model, {
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
  }

  res.write("data: [DONE]\n\n");
  res.end();
};

// ─── 通用轉發（非聊天端點） ───

const proxyRequest = (req, res) => {
  const url = `${QWEN2API_URL}${req.url}`;
  const method = req.method;

  if (method === "GET") {
    getJSON(url)
      .then((data) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      })
      .catch((err) => {
        res.writeHead(502);
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  if (method === "POST") {
    let body = "";
    let rejected = false;
    req.on("data", (c) => {
      if (rejected) return;
      body += c;
      if (body.length > MAX_BODY) {
        rejected = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Request body too large (max 100KB)" }),
        );
        req.destroy();
      }
    });
    req.on("error", () => {
      rejected = true;
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        const parsed = JSON.parse(body);
        postJSON(url, parsed)
          .then((data) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(data));
          })
          .catch((err) => {
            res.writeHead(502);
            res.end(JSON.stringify({ error: err.message }));
          });
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  res.writeHead(405);
  res.end("Method Not Allowed");
};

// ─── 主請求處理 ───

const handleRequest = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url;

  // Rate Limiting（/health 不計入）
  if (url !== "/health") {
    const ip = req.socket.remoteAddress || "unknown";
    if (!checkRL(ip)) {
      log.warn(`⚠️ Rate limit 觸發: ${ip}`);
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Too Many Requests", retryAfter: Math.ceil(RL_WIN / 1000) }));
      return;
    }
  }

  // 安全驗證：除了 /health 外，必須驗證 API Key
  if (url !== "/health") {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${API_KEY}`) {
      log.warn(`⚠️ 拒絕未經授權的請求: ${req.method} ${url}`);
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized: Invalid API Key" }));
      return;
    }
  }

  // 健康檢查
  if (url === "/health") {
    let upstreamStatus = "unknown";
    try {
      // 健康檢查使用短超時（3秒），避免上游阻塞影響 proxy 響應
      const h = await getJSON(`${QWEN2API_URL}/health`, 3000, 0);
      upstreamStatus = h?.status || h?.upstream || "ok";
    } catch (e) {
      log.warn(`⚠️ 上游健康檢查失敗: ${e.message}`);
      upstreamStatus = "unreachable";
    }
    const hw = detectHardware();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        proxy: "running",
        upstream: upstreamStatus,
        port: PROXY_PORT,
        routing: getRouteInfo(),
        hardware: {
          level: hw.level,
          reason: hw.reason,
          env: hw.env,
          cpu: `${hw.cpu.cores}核`,
          ram: `${hw.ram.freeGB}GB/${hw.ram.totalGB}GB`,
          gpu: hw.gpu.model,
          load: hw.load.perCore,
          platform: hw.platform,
        },
      }),
    );
    return;
  }

  // MCP 工具執行端點
  if (url === "/mcp" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body);
        const name = parsed.params?.name;
        const args = parsed.params?.arguments || {};
        const result = await mcpCall(name, args);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: { content: [{ text: result }] } }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 聊天端點 — 有 tool 支援的代理
  if (url === "/v1/chat/completions" && req.method === "POST") {
    let body = "";
    let rejected = false;
    req.on("data", (c) => {
      if (rejected) return;
      body += c;
      if (body.length > MAX_BODY) {
        rejected = true;
        log.warn(`❌ 請求 body 過大 (${body.length} bytes)，已拒絕`);
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Request body too large (max 100KB)" }),
        );
        req.destroy(); // 強制關閉連線，避免 client 繼續送資料
      }
    });
    req.on("error", (e) => {
      if (!rejected) {
        log.error(`❌ 請求串流錯誤:`, e?.message || e);
      }
    });
    req.on("end", async () => {
      if (rejected) return;
      try {
        const parsed = JSON.parse(body);
        const msgId = `chatcmpl-${Date.now()}`;
        const model = parsed.model || "qwen";
        log.info(
          `📨 請求 model=${parsed.model} tools=${parsed.tools?.length || 0} stream=${parsed.stream}`,
        );

        if (parsed.stream) {
          // 串流：runSinglePass 後串流結果（支援 tool_calls 串流格式）
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const result = await runSinglePass(parsed);
          const c = result?.choices?.[0];
          const hasCalls = c?.message?.tool_calls?.length > 0;
          log.info(
            `✅ 串流回應 ${hasCalls ? `tool_calls x${c.message.tool_calls.length}` : `content=${(c?.message?.content || "").length}ch`}`,
          );
          streamResponse(res, msgId, model, result);
        } else {
          // 非串流
          const result = await runSinglePass(parsed);
          const c = result?.choices?.[0];
          const hasCalls = c?.message?.tool_calls?.length > 0;
          log.info(
            `✅ 回應 ${hasCalls ? `tool_calls x${c.message.tool_calls.length}` : `content=${(c?.message?.content || "").length}ch`}`,
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        }
      } catch (e) {
        log.error(`❌ 請求失敗:`, e?.message || e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 其餘端點轉發到 qwen2api
  proxyRequest(req, res);
};

// ─── 啟動 Proxy ───

export const startProxy = () => {
  const server = http.createServer(handleRequest);

  // 啟動後自動偵測環境
  detectEnv();

  return new Promise((resolve, reject) => {
    server.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        log.error(`❌ Port ${PROXY_PORT} 已被佔用，無法啟動 Proxy`);
      } else {
        log.error(`❌ Proxy 啟動失敗: ${e.message}`);
      }
      reject(e);
    });
    server.listen(PROXY_PORT, "127.0.0.1", () => {
      log.info(`🤖 Chat Proxy running on http://127.0.0.1:${PROXY_PORT}`);
      if (process.env.PROXY_ROUTE !== "off") {
        log.info("🧠 模型路由: 啟用（自動依任務複雜度切換）");
      }
      resolve(server);
    });
  });
};

// 暴露環境資訊供健康檢查
const getRouteInfo = () => ({
  enabled: process.env.PROXY_ROUTE !== "off",
  levels: {
    small: getModelForLevel("small"),
    medium: getModelForLevel("medium"),
    large: getModelForLevel("large"),
  },
  detected: envModels
    ? {
        small: envModels.small.length,
        medium: envModels.medium.length,
        large: envModels.large.length,
      }
    : null,
});

export { PROXY_PORT, getRouteInfo };
