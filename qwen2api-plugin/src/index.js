/**
 * qwen2api-plugin — Qwen2API ↔ opencode 整合插件（容錯版）
 *
 * 功能：
 * • 11 個工具（檔案操作 + opencode 生態查詢 + 管理）
 * • 自動啟動/監控 Qwen2API 服務
 * • 自動啟動/監控 Chat Proxy
 * • 健康監控定時檢查，故障自動重啟
 * • Token 狀態檢查與預警
 * • 服務異常自動修復
 * • HTTP 調用重試 + 斷路器
 * • 降級策略（本地緩存兜底）
 *
 * 配置 (opencode.json):
 *   "plugin": ["file:///path/to/qwen2api-plugin/src/index.js"]
 *
 * 環境變數：
 *   QWEN2API_PORT  — qwen2api 端口（預設 3000）
 *   QWEN2API_HOST  — qwen2api 主機（預設 localhost）
 *   QWEN2API_KEY   — API 金鑰（預設 sk-123456）
 */

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { startProxy, PROXY_PORT } from "./chat-proxy.js";
import { killPort, getPath } from "./platform.js";
import {
  checkAndRepair,
  resolvePackage,
  importResolved,
  safeRealpath,
  isDir,
  exists,
  IS_WIN,
  PLUGIN_DIR,
  PLUGIN_NODE_MODULES,
} from "./resolve-deps.mjs";

const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const LV = (() => {
  const raw = process.env.PROXY_LOG_LEVEL;
  if (raw && LOG_LEVELS[raw] !== undefined) return LOG_LEVELS[raw];
  if (process.env.PROXY_QUIET === "true" || process.env.PROXY_QUIET === "1")
    return 0;
  return LOG_LEVELS.error;
})();
const log = {
  debug: (...a) => {
    if (LV >= 4) console.log("[plugin]", ...a);
  },
  info: (...a) => {
    if (LV >= 3) console.log("[plugin]", ...a);
  },
  warn: (...a) => {
    if (LV >= 2) console.warn("[plugin]", ...a);
  },
  error: (...a) => {
    if (LV >= 1) console.error("[plugin]", ...a);
  },
};

// ─── 環境可配置端口/Host/Key ───
const QWEN2API_PORT = parseInt(process.env.QWEN2API_PORT || "3000", 10);
const QWEN2API_HOST = process.env.QWEN2API_HOST || "127.0.0.1";
const _QWEN2API_HOST = QWEN2API_HOST.includes(":")
  ? `[${QWEN2API_HOST}]`
  : QWEN2API_HOST;
const QWEN2API_KEY = process.env.QWEN2API_KEY || "sk-123456";
const QWEN2API_DIR = getPath("qwen2api");
const QWEN2API_URL = `http://${_QWEN2API_HOST}:${QWEN2API_PORT}`;
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;
const H = {
  Authorization: `Bearer ${QWEN2API_KEY}`,
  "Content-Type": "application/json",
};

log.info(
  `Qwen2API 連接: ${QWEN2API_URL} (key: ${QWEN2API_KEY.slice(0, 8)}...)`,
);

// ─── 斷路器狀態 ───
const circuitState = {
  closed: true, // true=正常, false=斷路開啟
  failures: 0, // 連續失敗次數
  lastFailure: 0, // 上次失敗時間
  halfOpenAt: 0, // 半開狀態嘗試時間
  cooldown: 30000, // 斷路後冷卻時間（30秒）
  threshold: 5, // 連續失敗閾值
};

function recordSuccess() {
  circuitState.failures = 0;
  circuitState.closed = true;
}

function recordFailure() {
  circuitState.failures += 1;
  circuitState.lastFailure = Date.now();
  if (circuitState.failures >= circuitState.threshold) {
    circuitState.closed = false;
    log.warn(`⚠️ 斷路器開啟（連續失敗 ${circuitState.failures} 次）`);
  }
}

function canRequest() {
  if (circuitState.closed) return true;
  // 半開狀態：冷卻時間後允許一次嘗試
  if (Date.now() - circuitState.lastFailure > circuitState.cooldown) {
    log.info("🔄 斷路器半開，嘗試恢復...");
    return true;
  }
  return false;
}

// ─── 本地緩存（降級用） ───
const cache = new Map();
const CACHE_TTL = {
  health: 10000, // 健康檢查 10s
  models: 60000, // 模型列表 60s
  default: 30000, // 預設 30s
};

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data, ttl = CACHE_TTL.default) {
  cache.set(key, { data, ts: Date.now(), ttl });
}

// ─── HTTP helpers（帶重試 + 斷路器 + 降級） ───

const retryConfig = {
  maxRetries: 2,
  baseDelay: 500,
  maxDelay: 5000,
};

async function fetchWithRetry(
  url,
  opts = {},
  retries = retryConfig.maxRetries,
) {
  if (!canRequest()) {
    log.warn("⚠️ 斷路器開啟，跳過請求");
    return null;
  }

  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    let timer;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), opts.timeout || 5000);
      const res = await fetch(url, {
        method: opts.method || "GET",
        headers: opts.headers || {},
        body: opts.body || undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const txt = await res.text();
      const result = (() => {
        try {
          return JSON.parse(txt);
        } catch {
          return txt;
        }
      })();
      recordSuccess();
      return result;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      log.debug(`重試 ${i + 1}/${retries + 1}: ${e.message}`);
      if (i < retries) {
        const delay = Math.min(
          retryConfig.baseDelay * Math.pow(2, i),
          retryConfig.maxDelay,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  recordFailure();
  return null;
}

const get = (p) => {
  const url = `${QWEN2API_URL}${p}`;
  // 檢查緩存
  const cached = getCache(`get:${p}`);
  if (cached) {
    log.debug(`快取命中: ${p}`);
    return Promise.resolve(cached);
  }
  return fetchWithRetry(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${QWEN2API_KEY}` },
  }).then((r) => {
    if (r) setCache(`get:${p}`, r);
    return r;
  });
};

const post = (p, b) => {
  const url = `${QWEN2API_URL}${p}`;
  const d = JSON.stringify(b);
  return fetchWithRetry(url, {
    method: "POST",
    headers: { ...H, "Content-Length": Buffer.byteLength(d) },
    body: d,
  });
};

const proxyPost = (p, b) => {
  const url = `${PROXY_URL}${p}`;
  const d = JSON.stringify(b);
  return fetchWithRetry(url, {
    method: "POST",
    headers: { ...H },
    body: d,
  });
};

const proxyGet = async (p, timeout = 3000) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(`${PROXY_URL}${p}`, { signal: controller.signal });
    clearTimeout(timer);
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch {
      return txt;
    }
  } catch {
    return null;
  }
};

// ─── 服務健康檢查 ───
const isUp = async () => {
  const h = await get("/health");
  return h?.status === "healthy";
};

const isProxyUp = async () => {
  const h = await proxyGet("/health", 3000);
  return h?.proxy === "running";
};

// ─── 通用啟動函式 ───
const spawnService = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    try {
      const c = spawn(cmd, args, { stdio: "pipe", detached: true, ...opts });
      c.unref();
      const timer = setTimeout(() => resolve(c), 500);
      c.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      c.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`exited with code ${code}`));
      });
    } catch (e) {
      reject(e);
    }
  });

const waitForPort = async (port, host, maxSec) => {
  const { createConnection } = await import("node:net");
  for (let i = 0; i < maxSec; i++) {
    const ok = await new Promise((r) => {
      const s = createConnection(port, host, () => {
        s.destroy();
        r(true);
      });
      s.on("error", () => r(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};

// ─── 自動啟動 Qwen2API ───
let qwenProc = null;

const autoStart = async () => {
  if (await isUp()) return "already_running";

  killPort(QWEN2API_PORT);
  await new Promise((r) => setTimeout(r, 1000));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      qwenProc = spawn("bun", ["src/start.js"], {
        cwd: QWEN2API_DIR,
        stdio: "pipe",
        detached: true,
        env: {
          ...process.env,
          SERVICE_PORT: String(QWEN2API_PORT),
        },
      });
      qwenProc.unref();
      qwenProc.on("exit", (code) => {
        log.warn(`⚠️ qwen2api 進程退出 (code=${code})，監控將自動重啟`);
        qwenProc = null;
      });

      const ok = await waitForPort(QWEN2API_PORT, QWEN2API_HOST, 30);
      if (ok && (await isUp())) return "started";
    } catch (e) {
      log.warn(`qwen2api 啟動嘗試 ${attempt + 1} 失敗: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return "failed";
};

// ─── 自動啟動 Chat Proxy ───
let proxyServer = null;

const autoStartProxy = async () => {
  if (await isProxyUp()) return "already_running";

  killPort(PROXY_PORT);
  await new Promise((r) => setTimeout(r, 1000));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      proxyServer = await startProxy();
      proxyServer.on("close", () => {
        log.warn(`⚠️ Chat Proxy 關閉，監控將自動重啟`);
        proxyServer = null;
      });
      return "started";
    } catch (e) {
      log.warn(`proxy 啟動嘗試 ${attempt + 1} 失敗: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return "failed";
};

// ─── 健康監控（30 秒間隔，自動重啟） ───
let monitorTimer = null;
const startMonitor = () => {
  if (monitorTimer) return;
  log.info("🔄 啟動健康監控（30s 間隔）");
  monitorTimer = setInterval(async () => {
    try {
      const qUp = await isUp();
      if (!qUp) {
        log.warn("⚠️ qwen2api 無回應，嘗試重啟...");
        autoStart()
          .then((s) => log.info(`qwen2api 重啟: ${s}`))
          .catch(() => {});
      }
      const pUp = await isProxyUp();
      if (!pUp) {
        log.warn("⚠️ Chat Proxy 無回應，嘗試重啟...");
        autoStartProxy()
          .then((s) => log.info(`proxy 重啟: ${s}`))
          .catch(() => {});
      }
    } catch (_) {}
  }, 30000);
};

// ─── 自動修復共享依賴 ───
async function autoRepairDeps() {
  const sharedDeps = [
    "effect",
    "zod",
    "@opencode-ai/plugin",
    "@opencode-ai/sdk",
  ];
  const localModules = PLUGIN_NODE_MODULES;

  // 確保本地 node_modules 目錄存在
  if (!exists(localModules)) {
    try {
      fs.mkdirSync(localModules, { recursive: true });
      log.info(`已建立 node_modules 目錄: ${localModules}`);
    } catch (e) {
      log.error(`無法建立 node_modules: ${e.message}`);
      return;
    }
  }

  for (const dep of sharedDeps) {
    const resolved = resolvePackage(dep);
    const localPath = path.join(localModules, dep);

    // 如果已存在且有效，跳過
    if (exists(localPath)) {
      const real = safeRealpath(localPath);
      if (real && isDir(real)) {
        log.debug(`依賴 ${dep} 已存在: ${real}`);
        continue;
      }
    }

    // 嘗試從 shared-deps 複製
    if (resolved) {
      try {
        // 先刪除損壞的連結或目錄
        fs.rmSync(localPath, { recursive: true, force: true });

        if (IS_WIN) {
          // Windows: 複製實際檔案（符號連結不可靠）
          fs.cpSync(resolved, localPath, { recursive: true });
          log.info(`✓ 已複製 ${dep} 到本地: ${resolved} → ${localPath}`);
        } else {
          // Linux/macOS: 建立符號連結
          fs.symlinkSync(resolved, localPath, "junction");
          log.info(`✓ 已連結 ${dep}: ${localPath} → ${resolved}`);
        }
      } catch (e) {
        log.error(`✗ 修復 ${dep} 失敗: ${e.message}`);
      }
    } else {
      log.warn(`⚠️ 無法找到 ${dep} 的來源路徑`);
    }
  }

  // 嘗試 npm install 作為最後手段
  const missingDeps = sharedDeps.filter((dep) => {
    const localPath = path.join(localModules, dep);
    return !exists(localPath) || !isDir(localPath);
  });

  if (missingDeps.length > 0) {
    log.warn(`嘗試 npm install 安裝缺失的依賴: ${missingDeps.join(", ")}`);
    try {
      const cmd = IS_WIN ? "npm.cmd" : "npm";
      execSync(`${cmd} install ${missingDeps.join(" ")}`, {
        cwd: PLUGIN_DIR,
        stdio: "pipe",
        timeout: 60000,
      });
      log.info("✓ npm install 完成");
    } catch (e) {
      log.error(`npm install 失敗: ${e.message}`);
    }
  }
}

// ─── MCP 呼叫包裝（帶降級） ───
const mcpCall = async (name, args) => {
  const r = await proxyPost("/mcp", {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  if (!r) {
    log.warn(`⚠️ MCP 呼叫失敗，降級回傳: ${name}`);
    return `⚠️ 服務暫時無法連線（${name}）`;
  }
  return r?.result?.content?.[0]?.text || "⚠️ 無回應";
};

const mcpCallJSON = async (name, args) => {
  const text = await mcpCall(name, args);
  if (text?.startsWith?.("⚠️")) return { error: text };
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};

// ─── Plugin ───
/** @returns {Promise<{tool: Record<string, any>, event: Function, config: Function}>} */
const Plugin = async (ctx) => {
  // 啟動時檢查並修復共享依賴
  const depCheck = checkAndRepair();
  if (!depCheck.ok) {
    log.warn("⚠️ 共享依賴檢查發現問題:");
    depCheck.issues.forEach((i) => log.warn(`  - ${i}`));
    // 嘗試自動修復：從 shared-deps 鏈接或複製到本地
    await autoRepairDeps();
  }

  // 背景啟動雙服務，不阻塞 opencode 啟動
  const init = (async () => {
    const q = await autoStart();
    log.info(`qwen2api: ${q}`);
    if (q !== "failed") {
      const p = await autoStartProxy();
      log.info(`proxy: ${p}`);
    }
    startMonitor();
    // 檢查 token
    try {
      const h = await get("/health");
      if (h?.accounts?.valid === 0)
        log.warn("⚠️ 無有效 Token，請執行 auto-get-token.js");
    } catch (_) {}
  })();
  init.catch((e) => log.error(`初始化異常: ${e.message}`));
  // 不等待 init

  return {
    tool: {
      qwen_read: tool({
        description: "透過 Qwen2API 讀取檔案內容。支援 Windows 絕對路徑。",
        args: {
          filePath: tool.schema
            .string()
            .describe("檔案絕對路徑，如 D:/project/file.txt"),
        },
        async execute(args) {
          return await mcpCall("read", args);
        },
      }),
      qwen_write: tool({
        description: "透過 Qwen2API 寫入/建立檔案。目錄不存在時自動建立。",
        args: {
          filePath: tool.schema.string().describe("檔案絕對路徑"),
          content: tool.schema.string().describe("要寫入的內容"),
        },
        async execute(args) {
          return await mcpCall("write", args);
        },
      }),
      qwen_edit: tool({
        description: "透過 Qwen2API 編輯檔案：尋找並取代文字。",
        args: {
          filePath: tool.schema.string().describe("檔案絕對路徑"),
          oldString: tool.schema.string().describe("要被取代的原始文字"),
          newString: tool.schema.string().optional().describe("取代後的新文字"),
        },
        async execute(args) {
          return await mcpCall("edit", args);
        },
      }),
      qwen_glob: tool({
        description: "透過 Qwen2API 搜尋檔案。支援 **/*.java 等通配符。",
        args: {
          pattern: tool.schema.string().describe("檔案匹配模式，如 **/*.ts"),
          path: tool.schema.string().optional().describe("搜尋根目錄（選填）"),
        },
        async execute(args) {
          return await mcpCall("glob", args);
        },
      }),
      qwen_grep: tool({
        description: "透過 Qwen2API 在檔案中搜尋文字內容。",
        args: {
          pattern: tool.schema.string().describe("搜尋正則表達式"),
          path: tool.schema.string().optional().describe("搜尋路徑（選填）"),
          include: tool.schema
            .string()
            .optional()
            .describe("檔案過濾模式，如 *.js（選填）"),
        },
        async execute(args) {
          return await mcpCall("grep", args);
        },
      }),
      qwen_bash: tool({
        description:
          "透過 Qwen2API 執行 shell 命令。可用於編譯、執行腳本、查看目錄。",
        args: { command: tool.schema.string().describe("要執行的命令") },
        async execute(args) {
          return await mcpCall("bash", args);
        },
      }),

      qwen_skill_list: tool({
        description: "列出 opencode 生態中所有可用的技能清單。",
        args: {},
        async execute() {
          const d = await mcpCallJSON("skill_list", {});
          return `📚 **技能清單** (共 ${d.total || 0} 個)\n${(d.skills || []).join("\n")}`;
        },
      }),
      qwen_skill_read: tool({
        description: "讀取指定技能的完整內容。技能是 AI 的行為指南和操作手冊。",
        args: {
          skill: tool.schema
            .string()
            .describe("技能名稱，如 debug、knowledge、github"),
        },
        async execute(args) {
          return await mcpCall("skill_read", { skill: args.skill });
        },
      }),
      qwen_wiki_search: tool({
        description: "搜尋 opencode 知識庫/維基。查詢技術經驗、問題修復記錄。",
        args: { query: tool.schema.string().describe("搜尋關鍵字") },
        async execute(args) {
          const d = await mcpCallJSON("wiki_search", { query: args.query });
          if (!d.total) return "⚠️ 無匹配結果";
          return `📖 **維基搜尋結果** (${d.total} 項)\n${(d.results || []).map((e, i) => `${i + 1}. **${e.title}** [${e.category}]`).join("\n")}\n\n💡 使用 \`qwen_wiki_read\` 讀取完整內容`;
        },
      }),
      qwen_wiki_read: tool({
        description: "讀取指定維基頁面完整內容。維基包含技術方案、經驗教訓。",
        args: { title: tool.schema.string().describe("維基頁面標題或關鍵字") },
        async execute(args) {
          return await mcpCall("wiki_read", { title: args.title });
        },
      }),
      qwen_memory: tool({
        description:
          "查詢 opencode 記憶系統。記憶儲存了跨對話的技術經驗和專案事實。",
        args: {
          query: tool.schema.string().optional().describe("搜尋關鍵字（選填）"),
        },
        async execute(args) {
          const d = await mcpCallJSON("memory_query", {
            query: args.query || "",
          });
          return `🧠 **記憶系統**\n總檔案: ${d.total || 0}\n匹配: ${d.matched || 0}\n${(
            d.files || []
          )
            .slice(0, 15)
            .map((f) => `  📄 ${f}`)
            .join("\n")}`;
        },
      }),

      qwen_health: tool({
        description: "檢查 Qwen2API 服務健康狀態（記憶體、帳戶、運行時間）。",
        args: {},
        async execute() {
          const h = await get("/health");
          if (!h) return "❌ Qwen2API 服務無法連線";
          return [
            `📊 **Qwen2API 狀態**`,
            `  狀態: ${h.status === "healthy" ? "✅ 正常" : "⚠️ 降級"}`,
            `  運行時間: ${h.uptime}`,
            `  記憶體: ${h.memory?.rss} / ${h.memory?.heapUsed}`,
            `  帳戶: ${h.accounts?.valid}/${h.accounts?.total} 有效`,
            `  Token 過期: ${h.accounts?.expired || 0} 個`,
            `  CPU: ${h.os?.cpu}`,
          ].join("\n");
        },
      }),
      qwen_repair: tool({
        description: "執行 Qwen2API 自我修復：檢查依賴、建立目錄、GC 清理。",
        args: {},
        async execute() {
          const r = await post("/health/repair", {});
          if (!r) return "❌ 修復請求失敗";
          return `🔧 **自我修復完成**\n${(r.repairs || []).map((x) => `  • ${x.action}: ${x.status === "success" ? "✅" : "❌"} ${x.detail || ""}`).join("\n")}`;
        },
      }),
      qwen_token: tool({
        description: "檢查 Qwen2API Token 狀態。若過期會顯示修復方式。",
        args: {},
        async execute() {
          const h = await get("/health");
          if (!h) return "❌ Qwen2API 無法連線";
          const a = h.accounts || {};
          const expired = a.expired || 0;
          let msg = `🔑 **Token 狀態**\n有效帳戶: ${a.valid}/${a.total}\n`;
          if (a.total === 0) msg += "⚠️ 尚未設定任何帳戶\n";
          if (expired > 0) msg += `❌ ${expired} 個 Token 已過期\n`;
          msg += `\n💡 **更新 Token**: 執行 \`bun ${QWEN2API_DIR}/auto-get-token.js\``;
          return msg;
        },
      }),
      qwen_diagnose: tool({
        description:
          "執行 Qwen2API 完整診斷，自動檢查所有已知問題並回報修復建議。遇到任何問題時優先使用此工具。",
        args: {},
        async execute() {
          const d = await post("/repair/diagnose", {});
          if (!d) return "❌ 診斷請求失敗";
          let msg = `🔍 **診斷報告**\n狀態: ${d.status}\n\n`;
          if (d.issues?.length > 0) {
            msg += `**發現 ${d.issues.length} 個問題:**\n`;
            d.issues.forEach((i) => {
              const icon =
                i.severity === "critical"
                  ? "🔴"
                  : i.severity === "warning"
                    ? "🟡"
                    : "🔵";
              msg += `${icon} [${i.severity}] ${i.issue}\n  ${i.detail}\n`;
            });
            msg += `\n**建議修復:**\n`;
            d.fixes.forEach(
              (f) => (msg += `  • ${f.action}: \`${f.cmd || f.endpoint}\`\n`),
            );
            if (d.autoRepair) {
              msg += `\n**自動修復結果:**\n`;
              d.autoRepair.forEach(
                (r) =>
                  (msg += `  ${r.status === "success" ? "✅" : "❌"} ${r.action}\n`),
              );
            }
          } else {
            msg += "✅ 未發現問題\n";
          }
          return msg;
        },
      }),
      qwen_proxy_status: tool({
        description:
          "檢查 Chat Proxy（工具呼叫支援）狀態。千問模型透過此 proxy 才能使用工具。",
        args: {},
        async execute() {
          const h = await proxyGet("/health", 3000);
          const up = h?.proxy === "running";
          return [
            `🌐 **Chat Proxy 狀態**`,
            `  狀態: ${up ? "✅ 運行中" : "❌ 未啟動"}`,
            `  Port: ${PROXY_PORT}`,
            up
              ? `  Routing: ${h.routing?.enabled ? "✅ 啟用" : "❌ 停用"}`
              : null,
            up && h.routing?.detected
              ? `  模型: ${h.routing.detected.small}s / ${h.routing.detected.medium}m / ${h.routing.detected.large}l`
              : null,
            up ? `  Upstream: ${h.upstream}` : null,
            ``,
            `  provider URL: http://localhost:${PROXY_PORT}/v1`,
            `  provider 名稱: qwen-proxy`,
          ]
            .filter(Boolean)
            .join("\n");
        },
      }),
      qwen_repair_manual: tool({
        description:
          "讀取 Qwen2API 完整維修手冊。包含所有已知問題、診斷方式、修復步驟。",
        args: {
          issue: tool.schema
            .string()
            .optional()
            .describe(
              "問題 ID（選填），例如 token-expired、port-in-use、high-memory",
            ),
        },
        async execute(args) {
          const m = await get("/repair/manual");
          if (!m) return "❌ 無法讀取維修手冊";
          if (args.issue) {
            const issue = m.knownIssues?.find(
              (i) => i.id === args.issue || i.title.includes(args.issue),
            );
            if (!issue)
              return `⚠️ 找不到問題: ${args.issue}，可用: ${m.knownIssues?.map((i) => i.id).join(", ")}`;
            return `📖 **${issue.title}**\n症狀: ${issue.symptom}\n診斷: \`${issue.diagnose}\`\n修復: \`${issue.fix}\`\n自動修復: ${issue.autoFix ? "✅ 支援" : "❌ 需手動"}`;
          }
          return [
            `📖 **Qwen2API 維修手冊 v${m.version}**`,
            `平台: ${m.platform}`,
            `位置: ${m.service.location}`,
            `啟動: \`${m.service.startCmd}\``,
            `**已知問題 (${m.knownIssues?.length || 0} 項):**`,
            ...(m.knownIssues || []).map(
              (i) => `  • \`${i.id}\`: ${i.title} ${i.autoFix ? "✅" : "🔶"}`,
            ),
            `💡 查詢特定問題: \`qwen_repair_manual issue="問題ID"\``,
          ].join("\n");
        },
      }),
    },

    // ═══ 事件：異常自動修復 ═══
    event: async ({ event }) => {
      if (event?.type?.includes("error") || event?.name === "Service.Error") {
        // 觸發立即健康檢查（非同步，不阻塞事件）
        (async () => {
          try {
            if (!(await isUp())) {
              log.warn("🔧 異常事件觸發 qwen2api 重啟...");
              await autoStart();
            }
            if (!(await isProxyUp())) {
              log.warn("🔧 異常事件觸發 proxy 重啟...");
              await autoStartProxy();
            }
          } catch (_) {}
        })();
      }
    },

    // ═══ 啟動配置檢查 ═══
    config: async () => {
      // 確保服務已啟動
      const q = await autoStart();
      const p = await autoStartProxy();
      log.info(
        `qwen2api: ${q === "failed" ? "❌" : "✅"} / proxy: ${p === "failed" ? "❌" : "✅"}`,
      );
      startMonitor();
    },
  };
};

export default Plugin;
export { Plugin };
