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

const QWEN2API_URL = "http://localhost:3000";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "3456");
const API_KEY = process.env.API_KEY || "sk-123456";
const MAX_LOOPS = 5;
const MAX_BODY = 100 * 1024; // 請求 body 上限 100KB
const PROJ_DIR = getPath("projectDir");

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

// ─── HTTP helpers ───

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

const postJSON = (url, body) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: "POST",
      headers: { ...headers, "Content-Length": Buffer.byteLength(data) },
    };
    const req = http.request(opts, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(b));
        } catch {
          resolve({ content: b });
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });

const getJSON = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(b));
          } catch {
            resolve(null);
          }
        });
      })
      .on("error", reject);
  });

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

// ─── Tool prompt 建構 ───

// ─── (工具提示詞由 qwen2api middleware 注入原生 <tool_call> 格式) ───

// ─── 串流輸出 helper ───

const streamChunk = (res, msgId, model, data) => {
  res.write(
    `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created: Math.round(Date.now() / 1000), model, ...data })}\n\n`,
  );
};

const CHUNK = 32;

// ─── Agent Loop：標準 OpenAI function calling ───
//
// 利用 qwen2api 的 native tool support（tool-prompt.js），
// 將 OpenAI 格式的 tools 參數轉為 Qwen 的 <tool_call> XML 格式，
// 再解析回標準 tool_calls，proxy 只負責執行工具。
//
// 流程：
//   1. 轉發請求給 qwen2api（含 tools 參數）
//   2. qwen2api 回傳 tool_calls 或純文字
//   3. 有 tool_calls → 執行 MCP 工具 → 結果以 tool role 送回 → 繼續
//   4. 無 tool_calls → 回傳最終結果

const runAgentLoop = async (body) => {
  try {
    const { messages, tools, tool_choice, stream, ...rest } = body;
    const toolNames = tools?.map((t) => (t.function || t).name) || [];
    let msgs = [...(messages || [])];
    // 注入自訂工具提示詞（不傳 tools 給 qwen2api，避免觸發模型抗拒）
    if (tools?.length > 0) {
      const names = toolNames.join(", ");
      const hasSys = msgs.some((m) => m.role === "system");
      if (!hasSys) {
        msgs = [
          {
            role: "system",
            content: `你有以下工具可用：${names}。需要讀檔／執行命令／編輯檔案時，直接在 \`\`\`bash 程式碼區塊中輸出命令，我會自動執行。無需詢問，直接做。`,
          },
          ...msgs,
        ];
      }
    }
    let currentModel = routeModel(body);
    let isThinking =
      body.enable_thinking ?? body.model?.toLowerCase().includes("thinking");
    const sum = { reads: 0, cmds: 0, writes: 0, others: 0 };
    const BASH_RE = /```(?:bash|sh|shell)\s*\n([\s\S]*?)```/gi;

    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      // 不傳 tools 給 qwen2api — proxy 自處理工具邏輯
      const up = {
        ...rest,
        model: currentModel,
        messages: msgs,
        stream: false,
      };
      log.debug(`🔄 loop=${loop} model=${up.model} msgs=${up.messages.length}`);

      const result = await postJSON(`${QWEN2API_URL}/v1/chat/completions`, up);
      const choice = result?.choices?.[0];
      if (!choice) break;

      const msg = choice.message;
      const raw = msg?.content || "";
      const stripped = isThinking
        ? raw.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim()
        : raw;

      // 1) 檢查 qwen2api 解析出的 tool_calls（部分模型支援原生 <tool_call>）
      const calls = msg?.tool_calls;
      if (calls && calls.length > 0) {
        const results = [];
        for (const tc of calls) {
          const name = tc.function?.name || "";
          let args = {};
          try {
            args = JSON.parse(tc.function?.arguments || "{}");
          } catch {}
          const out = await mcpCall(name, args);
          results.push({
            role: "tool",
            tool_call_id: tc.id,
            content: typeof out === "string" ? out : JSON.stringify(out),
          });
          if (name === "read" || name.endsWith("_read")) sum.reads++;
          else if (
            name === "bash" ||
            name.endsWith("_bash") ||
            name === "execute"
          )
            sum.cmds++;
          else if (
            name === "write" ||
            name === "edit" ||
            name.endsWith("_write") ||
            name.endsWith("_edit")
          )
            sum.writes++;
          else sum.others++;
        }
        msgs = [
          ...msgs,
          {
            role: "assistant",
            content: msg?.content || null,
            tool_calls: calls,
          },
          ...results,
        ];
        continue;
      }

      // 2) 檢查 bash 程式碼區塊（主要機制，Qwen 模型偏好此格式）
      if (toolNames.includes("bash") && loop < MAX_LOOPS - 1) {
        const bm = [];
        let m;
        while ((m = BASH_RE.exec(stripped)) !== null) {
          const c = m[1].trim();
          if (c && !c.startsWith("#") && !c.startsWith("//")) bm.push(c);
        }
        if (bm.length > 0) {
          let toolResults = "";
          for (let cmd of [...new Set(bm)]) {
            if (
              !cmd.startsWith("cd ") &&
              !cmd.includes("&& cd ") &&
              /^(bun|npm|node|npx)\s/.test(cmd)
            )
              cmd = `cd ${PROJ_DIR} && ${cmd}`;
            try {
              const out = await mcpCall("bash", { command: cmd });
              toolResults += `\n\$ ${cmd}\n${typeof out === "string" ? out : JSON.stringify(out)}`;
            } catch (e) {
              toolResults += `\n[指令失敗: ${cmd} - ${e.message}]`;
            }
          }
          sum.cmds += bm.length;
          msgs = [
            ...msgs,
            { role: "assistant", content: raw },
            {
              role: "user",
              content: `指令執行結果：${toolResults}\n\n根據此輸出繼續。`,
            },
          ];
          continue;
        }
      }

      // 3) 純文字 → 最終回應
      return buildResponse(raw || "(空回應)", currentModel, body.model, sum, 0);
    }

    return buildResponse(
      "已達最大循環次數，任務可能未完成",
      currentModel,
      body.model,
      sum,
      0,
    );
  } catch (e) {
    log.error(`❌ Agent Loop 崩潰:`, e?.message || e);
    return buildResponse(
      `⚠️ 處理過程中發生錯誤: ${e?.message || e}`,
      "qwen",
      null,
      {},
      0,
    );
  }
};

const buildResponse = (content, model, origModel, sum, allFixed) => {
  const parts = [];
  if (sum.reads > 0) parts.push(`📖 讀取 ${sum.reads} 個檔案`);
  if (sum.cmds > 0) parts.push(`💻 執行 ${sum.cmds} 個命令`);
  if (sum.writes > 0) parts.push(`✏️ 修改 ${sum.writes} 個檔案`);
  if (sum.others > 0) parts.push(`🛠 其他 ${sum.others} 項`);
  if (allFixed > 0) parts.push(`✏️ 自動修復 ${allFixed} 個檔案`);
  const summary =
    parts.length > 0 ? `\n\n---\n🔧 工具執行摘要：${parts.join("、")}` : "";
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.round(Date.now() / 1000),
    model: model || origModel || "qwen",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: `${content}${summary}` },
        finish_reason: "stop",
      },
    ],
  };
};

// ─── 串流輸出（純文字，無 tool_calls） ───

const streamResponse = (res, msgId, model, result) => {
  const content = result.choices[0].message.content || "";

  // 串流文字內容
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

  // finish
  streamChunk(res, msgId, model, {
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });

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

  // 健康檢查
  if (url === "/health") {
    const h = await getJSON(`${QWEN2API_URL}/health`).catch(() => ({}));
    const hw = detectHardware();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        proxy: "running",
        upstream: h?.status || "unknown",
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
          // 串流：先跑完 Agent Loop，再串流最終結果
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const result = await runAgentLoop(parsed);
          log.info(
            `✅ 串流回應 content=${(result?.choices?.[0]?.message?.content || "").length}ch`,
          );
          streamResponse(res, msgId, model, result);
        } else {
          // 非串流
          const result = await runAgentLoop(parsed);
          log.info(
            `✅ 回應 content=${(result?.choices?.[0]?.message?.content || "").length}ch`,
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
    server.listen(PROXY_PORT, () => {
      log.info(`🤖 Chat Proxy running on http://localhost:${PROXY_PORT}`);
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
