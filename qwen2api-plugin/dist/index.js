/**
 * qwen2api-plugin — Qwen2API ↔ opencode 整合插件
 *
 * 功能：
 * • 11 個工具（檔案操作 + opencode 生態查詢 + 管理）
 * • 自動啟動/監控 Qwen2API 服務
 * • Token 狀態檢查與預警
 * • 服務異常自動修復
 *
 * 配置 (opencode.json):
 *   "plugin_origins": ["file:///home/reamaster/opencode-manager/projects/independent/qwen2api-plugin/src/index.js"]
 */

import * as http from "node:http";
import { spawn } from "node:child_process";
import { tool } from "@opencode-ai/plugin";
import { startProxy, PROXY_PORT, getRouteInfo } from "./chat-proxy.js";
import { killPort, getPath } from "./platform.js";

const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const LV = (() => {
  const raw = process.env.PROXY_LOG_LEVEL;
  if (raw && LOG_LEVELS[raw] !== undefined) return LOG_LEVELS[raw];
  if (process.env.PROXY_QUIET === "true" || process.env.PROXY_QUIET === "1")
    return 0;
  // 插件模式預設 error，避免污染終端機
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

const QWEN2API_DIR = getPath("qwen2api");
const QWEN2API_URL = "http://localhost:3000";
const API_KEY = "sk-123456";
const H = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

// ─── HTTP ───
const get = (p) =>
  new Promise((r) => {
    http
      .get(
        `${QWEN2API_URL}${p}`,
        { headers: { Authorization: `Bearer ${API_KEY}` } },
        (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => {
            try {
              r(JSON.parse(d));
            } catch (_) {
              r(d);
            }
          });
        },
      )
      .on("error", () => r(null));
  });
const post = (p, b) =>
  new Promise((r) => {
    const d = JSON.stringify(b);
    const req = http.request(
      `${QWEN2API_URL}${p}`,
      {
        method: "POST",
        headers: { ...H, "Content-Length": Buffer.byteLength(d) },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            r(JSON.parse(d));
          } catch (_) {
            r(d);
          }
        });
      },
    );
    req.on("error", () => r(null));
    req.write(d);
    req.end();
  });

// ─── 服務管理 ───
const isUp = async () => {
  try {
    const h = await get("/health");
    return h?.status === "healthy";
  } catch (_) {
    return false;
  }
};

const autoStart = async () => {
  if (await isUp()) return "already_running";

  // 清理殘留進程
  killPort(3000);
  await new Promise((r) => setTimeout(r, 1000));

  // 直接使用 spawn（非阻塞），避免 execSync 等待程序退出
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const c = spawn("bun", ["src/start.js"], {
        cwd: QWEN2API_DIR,
        stdio: "pipe",
        detached: true,
        env: { ...process.env, SERVICE_PORT: "3000" },
      });
      c.unref();

      // 等待服務就緒（最多 30 秒）
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await isUp()) return "started";
      }
    } catch (_) {}

    // 重試前再次清理
    killPort(3000);
    await new Promise((r) => setTimeout(r, 2000));
  }
  return "failed";
};

// ─── MCP 呼叫包裝 ───
const mcpCall = async (name, args) => {
  const r = await post("/mcp", {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return r?.result?.content?.[0]?.text || "⚠️ 無回應";
};

const mcpCallJSON = async (name, args) => {
  const text = await mcpCall(name, args);
  try {
    return JSON.parse(text);
  } catch (_) {
    return { error: text };
  }
};

// ─── Plugin ───
const Plugin = async (ctx) => {
  // 先清理佔用的 proxy port
  killPort(PROXY_PORT);

  // 並行啟動：Proxy 立即啟用，不等 qwen2api 就緒（detectEnv 延遲執行）
  let proxyServer = null;
  startProxy()
    .then((s) => (proxyServer = s))
    .catch((e) => log.error(`Proxy 啟動失敗: ${e.message}`));

  const svc = await autoStart();
  log.info(`服務狀態: ${svc}`);

  return {
    tool: {
      // ═══ 檔案操作 ═══
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

      // ═══ opencode 生態查詢 ═══
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

      // ═══ Qwen2API 管理 ═══
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
          msg += `\n📖 完整維修手冊: \`qwen_repair_manual\``;
          return msg;
        },
      }),
      qwen_proxy_status: tool({
        description:
          "檢查 Chat Proxy（工具呼叫支援）狀態，並顯示 opencode 設定方式。千問模型透過此 proxy 才能使用工具。",
        args: {},
        async execute() {
          const up = proxyServer?.listening;
          const route = up ? getRouteInfo() : null;
          const lines = [
            `🌐 **Chat Proxy 狀態**`,
            `  狀態: ${up ? "✅ 運行中" : "❌ 未啟動"}`,
            `  Port: ${PROXY_PORT}`,
            ``,
            `**設定方式:**`,
            `  修改 opencode.json 中的 provider URL:`,
            `  \`http://localhost:${PROXY_PORT}\``,
            ``,
            `  provider 名稱: qwen-proxy`,
            `  原先 URL: http://localhost:3000`,
            `  改成: http://localhost:${PROXY_PORT}`,
            ``,
          ];
          if (route) {
            lines.push(
              `**🧠 模型自動路由:** ${route.enabled ? "✅ 啟用" : "❌ 停用"}`,
              `  小模型 (simple): ${route.levels.small}`,
              `  中模型 (normal): ${route.levels.medium}`,
              `  大模型 (complex): ${route.levels.large}`,
            );
            if (route.detected) {
              lines.push(
                `  環境偵測: ${route.detected.small}s / ${route.detected.medium}m / ${route.detected.large}l 模型可用`,
              );
            }
            lines.push(``);
          }
          lines.push(
            `**支援的工具:**`,
            `  • 檔案: read, write, edit, glob, grep, bash`,
            `  • 生態: skill_list, skill_read, wiki_search, wiki_read, memory`,
            `  • Qwen2API: health, diagnose, repair, token, repair_manual`,
            ``,
            `**運作方式:**`,
            `  1. opencode 發送聊天請求含 tools 參數`,
            `  2. Proxy 轉發給 qwen2api（利用 native tool support）`,
            `  3. qwen2api 將 tools 轉為 <tool_call> XML 格式送 Qwen API`,
            `  4. Qwen API 回應含 tool_calls，qwen2api 解析回標準格式`,
            `  5. Proxy 執行工具（read/write/edit/glob/grep/bash）`,
            `  6. 結果以 tool role 送回 qwen2api，循環直到純文字`,
          );
          return lines.join("\n");
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
            return [
              `📖 **${issue.title}**`,
              `症狀: ${issue.symptom}`,
              `診斷: \`${issue.diagnose}\``,
              `修復: \`${issue.fix}\``,
              `自動修復: ${issue.autoFix ? "✅ 支援" : "❌ 需手動"}`,
            ].join("\n");
          }
          return [
            `📖 **Qwen2API 維修手冊 v${m.version}**`,
            `平台: ${m.platform}`,
            `位置: ${m.service.location}`,
            `啟動: \`${m.service.startCmd}\``,
            ``,
            `**已知問題 (${m.knownIssues?.length || 0} 項):**`,
            ...(m.knownIssues || []).map(
              (i) => `  • \`${i.id}\`: ${i.title} ${i.autoFix ? "✅" : "🔶"}`,
            ),
            ``,
            `**可用工具:**`,
            ...(m.tools || []).map(
              (t) => `  • \`${t.endpoint}\`: ${t.description}`,
            ),
            ``,
            `💡 查詢特定問題: \`qwen_repair_manual issue="問題ID"\``,
          ].join("\n");
        },
      }),
    },

    // ═══ 事件：異常自動修復 ═══
    event: async ({ event }) => {
      if (event?.type?.includes("error") || event?.name === "Service.Error") {
        try {
          const h = await get("/health");
          if (!h || h.status !== "healthy") {
            log.warn("異常偵測，嘗試修復...");
            await post("/health/repair", {});
            await autoStart();
          }
        } catch (_) {
          await autoStart();
        }
      }
    },

    // ═══ 啟動配置檢查 ═══
    config: async () => {
      const up = await isUp();
      if (!up) log.info("啟動服務中...");
      const s = await autoStart();
      const icon =
        s === "already_running"
          ? "✅ 運行中"
          : s === "started"
            ? "✅ 已啟動"
            : "❌ 啟動失敗";
      log.info(`${icon}: ${s}`);
      try {
        const h = await get("/health");
        if (h?.accounts?.valid === 0)
          log.warn("⚠️ 無有效 Token，請執行 auto-get-token.js");
      } catch (_) {}
      if (proxyServer?.listening) {
        log.info(`🌐 Chat Proxy 運行於 http://localhost:${PROXY_PORT}`);
      }
    },
  };
};

export default Plugin;
export { Plugin };
