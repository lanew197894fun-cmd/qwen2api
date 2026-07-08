/**
 * qwen2api-plugin — Qwen2API ↔ opencode 整合插件（流暢版 2026-07-07）
 *
 * 設計原則：
 * • 工具呼叫必須流暢：不阻擋、不噴 log 噪音、不回傳 null
 * • fetchWithRetry 永不回傳 null，失敗回傳描述性錯誤字串
 * • 快取不儲存 null/undefined
 * • 啟動/重啟有鎖防止 race condition
 *
 * 配置 (opencode.json):
 *   "plugin": ["file:///path/to/qwen2api-plugin/src/index.js"]
 *
 * 環境變數：
 *   QWEN2API_PORT  — qwen2api 端口（預設 3000）
 *   QWEN2API_HOST  — qwen2api 主機（預設 localhost）
 *   QWEN2API_KEY   — API 金鑰（預設 sk-qwen2api-test-2026）
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { startProxy, PROXY_PORT } from "./chat-proxy.js";
import { killPort, getPath } from "./platform.js";
import { checkAndRepair, resolvePackage, importResolved, safeRealpath, isDir, exists, IS_WIN, PLUGIN_DIR, PLUGIN_NODE_MODULES, } from "./resolve-deps.mjs";
import { makeLogger } from "./color.js";
const log = makeLogger("plugin", "primary");
// ─── 環境可配置端口/Host/Key ───
const QWEN2API_PORT = parseInt(process.env.QWEN2API_PORT || "3000", 10);
const QWEN2API_HOST = process.env.QWEN2API_HOST || "127.0.0.1";
const _QWEN2API_HOST = QWEN2API_HOST.includes(":")
    ? `[${QWEN2API_HOST}]`
    : QWEN2API_HOST;
const QWEN2API_KEY = process.env.QWEN2API_KEY || "sk-qwen2api-test-2026";
const QWEN2API_DIR = getPath("qwen2api");
const QWEN2API_URL = `http://${_QWEN2API_HOST}:${QWEN2API_PORT}`;
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;
const H = {
    Authorization: `Bearer ${QWEN2API_KEY}`,
    "Content-Type": "application/json",
};
log.info(`Qwen2API 連接: ${QWEN2API_URL} (key: ${QWEN2API_KEY.slice(0, 8)}...)`);
// ═══════════════════════════════════════════════
// 斷路器已移除（2026-07-07：使用者認為不正常）
// 直接請求，失敗回傳錯誤字串，不阻擋不靜默
// ═══════════════════════════════════════════════
// ─── 本地緩存（不儲存 null/undefined） ───
const cache = new Map();
const CACHE_TTL = {
    health: 5000, // 健康檢查 5s（縮短）
    models: 60000, // 模型列表 60s
    default: 30000, // 預設 30s
};
function getCache(key) {
    const entry = cache.get(key);
    if (!entry)
        return null;
    if (Date.now() - entry.ts > entry.ttl) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}
function setCache(key, data, ttl = CACHE_TTL.default) {
    if (data == null)
        return; // 不存 null/undefined
    cache.set(key, { data, ts: Date.now(), ttl });
}
// ─── HTTP helpers（永不回傳 null，失敗回傳錯誤字串） ───
const retryCfg = {
    maxRetries: 2,
    baseDelay: 500,
    maxDelay: 5000,
};
async function fetchWithRetry(url, opts = {}, retries = retryCfg.maxRetries) {
    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
        let timer;
        try {
            const controller = new AbortController();
            timer = setTimeout(() => controller.abort(), opts.timeout || 30000);
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
                }
                catch {
                    return txt;
                }
            })();
            return result;
        }
        catch (e) {
            clearTimeout(timer);
            lastErr = e;
            if (i < retries) {
                const delay = Math.min(retryCfg.baseDelay * Math.pow(2, i), retryCfg.maxDelay);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    return {
        _error: true,
        message: lastErr?.message || "請求失敗（已重試）",
    };
}
/** 封裝 GET，自動緩存且不存 null/undefined */
const get = async (p) => {
    const url = `${QWEN2API_URL}${p}`;
    const cached = getCache(`get:${p}`);
    if (cached) {
        log.debug(`快取命中: ${p}`);
        return cached;
    }
    const r = await fetchWithRetry(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${QWEN2API_KEY}` },
    });
    if (r && !r._error)
        setCache(`get:${p}`, r);
    return r;
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
const proxyGet = async (p, timeout = 5000) => {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const res = await fetch(`${PROXY_URL}${p}`, { signal: controller.signal });
        clearTimeout(timer);
        const txt = await res.text();
        try {
            return JSON.parse(txt);
        }
        catch {
            return txt;
        }
    }
    catch {
        return null;
    }
};
// ─── 服務健康檢查 ───
const isUp = async () => {
    const h = await get("/health");
    if (h?._error)
        return false;
    return h?.status === "healthy";
};
const isProxyUp = async () => {
    const h = await proxyGet("/health", 5000);
    return h?.proxy === "running";
};
// ─── 通用啟動函式 ───
const spawnService = (cmd, args, opts) => new Promise((resolve, reject) => {
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
    }
    catch (e) {
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
        if (ok)
            return true;
        await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
};
// ─── 啟動鎖（防止 race condition） ───
let _starting = false;
let _startingProxy = false;
// ─── 自動啟動 Qwen2API ───
let qwenProc = null;
const autoStart = async () => {
    if (_starting)
        return "in_progress";
    if (await isUp())
        return "already_running";
    _starting = true;
    try {
        killPort(QWEN2API_PORT);
        await new Promise((r) => setTimeout(r, 1000));
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                qwenProc = spawn("bun", ["src/start.js"], {
                    cwd: QWEN2API_DIR,
                    stdio: "pipe",
                    detached: true,
                    env: { ...process.env, SERVICE_PORT: String(QWEN2API_PORT) },
                });
                qwenProc.unref();
                qwenProc.on("exit", (code) => {
                    log.warn(`⚠️ qwen2api 進程退出 (code=${code})`);
                    qwenProc = null;
                });
                const ok = await waitForPort(QWEN2API_PORT, QWEN2API_HOST, 30);
                if (ok && (await isUp()))
                    return "started";
            }
            catch (e) {
                log.warn(`qwen2api 啟動嘗試 ${attempt + 1} 失敗: ${e.message}`);
            }
            await new Promise((r) => setTimeout(r, 2000));
        }
        return "failed";
    }
    finally {
        _starting = false;
    }
};
// ─── 自動啟動 Chat Proxy ───
let proxyServer = null;
const autoStartProxy = async () => {
    if (_startingProxy)
        return "in_progress";
    if (await isProxyUp())
        return "already_running";
    _startingProxy = true;
    try {
        killPort(PROXY_PORT);
        await new Promise((r) => setTimeout(r, 1000));
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                proxyServer = await startProxy();
                proxyServer.on("close", () => {
                    log.warn(`⚠️ Chat Proxy 關閉`);
                    proxyServer = null;
                });
                return "started";
            }
            catch (e) {
                log.warn(`proxy 啟動嘗試 ${attempt + 1} 失敗: ${e.message}`);
            }
            await new Promise((r) => setTimeout(r, 2000));
        }
        return "failed";
    }
    finally {
        _startingProxy = false;
    }
};
// ─── 模式追蹤 ───
let mode = "proxy";
let proxyFailCount = 0;
const PROXY_FAIL_THRESHOLD = 3;
function recordProxyResult(success) {
    if (success) {
        if (proxyFailCount > 0)
            proxyFailCount = 0;
        if (mode === "direct") {
            mode = "proxy";
            log.info("🔄 自動切換回 Proxy 模式 (proxy 已恢復)");
        }
    }
    else {
        proxyFailCount++;
        if (proxyFailCount >= PROXY_FAIL_THRESHOLD && mode === "proxy") {
            mode = "direct";
            log.warn(`🔄 自動切換至 Direct 模式 (proxy 連續 ${proxyFailCount} 次失敗)`);
        }
    }
}
function getMode() {
    return mode;
}
// ─── 服務狀態追蹤 ───
let everSeenUp = false;
let svcDead = false;
// ─── 健康監控（30 秒間隔，降噪版） ───
// 只 WARN 狀態轉換（up→down, down→up, proxy down→up）
// 持續相同狀態不重複 WARN
let monitorTimer = null;
let _prevQUp = null; // null=unknown, true=up, false=down
let _prevPUp = null;
const startMonitor = () => {
    if (monitorTimer)
        return;
    log.info("🔄 啟動健康監控（30s 間隔）");
    monitorTimer = setInterval(async () => {
        try {
            const qUp = await isUp();
            // svcDead 但上游回來了 → 恢復
            if (svcDead && qUp) {
                svcDead = false;
                everSeenUp = true;
                log.info("✅ qwen2api 已恢復連線，重置服務狀態");
                const p = await autoStartProxy();
                log.info(`proxy 狀態: ${p}`);
                recordProxyResult(true);
                _prevQUp = true;
                _prevPUp = null;
                return;
            }
            if (!qUp) {
                // 只 WARN 一次：up → down 轉換
                if (_prevQUp !== false) {
                    if (everSeenUp) {
                        log.warn("⚠️ qwen2api 無回應，嘗試重啟...");
                    }
                    else {
                        log.debug("qwen2api 未啟動（尚未連線過）");
                    }
                    _prevQUp = false;
                }
                if (everSeenUp) {
                    autoStart()
                        .then((s) => {
                        if (s === "started" || s === "already_running")
                            _prevQUp = null;
                    })
                        .catch(() => { });
                }
                return;
            }
            // qwen2api up → 標記
            if (_prevQUp !== true) {
                if (_prevQUp === false)
                    log.info("✅ qwen2api 已恢復");
                _prevQUp = true;
            }
            everSeenUp = true;
            const pUp = await isProxyUp();
            recordProxyResult(pUp);
            if (!pUp) {
                if (_prevPUp !== false) {
                    log.warn("⚠️ Chat Proxy 無回應，嘗試重啟...");
                    _prevPUp = false;
                }
                autoStartProxy()
                    .then((s) => {
                    if (s === "started" || s === "already_running")
                        _prevPUp = null;
                })
                    .catch(() => { });
            }
            else if (_prevPUp !== true) {
                if (_prevPUp === false)
                    log.info("✅ Chat Proxy 已恢復");
                _prevPUp = true;
            }
        }
        catch (_) { }
    }, 30000);
};
const setIsDead = () => {
    svcDead = true;
    if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
    }
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
    if (!exists(localModules)) {
        try {
            fs.mkdirSync(localModules, { recursive: true });
            log.info(`已建立 node_modules: ${localModules}`);
        }
        catch (e) {
            log.error(`無法建立 node_modules: ${e.message}`);
            return;
        }
    }
    for (const dep of sharedDeps) {
        const resolved = resolvePackage(dep);
        const localPath = path.join(localModules, dep);
        if (exists(localPath)) {
            const real = safeRealpath(localPath);
            if (real && isDir(real)) {
                log.debug(`依賴 ${dep} 已存在`);
                continue;
            }
        }
        if (resolved) {
            try {
                fs.rmSync(localPath, { recursive: true, force: true });
                if (IS_WIN) {
                    fs.cpSync(resolved, localPath, { recursive: true });
                    log.info(`✓ 已複製 ${dep}`);
                }
                else {
                    fs.symlinkSync(resolved, localPath, "junction");
                    log.info(`✓ 已連結 ${dep}`);
                }
            }
            catch (e) {
                log.error(`✗ 修復 ${dep} 失敗: ${e.message}`);
            }
        }
        else {
            log.warn(`⚠️ 無法找到 ${dep} 的來源路徑`);
        }
    }
    const missingDeps = sharedDeps.filter((dep) => {
        const lp = path.join(localModules, dep);
        return !exists(lp) || !isDir(lp);
    });
    if (missingDeps.length > 0) {
        log.warn(`npm install 缺失依賴: ${missingDeps.join(", ")}`);
        try {
            execSync(`${IS_WIN ? "npm.cmd" : "npm"} install ${missingDeps.join(" ")}`, {
                cwd: PLUGIN_DIR,
                stdio: "pipe",
                timeout: 60000,
            });
            log.info("✓ npm install 完成");
        }
        catch (e) {
            log.error(`npm install 失敗: ${e.message}`);
        }
    }
}
// ─── MCP 工具呼叫包裝 ───
// 永不拋錯、永不回傳 null，失敗回傳描述性字串讓模型理解
const mcpCall = async (name, args) => {
    if (mode === "direct") {
        return `[${name}] Proxy 降級模式（${proxyFailCount} 次失敗），等待自動恢復`;
    }
    if (svcDead) {
        return `[${name}] qwen2api 服務未啟動，監控持續檢查中`;
    }
    const r = await proxyPost("/mcp", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
    });
    if (!r || r._error) {
        log.debug(`MCP 呼叫失敗: ${name}${r?.message ? " - " + r.message : ""}`);
        if (mode === "proxy") {
            recordProxyResult(false);
        }
        return `[${name}] ${r?.message || "服務無回應"}`;
    }
    recordProxyResult(true);
    return r?.result?.content?.[0]?.text || "";
};
const mcpCallJSON = async (name, args) => {
    const text = await mcpCall(name, args);
    if (!text || text.startsWith("["))
        return { error: text };
    try {
        return JSON.parse(text);
    }
    catch {
        return { error: text };
    }
};
// ─── Plugin ───
const Plugin = async (ctx) => {
    const depCheck = checkAndRepair();
    if (!depCheck.ok) {
        log.warn("⚠️ 共享依賴檢查發現問題:");
        depCheck.issues.forEach((i) => log.warn(`  - ${i}`));
        await autoRepairDeps();
    }
    (async () => {
        try {
            const u = await isUp();
            if (u) {
                everSeenUp = true;
                const p = await autoStartProxy();
                log.info(`qwen2api: running / proxy: ${p}`);
                try {
                    const h = await get("/health");
                    if (h?.accounts?.valid === 0)
                        log.warn("⚠️ 無有效 Token，請執行 auto-get-token.js");
                }
                catch (_) { }
            }
            else {
                svcDead = true;
                log.debug("qwen2api 未啟動 — monitor 持續檢查恢復");
            }
        }
        catch (_) {
            svcDead = true;
        }
        startMonitor();
    })();
    return {
        tool: {
            qwen_read: tool({
                description: "透過 Qwen2API 讀取檔案內容。支援 Windows 絕對路徑。",
                args: { filePath: tool.schema.string().describe("檔案絕對路徑") },
                async execute(args) {
                    return await mcpCall("read", args);
                },
            }),
            qwen_write: tool({
                description: "寫入/建立檔案。目錄不存在時自動建立。",
                args: {
                    filePath: tool.schema.string().describe("檔案絕對路徑"),
                    content: tool.schema.string().describe("要寫入的內容"),
                },
                async execute(args) {
                    return await mcpCall("write", args);
                },
            }),
            qwen_edit: tool({
                description: "編輯檔案：尋找並取代文字。",
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
                description: "搜尋檔案。支援 **/*.java 等通配符。",
                args: {
                    pattern: tool.schema.string().describe("檔案匹配模式"),
                    path: tool.schema.string().optional().describe("搜尋根目錄（選填）"),
                },
                async execute(args) {
                    return await mcpCall("glob", args);
                },
            }),
            qwen_grep: tool({
                description: "在檔案中搜尋文字內容。",
                args: {
                    pattern: tool.schema.string().describe("搜尋正則表達式"),
                    path: tool.schema.string().optional().describe("搜尋路徑（選填）"),
                    include: tool.schema
                        .string()
                        .optional()
                        .describe("檔案過濾模式（選填）"),
                },
                async execute(args) {
                    return await mcpCall("grep", args);
                },
            }),
            qwen_bash: tool({
                description: "執行 shell 命令。可用於編譯、執行腳本、查看目錄。",
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
                description: "讀取指定技能的完整內容。",
                args: { skill: tool.schema.string().describe("技能名稱") },
                async execute(args) {
                    return await mcpCall("skill_read", { skill: args.skill });
                },
            }),
            qwen_wiki_search: tool({
                description: "搜尋 opencode 知識庫/維基。",
                args: { query: tool.schema.string().describe("搜尋關鍵字") },
                async execute(args) {
                    const d = await mcpCallJSON("wiki_search", { query: args.query });
                    if (!d.total)
                        return "⚠️ 無匹配結果";
                    return `📖 **維基搜尋結果** (${d.total} 項)\n${(d.results || []).map((e, i) => `${i + 1}. **${e.title}** [${e.category}]`).join("\n")}`;
                },
            }),
            qwen_wiki_read: tool({
                description: "讀取指定維基頁面完整內容。",
                args: { title: tool.schema.string().describe("維基頁面標題") },
                async execute(args) {
                    return await mcpCall("wiki_read", { title: args.title });
                },
            }),
            qwen_memory: tool({
                description: "查詢 opencode 記憶系統。",
                args: {
                    query: tool.schema.string().optional().describe("搜尋關鍵字（選填）"),
                },
                async execute(args) {
                    const d = await mcpCallJSON("memory_query", {
                        query: args.query || "",
                    });
                    return `🧠 **記憶系統**\n總檔案: ${d.total || 0}\n匹配: ${d.matched || 0}\n${(d.files || [])
                        .slice(0, 15)
                        .map((f) => `  📄 ${f}`)
                        .join("\n")}`;
                },
            }),
            qwen_health: tool({
                description: "檢查 Qwen2API 服務健康狀態。",
                args: {},
                async execute() {
                    if (svcDead)
                        return "Qwen2API 服務未啟動";
                    const h = await get("/health");
                    if (!h || h._error)
                        return "Qwen2API 服務未啟動";
                    const modeLabel = mode === "direct" ? "🔶 Direct（降級）" : "✅ Proxy（正常）";
                    return [
                        `📊 **Qwen2API 狀態**`,
                        `  模式: ${modeLabel}`,
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
                description: "執行 Qwen2API 自我修復。",
                args: {},
                async execute() {
                    if (svcDead)
                        return "Qwen2API 服務未啟動";
                    const r = await post("/health/repair", {});
                    if (!r || r._error)
                        return "Qwen2API 服務未啟動";
                    return `🔧 **自我修復完成**\n${(r.repairs || []).map((x) => `  • ${x.action}: ${x.status === "success" ? "✅" : "❌"} ${x.detail || ""}`).join("\n")}`;
                },
            }),
            qwen_token: tool({
                description: "檢查 Token 狀態。",
                args: {},
                async execute() {
                    if (svcDead)
                        return "Qwen2API 服務未啟動";
                    const h = await get("/health");
                    if (!h || h._error)
                        return "Qwen2API 服務未啟動";
                    const a = h.accounts || {};
                    const expired = a.expired || 0;
                    let msg = `🔑 **Token 狀態**\n有效帳戶: ${a.valid}/${a.total}\n`;
                    if (a.total === 0)
                        msg += "⚠️ 尚未設定任何帳戶\n";
                    if (expired > 0)
                        msg += `❌ ${expired} 個 Token 已過期\n`;
                    msg += `\n💡 更新 Token: \`bun ${QWEN2API_DIR}/auto-get-token.js\``;
                    return msg;
                },
            }),
            qwen_diagnose: tool({
                description: "完整診斷，自動檢查所有已知問題。",
                args: {},
                async execute() {
                    if (svcDead)
                        return "Qwen2API 服務未啟動";
                    const d = await post("/repair/diagnose", {});
                    if (!d || d._error)
                        return "Qwen2API 服務未啟動";
                    let msg = `🔍 **診斷報告**\n狀態: ${d.status}\n\n`;
                    if (d.issues?.length > 0) {
                        msg += `**發現 ${d.issues.length} 個問題:**\n`;
                        d.issues.forEach((i) => {
                            const icon = i.severity === "critical"
                                ? "🔴"
                                : i.severity === "warning"
                                    ? "🟡"
                                    : "🔵";
                            msg += `${icon} [${i.severity}] ${i.issue}\n  ${i.detail}\n`;
                        });
                        msg += `\n**建議修復:**\n`;
                        d.fixes.forEach((f) => (msg += `  • ${f.action}: \`${f.cmd || f.endpoint}\`\n`));
                        if (d.autoRepair) {
                            msg += `\n**自動修復結果:**\n`;
                            d.autoRepair.forEach((r) => (msg += `  ${r.status === "success" ? "✅" : "❌"} ${r.action}\n`));
                        }
                    }
                    else {
                        msg += "✅ 未發現問題\n";
                    }
                    return msg;
                },
            }),
            qwen_proxy_status: tool({
                description: "檢查 Chat Proxy 狀態。",
                args: {},
                async execute() {
                    const h = await proxyGet("/health", 5000);
                    const up = h?.proxy === "running";
                    const modeMap = mode === "direct" ? "🔶 Direct（降級中）" : "✅ Proxy（正常）";
                    const lines = [
                        `🌐 **Chat Proxy 狀態**`,
                        `  模式: ${modeMap}`,
                        `  狀態: ${up ? "✅ 運行中" : "❌ 未啟動"}`,
                        `  Port: ${PROXY_PORT}`,
                        `  連續失敗: ${proxyFailCount}/${PROXY_FAIL_THRESHOLD}`,
                        up
                            ? `  Routing: ${h.routing?.enabled ? "✅ 啟用" : "❌ 停用"}`
                            : null,
                        up && h.routing?.detected
                            ? `  模型: ${h.routing.detected.small}s / ${h.routing.detected.medium}m / ${h.routing.detected.large}l`
                            : null,
                        up ? `  Upstream: ${h.upstream}` : null,
                    ].filter(Boolean);
                    if (mode === "direct") {
                        lines.push(``, `💡 Direct 降級模式：Proxy 恢復後自動切回正常模式。`);
                    }
                    return lines.join("\n");
                },
            }),
            qwen_repair_manual: tool({
                description: "讀取維修手冊。",
                args: {
                    issue: tool.schema.string().optional().describe("問題 ID（選填）"),
                },
                async execute(args) {
                    if (svcDead)
                        return "Qwen2API 服務未啟動";
                    const m = await get("/repair/manual");
                    if (!m || m._error)
                        return "Qwen2API 服務未啟動";
                    if (args.issue) {
                        const issue = m.knownIssues?.find((i) => i.id === args.issue || i.title.includes(args.issue));
                        if (!issue)
                            return `⚠️ 找不到問題: ${args.issue}`;
                        return `📖 **${issue.title}**\n症狀: ${issue.symptom}\n診斷: \`${issue.diagnose}\`\n修復: \`${issue.fix}\`\n自動修復: ${issue.autoFix ? "✅ 支援" : "❌ 需手動"}`;
                    }
                    return [
                        `📖 **Qwen2API 維修手冊 v${m.version}**`,
                        `平台: ${m.platform}`,
                        `位置: ${m.service.location}`,
                        `啟動: \`${m.service.startCmd}\``,
                        `**已知問題 (${m.knownIssues?.length || 0} 項):**`,
                        ...(m.knownIssues || []).map((i) => `  • \`${i.id}\`: ${i.title} ${i.autoFix ? "✅" : "🔶"}`),
                    ].join("\n");
                },
            }),
        },
        event: async ({ event }) => {
            if (!everSeenUp || svcDead)
                return;
            if (event?.type?.includes("error") || event?.name === "Service.Error") {
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
                    }
                    catch (_) { }
                })();
            }
        },
        config: async () => { },
    };
};
export default Plugin;
export { Plugin };
//# sourceMappingURL=index.js.map