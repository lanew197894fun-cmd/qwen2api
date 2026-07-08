/**
 * self-learning.js — 自我學習系統核心模組
 *
 * 學習用戶程式碼風格、回應偏好、解決方案偏好。
 * 儲存於 ~/.opencode/models/，支援 Level 1-3 學習層級。
 *
 * 整合於 qwen2api-plugin 提供：
 * • learnCodeStyle(projectPath)    — 分析專案程式碼風格
 * • learnResponseStyle()           — 學習回應偏好
 * • learnProblemSolving(tools)     — 學習解決方案偏好
 * • recordInteraction()            — 記錄每次互動
 * • getLearningMetrics()           — 查詢學習進度
 * • resetLearningData()            — 重置學習資料
 * • exportModel() / importModel()  — 匯出/匯入個人化模型
 * • getPersonalRecommendation()    — 取得個人化推薦
 */
import fs from "node:fs";
import path from "node:path";
import { OPENCODE_DIR } from "./config/paths.js";
// ─── 路徑常數（集中管理，跨裝置相容）───
const BASE = path.join(OPENCODE_DIR, "models");
const DIRS = {
    style: path.join(BASE, "style"),
    knowledge: path.join(BASE, "knowledge"),
    behavior: path.join(BASE, "behavior"),
    finetune: path.join(BASE, "fine-tuned", "personal-model"),
    shadow: path.join(BASE, "shadow-examples"), // ⚠️ 已棄用：影子範例已遷移至核心蒸餾系統（Distillation）
};
const METRICS_FILE = path.join(BASE, "metrics.json");
const CONFIG_FILE = path.join(BASE, "config.json");
// ─── 預設配置 ───
const DEFAULTS = {
    level2At: 10,
    level3At: 100,
    learningConsent: true,
    dataRetention: 30,
    allowCloudSync: false,
    autoLearnCodeStyle: true,
    autoLearnResponseStyle: true,
    autoRecordTools: true,
    responseLang: "zh-TW",
    responseVerbosity: 3,
    proLevel: 3,
    personality: "",
    customPrompt: "",
    autoPersona: false,
    traits: {
        warmth: 3, // 1=冷靜客觀  5=溫暖貼心
        proactive: 3, // 1=被動回應  5=主動積極
        depth: 3, // 1=簡潔淺顯  5=深入詳盡
        patience: 3, // 1=直接簡短  5=耐心反覆
        humor: 2, // 1=完全嚴肅  5=輕鬆幽默
    },
    skipDirs: [
        "node_modules",
        ".git",
        "dist",
        "build",
        ".next",
        ".cache",
        "__pycache__",
        ".venv",
        "venv",
        ".idea",
        ".vscode",
        "coverage",
        ".nyc_output",
        ".turbo",
        ".svelte-kit",
        ".vercel",
    ],
    skipExts: [
        ".jpg",
        ".png",
        ".gif",
        ".svg",
        ".ico",
        ".woff",
        ".woff2",
        ".eot",
        ".ttf",
        ".otf",
        ".mp4",
        ".mov",
        ".avi",
        ".pdf",
        ".zip",
        ".tar",
        ".gz",
        ".lock",
        ".map",
    ],
};
// ─── 配置管理 ───
let cfgCache = null;
const loadCfg = () => {
    if (cfgCache)
        return cfgCache;
    const saved = read(CONFIG_FILE);
    cfgCache = { ...DEFAULTS, ...saved };
    return cfgCache;
};
const saveCfg = (updates) => {
    const cur = loadCfg();
    Object.assign(cur, updates);
    cfgCache = cur;
    write(CONFIG_FILE, cur);
    // 同步更新 SKIP 集合（讓學習分析使用自訂目錄）
    if (updates.skipDirs) {
        SKIP.clear();
        for (const d of cur.skipDirs)
            SKIP.add(d);
    }
    if (updates.skipExts) {
        SKIP_EXT.clear();
        for (const e of cur.skipExts)
            SKIP_EXT.add(e);
    }
    return cur;
};
/**
 * 取得當前配置
 * @returns {object}
 */
export const getConfig = () => loadCfg();
/**
 * 更新配置（只傳要改的欄位）
 * @param {object} updates - 要更新的欄位
 * @returns {{ config: object, changed: string[] }}
 */
export const updateConfig = (updates) => {
    const allowed = new Set(Object.keys(DEFAULTS));
    const changed = [];
    const filtered = {};
    for (const [k, v] of Object.entries(updates)) {
        if (allowed.has(k)) {
            filtered[k] = v;
            changed.push(k);
        }
    }
    if (!changed.length)
        return { config: loadCfg(), changed: [] };
    const cfg = saveCfg(filtered);
    return { config: cfg, changed };
};
// ─── 工具函數 ───
const ensure = (dir) => {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
};
const initDirs = () => {
    for (const d of Object.values(DIRS))
        ensure(d);
};
const read = (fp) => {
    try {
        if (!fs.existsSync(fp))
            return null;
        return JSON.parse(fs.readFileSync(fp, "utf-8"));
    }
    catch {
        return null;
    }
};
const write = (fp, data) => {
    ensure(path.dirname(fp));
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
};
// ─── 掃描檔案（跳過目錄/副檔名，可透過配置自訂） ───
const SKIP = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    ".cache",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
    "coverage",
    ".nyc_output",
    ".turbo",
    ".svelte-kit",
    ".vercel",
    ".serverless",
]);
const SKIP_EXT = new Set([
    ".jpg",
    ".png",
    ".gif",
    ".svg",
    ".ico",
    ".woff",
    ".woff2",
    ".eot",
    ".ttf",
    ".otf",
    ".mp4",
    ".mov",
    ".avi",
    ".pdf",
    ".zip",
    ".tar",
    ".gz",
    ".lock",
    ".map",
]);
// 🐛 FIX: 限制最大掃描檔案數，避免大型專案導致阻塞
const MAX_SCAN_FILES = 500;
const scan = (root) => {
    const files = [];
    const walk = (dir) => {
        if (files.length >= MAX_SCAN_FILES)
            return; // 提前退出
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            if (files.length >= MAX_SCAN_FILES)
                return; // 檢查限制
            if (SKIP.has(e.name) || e.name.startsWith("."))
                continue;
            const fp = path.join(dir, e.name);
            if (e.isDirectory())
                walk(fp);
            else if (e.isFile()) {
                const ext = path.extname(e.name).toLowerCase();
                if (!SKIP_EXT.has(ext))
                    files.push(fp);
            }
        }
    };
    walk(root);
    return files;
};
// ─── 學習層級 ───
const LV = ["", "行為記錄", "模式識別", "模型微調"];
// ─── 指標管理 ───
class Metrics {
    constructor() {
        this.d = this._load() || this._init();
    }
    _init() {
        return {
            level: 1,
            dataPoints: 0,
            accuracy: 0,
            improvements: [],
            nextMilestone: "收集 10 筆互動後進行模式識別",
            interactions: { accepted: 0, edited: 0, rejected: 0 },
            stalls: { total: 0, timeouts: 0, stallRate: 0 },
            lastUpdated: Date.now(),
        };
    }
    _load() {
        const raw = read(METRICS_FILE);
        if (!raw)
            return null;
        // 資料遷移：確保所有必要欄位存在（相容舊版 schema）
        if (!raw.stalls)
            raw.stalls = { total: 0, timeouts: 0, stallRate: 0 };
        if (!raw.interactions)
            raw.interactions = { accepted: 0, edited: 0, rejected: 0 };
        if (typeof raw.dataPoints !== "number")
            raw.dataPoints = 0;
        return raw;
    }
    save() {
        this.d.lastUpdated = Date.now();
        write(METRICS_FILE, this.d);
    }
    get() {
        return this.d;
    }
    record(feedback, stallType) {
        const d = this.d;
        if (feedback === "accepted")
            d.interactions.accepted++;
        else if (feedback === "edited")
            d.interactions.edited++;
        else if (feedback === "rejected")
            d.interactions.rejected++;
        if (stallType === "timeout")
            d.stalls.timeouts++;
        if (stallType === "stall" || stallType === "timeout")
            d.stalls.total++;
        d.stalls.stallRate =
            d.dataPoints > 0
                ? +((d.stalls.total / d.dataPoints) * 100).toFixed(1)
                : 0;
        d.dataPoints =
            d.interactions.accepted + d.interactions.edited + d.interactions.rejected;
        d.accuracy =
            d.dataPoints > 0
                ? +((d.interactions.accepted + d.interactions.edited * 0.5) /
                    d.dataPoints).toFixed(2)
                : 0;
        this._adv();
    }
    _adv() {
        const d = this.d;
        const prev = d.level;
        const cfg = loadCfg();
        if (!cfg.learningConsent)
            return;
        if (d.dataPoints >= cfg.level3At)
            d.level = 3;
        else if (d.dataPoints >= cfg.level2At)
            d.level = 2;
        if (d.level > prev) {
            d.improvements.push(`升級至 Level ${d.level}: ${LV[d.level]}`);
            d.nextMilestone =
                d.level === 3
                    ? "已達最高等級 🎉 持續收集以提升準確度"
                    : `${cfg.level3At - d.dataPoints} 筆互動後進行 Level 3（模型微調）`;
        }
    }
}
// ─── 命名分析 ───
const RE = {
    camel: /\b[a-z][a-zA-Z0-9]+\b/g,
    snake: /\b[a-z]+(_[a-z0-9]+)+\b/g,
    pascal: /\b[A-Z][a-zA-Z0-9]+\b/g,
};
const analyzeNaming = (lines) => {
    let camel = 0, snake = 0, pascal = 0;
    for (const line of lines) {
        if (line.trim().startsWith("//") ||
            line.trim().startsWith("#") ||
            line.trim().startsWith("/*") ||
            line.trim().startsWith("*"))
            continue;
        camel += (line.match(RE.camel) || []).length;
        snake += (line.match(RE.snake) || []).length;
        pascal += (line.match(RE.pascal) || []).length;
    }
    const total = camel + snake + pascal || 1;
    return {
        camelCase: +((camel / total) * 100).toFixed(1),
        snake_case: +((snake / total) * 100).toFixed(1),
        PascalCase: +((pascal / total) * 100).toFixed(1),
    };
};
// ─── 縮排分析 ───
const analyzeIndent = (lines) => {
    let s2 = 0, s4 = 0, tabs = 0;
    for (const line of lines) {
        if (!line.trim())
            continue;
        if (line.startsWith("\t"))
            tabs++;
        else {
            const m = line.match(/^( +)/);
            if (m) {
                if (m[1].length % 2 === 0)
                    s2++;
                else
                    s4++;
            }
        }
    }
    const total = s2 + s4 + tabs || 1;
    return {
        spaces2: +((s2 / total) * 100).toFixed(1),
        spaces4: +((s4 / total) * 100).toFixed(1),
        tabs: +((tabs / total) * 100).toFixed(1),
    };
};
// ─── 錯誤處理分析 ───
const analyzeError = (content) => {
    const tc = (content.match(/try\s*\{/g) || []).length;
    const er = (content.match(/\b(if\s*\(.*\)\s*\{?\s*return\s+)/g) || []).length;
    const total = tc + er || 1;
    return {
        tryCatch: tc,
        earlyReturn: er,
        ratio: +((tc / total) * 100).toFixed(1),
    };
};
// ─── 註解分析 ───
const analyzeComments = (lines) => {
    let single = 0, multi = 0, inBlock = false;
    for (const line of lines) {
        const t = line.trim();
        if (inBlock) {
            multi++;
            if (t.includes("*/"))
                inBlock = false;
            continue;
        }
        if (t.startsWith("//") || t.startsWith("#"))
            single++;
        else if (t.startsWith("/*") || t.startsWith("/**")) {
            multi++;
            if (!t.includes("*/"))
                inBlock = true;
        }
    }
    return { single, multi, total: single + multi };
};
// ─── 引入分析 ───
const analyzeImport = (content) => {
    const esm = (content.match(/import\s+.*from\s+/g) || []).length;
    const cjs = (content.match(/require\s*\(/g) || []).length;
    return { esm, cjs };
};
// ═══════════════════════════════════════════════
// 公開 API
// ═══════════════════════════════════════════════
/**
 * 分析專案程式碼風格
 * @param {string} projectPath - 專案路徑
 * @returns {object} 風格統計
 */
// 🐛 FIX: 限制單次分析最大行數，避免記憶體爆炸與長時間卡頓
const MAX_ANALYSIS_LINES = 50000;
export const learnCodeStyle = async (projectPath) => {
    initDirs();
    if (!fs.existsSync(projectPath))
        return { error: `路徑不存在: ${projectPath}` };
    const files = scan(projectPath);
    if (!files.length)
        return { error: `${projectPath} 下無可分析的檔案` };
    let allContent = "";
    const codeLines = [];
    let totalChars = 0;
    // 🐛 FIX: 加入早期退出機制，避免讀取過多檔案導致超時
    for (const fp of files) {
        if (codeLines.length >= MAX_ANALYSIS_LINES)
            break;
        try {
            const c = fs.readFileSync(fp, "utf-8");
            // 限制單檔大小，避免單一巨大檔案卡住
            if (c.length > 1024 * 1024)
                continue; // 跳過 >1MB 檔案
            allContent += c + "\n";
            const lines = c.split("\n");
            codeLines.push(...lines);
            totalChars += c.length;
            // 若總字元數超過 2MB，提前退出
            if (totalChars > 2 * 1024 * 1024)
                break;
        }
        catch {
            /* 跳過二進位或無法讀取的檔案 */
        }
    }
    if (!codeLines.length)
        return { error: "無可分析的有效內容" };
    const naming = analyzeNaming(codeLines);
    const indent = analyzeIndent(codeLines);
    const error = analyzeError(allContent);
    const comments = analyzeComments(codeLines);
    const imports = analyzeImport(allContent);
    const result = {
        naming,
        indent,
        errorHandling: error,
        comments,
        imports,
        totalFiles: files.length,
        totalLines: codeLines.length,
        analyzedAt: new Date().toISOString(),
    };
    write(path.join(DIRS.style, "code-style.json"), result);
    return result;
};
/**
 * 學習回應風格偏好
 * @param {Array<{content?: string}>} [interactions=[]] - 互動記錄
 * @returns {object} 偏好總結
 */
export const learnResponseStyle = (interactions = []) => {
    initDirs();
    const prefs = read(path.join(DIRS.behavior, "preferences.json")) || {
        responseLength: { short: 0, medium: 0, long: 0 },
        language: "zh-TW",
        codeBlockUsage: 0,
        explanationDepth: 0,
        totalInteractions: 0,
    };
    for (const m of interactions) {
        const content = m.content || "";
        const len = content.length;
        if (len < 100)
            prefs.responseLength.short++;
        else if (len < 500)
            prefs.responseLength.medium++;
        else
            prefs.responseLength.long++;
        prefs.totalInteractions++;
        const blocks = (content.match(/```/g) || []).length;
        if (blocks > 0)
            prefs.codeBlockUsage++;
    }
    const total = prefs.responseLength.short +
        prefs.responseLength.medium +
        prefs.responseLength.long;
    prefs.explanationDepth =
        total > 0
            ? +((prefs.responseLength.medium * 2 + prefs.responseLength.long * 3) /
                total).toFixed(2)
            : 0;
    write(path.join(DIRS.behavior, "preferences.json"), prefs);
    write(path.join(DIRS.style, "response-style.json"), prefs);
    return prefs;
};
/**
 * 學習解決方案偏好
 * @param {string[]} [tools=[]] - 使用的工具名稱列表
 * @returns {object} 工具使用統計
 */
export const learnProblemSolving = (tools = []) => {
    initDirs();
    const profile = read(path.join(DIRS.behavior, "preferences.json")) || {};
    const counts = profile.toolUsage || {};
    for (const t of tools) {
        counts[t] = (counts[t] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5).map(([k]) => k);
    const result = {
        topTools: top,
        toolUsage: counts,
        updatedAt: new Date().toISOString(),
    };
    profile.toolUsage = counts;
    write(path.join(DIRS.behavior, "preferences.json"), profile);
    write(path.join(DIRS.knowledge, "project-knowledge.json"), result);
    return result;
};
/**
 * 記錄一次互動與反饋（含路由效能元數據）
 * @param {string} prompt - 用戶提示
 * @param {string} response - 回應內容
 * @param {'accepted'|'edited'|'rejected'} feedback - 反饋
 * @param {object} meta - 元數據（modelUsed, routingScore, taskType, latencyMs, isCognitive, shadowCompared）
 * @returns {object} 更新後的指標
 */
export const recordInteraction = (prompt, response, feedback = "accepted", meta = {}) => {
    initDirs();
    const m = new Metrics();
    // 停滯偵測：高 latency 或 timeout 視為停滯事件
    const isStall = meta.isTimeout === true;
    const isSlow = !isStall && (meta.latencyMs || 0) > 30000; // >30s 但非 timeout 視為慢回應
    const log = {
        ts: new Date().toISOString(),
        prompt: (prompt || "").slice(0, 200),
        responseLen: (response || "").length,
        feedback,
        modelUsed: meta.modelUsed || "unknown",
        routingScore: meta.routingScore || null,
        taskType: meta.taskType || "general",
        latencyMs: meta.latencyMs || 0,
        isCognitive: meta.isCognitive || false,
        shadowCompared: meta.shadowCompared || false,
        isStall: isStall,
        isSlow: isSlow,
    };
    const logFile = path.join(DIRS.behavior, "interactions.jsonl");
    fs.appendFileSync(logFile, JSON.stringify(log) + "\n", "utf-8");
    const stallType = isStall ? "timeout" : isSlow ? "stall" : null;
    m.record(feedback, stallType);
    m.save();
    return m.get();
};
/**
 * 記錄停滯事件（供外面直接呼叫，不經過完整互動記錄）
 * @param {object} info - { model, latencyMs, isTimeout, taskType, prompt }
 */
export const recordStallEvent = (info = {}) => {
    initDirs();
    const m = new Metrics();
    const log = {
        ts: new Date().toISOString(),
        type: info.isTimeout ? "timeout" : "stall",
        model: info.model || "unknown",
        latencyMs: info.latencyMs || 0,
        taskType: info.taskType || "general",
        prompt: (info.prompt || "").slice(0, 100),
    };
    const logFile = path.join(DIRS.behavior, "stalls.jsonl");
    fs.appendFileSync(logFile, JSON.stringify(log) + "\n", "utf-8");
    const stallType = info.isTimeout ? "timeout" : "stall";
    m.record("rejected", stallType);
    m.save();
    return m.get();
};
/**
 * 取得停滯統計摘要
 * @returns {{ total: number, timeouts: number, stallRate: number, perModel: object }}
 */
export const getStallStats = () => {
    const m = new Metrics();
    const stallFile = path.join(DIRS.behavior, "stalls.jsonl");
    const perModel = {};
    let total = 0;
    let timeouts = 0;
    if (fs.existsSync(stallFile)) {
        try {
            const raw = fs.readFileSync(stallFile, "utf-8");
            for (const line of raw.trim().split("\n").filter(Boolean)) {
                try {
                    const e = JSON.parse(line);
                    total++;
                    if (e.type === "timeout")
                        timeouts++;
                    const mod = e.model || "unknown";
                    if (!perModel[mod])
                        perModel[mod] = { total: 0, timeouts: 0, stalls: 0 };
                    perModel[mod].total++;
                    if (e.type === "timeout")
                        perModel[mod].timeouts++;
                    else
                        perModel[mod].stalls++;
                }
                catch { }
            }
        }
        catch { }
    }
    return {
        total,
        timeouts,
        stallRate: total > 0 ? +((total / m.get().dataPoints) * 100).toFixed(1) : 0,
        perModel,
    };
};
/**
 * 查詢學習進度
 * @returns {object} 完整學習狀態
 */
export const getLearningMetrics = () => {
    const m = new Metrics();
    return {
        metrics: m.get(),
        codeStyle: read(path.join(DIRS.style, "code-style.json")),
        responseStyle: read(path.join(DIRS.style, "response-style.json")),
        knowledge: read(path.join(DIRS.knowledge, "project-knowledge.json")),
        preferences: read(path.join(DIRS.behavior, "preferences.json")),
        stalls: getStallStats(),
    };
};
/**
 * 重置所有學習資料
 * @returns {{ status: string }}
 */
export const resetLearningData = () => {
    for (const d of Object.values(DIRS)) {
        if (fs.existsSync(d))
            fs.rmSync(d, { recursive: true, force: true });
    }
    initDirs();
    const m = new Metrics();
    m.save();
    return { status: "已清空所有學習資料" };
};
/**
 * 匯出個人化模型
 * @param {string} [outPath] - 匯出路徑（預設 ~/.opencode/models/export/）
 * @returns {{ path: string, size: number }}
 */
export const exportModel = (outPath) => {
    const data = getLearningMetrics();
    const exportDir = outPath || path.join(BASE, "export");
    ensure(exportDir);
    const fp = path.join(exportDir, `personal-model-${Date.now()}.json`);
    write(fp, data);
    return { path: fp, size: JSON.stringify(data).length };
};
/**
 * 匯入個人化模型
 * @param {string} filePath - 模型檔案路徑
 * @returns {{ status: string, dataPoints: number }|{ error: string }}
 */
export const importModel = (filePath) => {
    if (!fs.existsSync(filePath))
        return { error: `檔案不存在: ${filePath}` };
    const data = read(filePath);
    if (!data)
        return { error: "無效的模型檔案（無法解析 JSON）" };
    // 驗證並寫入各區塊
    if (data.metrics)
        write(METRICS_FILE, data.metrics);
    if (data.codeStyle)
        write(path.join(DIRS.style, "code-style.json"), data.codeStyle);
    if (data.responseStyle)
        write(path.join(DIRS.style, "response-style.json"), data.responseStyle);
    if (data.knowledge)
        write(path.join(DIRS.knowledge, "project-knowledge.json"), data.knowledge);
    if (data.preferences)
        write(path.join(DIRS.behavior, "preferences.json"), data.preferences);
    const pts = data.metrics?.dataPoints || 0;
    return { status: "已匯入個人化模型", dataPoints: pts };
};
/**
 * 取得個人化推薦
 * @returns {{
 *   codeStyle: { naming: string, indent: number },
 *   tools: string[],
 *   strategy: string,
 *   confidence: number
 * }}
 */
export const getPersonalRecommendation = () => {
    const codeStyle = read(path.join(DIRS.style, "code-style.json"));
    const prefs = read(path.join(DIRS.behavior, "preferences.json"));
    const m = new Metrics();
    const met = m.get();
    let naming = "camelCase";
    if (codeStyle?.naming) {
        const n = codeStyle.naming;
        naming =
            n.camelCase >= n.snake_case && n.camelCase >= n.PascalCase
                ? "camelCase"
                : n.snake_case >= n.camelCase && n.snake_case >= n.PascalCase
                    ? "snake_case"
                    : "PascalCase";
    }
    let indent = 2;
    if (codeStyle?.indent) {
        const i = codeStyle.indent;
        indent =
            i.spaces4 > i.spaces2 && i.spaces4 > i.tabs
                ? 4
                : i.tabs > i.spaces2 && i.tabs > i.spaces4
                    ? -1
                    : 2;
    }
    const tools = prefs?.toolUsage
        ? Object.entries(prefs.toolUsage)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([k]) => k)
        : [];
    const strategy = codeStyle?.errorHandling?.tryCatch > codeStyle?.errorHandling?.earlyReturn
        ? "try-catch"
        : "early-return";
    return {
        codeStyle: { naming, indent },
        tools,
        strategy,
        confidence: met.accuracy,
    };
};
/**
 * 讀取儲存的互動記錄
 * @returns {Array<{ts: string, prompt: string, responseLen: number, feedback: string}>}
 */
export const getInteractions = () => {
    const logFile = path.join(DIRS.behavior, "interactions.jsonl");
    if (!fs.existsSync(logFile))
        return [];
    try {
        const raw = fs.readFileSync(logFile, "utf-8");
        return raw
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => {
            try {
                return JSON.parse(l);
            }
            catch {
                return null;
            }
        })
            .filter(Boolean);
    }
    catch {
        return [];
    }
};
// ═══════════════════════════════════════════════
// 影子模式（Shadow Mode）— 已遷移至核心蒸餾系統
// ═══════════════════════════════════════════════
//
// ⚠️ 已棄用（DEPRECATED）：影子範例功能已移至 OpenCode 核心蒸餾系統
//    （projects/system/packages/opencode/src/distillation/）
//    使用 LanceDB 向量搜尋取代檔案式關鍵字比對，提供：
//    • 語義向量召回（取代關鍵字比對）
//    • Provider 插拔式儲存後端（LanceDB / 檔案式備援）
//    • Bus 訂閱 compaction 事件自動捕捉
//    當 memory-lancedb-pro 已註冊時，直接使用其 globalThis 上的 Provider，
//    無需動態 import 核心模組，路徑無關，更可靠。
//
//    保留以下函數僅供向下相容，新程式碼請勿使用。
// ============================================================================
/** ShadowStoreRegistry 的 globalThis key，與核心蒸餾系統一致 */
const GLOBAL_SHADOW_KEY = "__opencode_shadow_store_provider__";
/**
 * 取得已註冊的影子儲存 Provider（memory-lancedb-pro 初始化時註冊）
 * 等同於核心 ShadowStoreRegistry.get()，避免動態 import 的路徑依賴。
 */
function getShadowProvider() {
    try {
        return /** @type {import("../../../../system/packages/opencode/src/distillation/provider").IShadowStoreProvider | undefined} */ (globalThis[ /** @type {keyof typeof globalThis} */(GLOBAL_SHADOW_KEY)]);
    }
    catch {
        return undefined;
    }
}
/**
 * 儲存影子範例（大模型的黃金標準回應）
 *
 * @deprecated 已棄用，請改用 OpenCode 蒸餾系統的 Distillation.storeShadow()
 *             見 projects/system/packages/opencode/src/distillation/
 * @param {string} prompt - 用戶提示
 * @param {string} shadowResponse - 大模型生成的優質回應
 * @param {object} meta - 元數據（modelUsed, taskType, similarityScore）
 * @returns {{ status: string, id: string }}
 */
export const storeShadowExample = async (prompt, shadowResponse, meta = {}) => {
    // 優先使用已註冊的 LanceDB Provider（由 memory-lancedb-pro 提供）
    const provider = getShadowProvider();
    if (provider && typeof provider.storeShadow === "function") {
        const result = await provider.storeShadow({
            sessionID: meta.sessionID || "standalone",
            prompt,
            shadowResponse,
            modelUsed: meta.modelUsed,
            taskType: meta.taskType,
            similarityScore: meta.similarityScore ?? null,
        });
        return { status: "stored", id: result.id };
    }
    // 備援：本地檔案式儲存（已棄用）
    initDirs();
    const id = `shadow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const example = {
        id,
        ts: new Date().toISOString(),
        prompt: (prompt || "").slice(0, 500),
        shadowResponse,
        modelUsed: meta.modelUsed || "unknown",
        taskType: meta.taskType || "general",
        similarityScore: meta.similarityScore || null,
        usageCount: 0,
    };
    const fp = path.join(DIRS.shadow, `${id}.json`);
    write(fp, example);
    return { status: "stored", id };
};
/**
 * 召回影子範例（用於 Few-Shot 注入）
 *
 * @deprecated 已棄用，請改用 OpenCode 蒸餾系統的 Distillation.recallShadow()
 *             見 projects/system/packages/opencode/src/distillation/
 * @param {string} currentPrompt - 當前用戶提示
 * @param {number} [limit=3] - 召回數量
 * @param {string} [taskType] - 過濾任務類型
 * @returns {Promise<Array<{prompt: string, shadowResponse: string, similarityScore: number}>>}
 */
export const getShadowExamples = async (currentPrompt, limit = 3, taskType) => {
    // 優先使用已註冊的 LanceDB Provider（由 memory-lancedb-pro 提供）
    const provider = getShadowProvider();
    if (provider && typeof provider.recallShadow === "function") {
        return await provider.recallShadow(currentPrompt, limit, taskType);
    }
    // 備援：本地檔案式召回（已棄用）
    initDirs();
    if (!fs.existsSync(DIRS.shadow))
        return [];
    const files = fs.readdirSync(DIRS.shadow).filter((f) => f.endsWith(".json"));
    const examples = [];
    for (const file of files) {
        try {
            const data = read(path.join(DIRS.shadow, file));
            if (!data)
                continue;
            if (taskType && data.taskType !== taskType)
                continue;
            const score = calculateSimilarity(currentPrompt, data.prompt);
            examples.push({ ...data, matchScore: score });
        }
        catch {
            continue;
        }
    }
    const sorted = examples
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, limit);
    for (const ex of sorted) {
        try {
            const fp = path.join(DIRS.shadow, `${ex.id}.json`);
            const data = read(fp);
            if (data) {
                data.usageCount = (data.usageCount || 0) + 1;
                write(fp, data);
            }
        }
        catch { }
    }
    return sorted.map(({ prompt, shadowResponse, matchScore }) => ({
        prompt,
        shadowResponse,
        similarityScore: matchScore,
    }));
};
/**
 * 計算兩段文字的簡單相似度（基於關鍵字重疊）
 *
 * @deprecated 已棄用。核心蒸餾系統使用 LanceDB 向量相似度（cosine similarity）。
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1 之間的分數
 */
export const calculateSimilarity = (a, b) => {
    if (!a || !b)
        return 0;
    const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    const intersection = [...tokensA].filter((t) => tokensB.has(t));
    const union = new Set([...tokensA, ...tokensB]);
    return union.size > 0 ? intersection.length / union.size : 0;
};
// ═══════════════════════════════════════════════
// 個性化人格系統（專業水平 × 角色情境）
// ═══════════════════════════════════════════════
const PRO_LEVELS = {
    1: {
        label: "💬 輕鬆口語",
        desc: "像朋友聊天，簡單直白，少量術語",
        prompt: "語氣輕鬆自然，像朋友一樣對話。避免過多正式用語和專業術語，保持簡單明瞭。可以使用口語化表達。",
    },
    2: {
        label: "📄 平易近人",
        desc: "友善易懂，適度專業，不沉悶",
        prompt: "語氣友善但保持一定專業度。解釋清楚但不囉嗦，適度使用專業詞彙並附帶簡短說明。",
    },
    3: {
        label: "⚖️ 均衡專業",
        desc: "沉穩清晰，精準用詞，預設等級",
        prompt: "保持沉穩專業的語氣，用詞精準清晰。根據問題複雜度調整詳細程度，避免過度口語或過度學術。",
    },
    4: {
        label: "🎯 專業嚴謹",
        desc: "正式用語，結構清晰，技術精準",
        prompt: "使用正式專業的用語，回答結構清晰分明（開頭→分析→結論）。技術名詞精準不模糊，適合開發者與技術人員閱讀。",
    },
    5: {
        label: "🏛️ 學術權威",
        desc: "極致嚴謹，文獻等級，完整論述",
        prompt: "採用學術級別的嚴謹語氣。結構包含問題定義、方法論、分析論證、結論。所有技術宣稱必須有依據，使用精確定義的專業詞彙。適合專家審閱等級。",
    },
};
// ─── 個性維度定義（1-5 滑桿） ───
const TRAIT_META = {
    warmth: { label: "🤗 貼心", desc: "冷靜客觀 ↔ 溫暖貼心" },
    proactive: { label: "⚡ 積極", desc: "被動回應 ↔ 主動建議" },
    depth: { label: "📚 深度", desc: "簡潔淺顯 ↔ 深入詳盡" },
    patience: { label: "🧘 耐心", desc: "直接簡短 ↔ 耐心反覆" },
    humor: { label: "😄 幽默", desc: "完全嚴肅 ↔ 輕鬆幽默" },
};
const TRAIT_LV = {
    1: { p: "非常", d: "傾向極端" },
    2: { p: "偏向", d: "稍微偏向" },
    3: { p: "適中", d: "居中平衡" },
    4: { p: "偏向", d: "稍微偏向" },
    5: { p: "非常", d: "傾向極端" },
};
/**
 * 根據個性維度值產生對應的行為指示
 * @param {object} traits - { warmth, proactive, depth, patience, humor }
 * @returns {string[]} 提示片段陣列
 */
const buildTraitPrompts = (traits) => {
    const t = { ...traits };
    const parts = [];
    // warmth: 溫暖貼心
    if (t.warmth >= 4)
        parts.push("語氣溫暖友善，展現同理心，適時表達關心與鼓勵。");
    else if (t.warmth <= 2)
        parts.push("語氣冷靜客觀，專注在事實與邏輯，避免情緒化表達。");
    // proactive: 積極主動
    if (t.proactive >= 4)
        parts.push("主動提供延伸建議和最佳實踐，引導使用者思考下一步。不要只回答問題本身。");
    else if (t.proactive <= 2)
        parts.push("僅針對問題回應，不主動延伸，除非使用者追問。");
    // depth: 深入程度
    if (t.depth >= 4)
        parts.push("回答深入詳盡，包含原理說明、底層機制和相關背景知識。適合想深入理解的學習者。");
    else if (t.depth <= 2)
        parts.push("回答簡潔明瞭，聚焦在核心答案，避免過多延伸說明。");
    // patience: 耐心程度
    if (t.patience >= 4)
        parts.push("對同一個問題可以從不同角度反覆解釋，直到對方完全理解為止。鼓勵追問。");
    else if (t.patience <= 2)
        parts.push("回答直接了當，一次到位。不重複解釋相同內容。");
    // humor: 幽默感
    if (t.humor >= 4)
        parts.push("適度使用幽默和輕鬆的比喻，讓技術討論不沉悶。但不要過度開玩笑影響專業性。");
    else if (t.humor <= 2)
        parts.push("保持嚴肅專業的語氣，不使用幽默或開玩笑。");
    return parts;
};
// ─── 角色情境預設 ───
const PERSONA = {
    "": {
        label: "無",
        desc: "不使用特定角色",
        prompt: "",
    },
    student: {
        label: "🎒 學生",
        desc: "耐心教學，由淺入深，舉例說明",
        prompt: "你是一位有耐心的老師。解釋概念時由淺入深，多用生活中的比喻和具體例子。遇到專業術語時一定要解釋含義。鼓勵提問，肯定學習過程。",
    },
    programmer: {
        label: "💻 程式設計師",
        desc: "技術精準，程式碼範例，最佳實踐",
        prompt: "你是一位資深工程師。回答聚焦在實作細節和技術方案，提供可直接運用的程式碼範例。注重程式碼品質、效能和最佳實踐。使用開發者常見的術語與縮寫。",
    },
    beginner: {
        label: "🌱 小白/新手",
        desc: "最簡單的語言，零術語，超耐心",
        prompt: "假設對方是完全沒有背景知識的新手。用最簡單的語言解釋，避免任何專業術語。如果需要用到專有名詞，一定要先用白話文解釋一遍。多用比喻和類比。態度友善鼓勵，不說『這很簡單』這類讓人壓力的話。",
    },
    mentor: {
        label: "🧭 導師",
        desc: "引導思考，傳授原理，培養能力",
        prompt: "你是一位經驗豐富的導師。不只是給答案，而是引導對方思考問題的本質。解釋技術決策背後的原因和取捨，幫助對方建立扎實的知識體系。鼓勵獨立思考，適時給提示而不是直接給解答。",
    },
    manager: {
        label: "📋 主管",
        desc: "結構化彙報，重點分明，決策導向",
        prompt: "你是一位善於彙報的主管。回答結構清晰：先給結論，再說明理由和影響。聚焦在方案的優缺點比較和決策建議。避免過多技術細節，除非對方追問。適合商業場景和專案管理討論。",
    },
    custom: {
        label: "✏️ 自定義",
        desc: "使用 customPrompt 中定義的個性",
        prompt: "",
    },
};
/**
 * 取得角色資訊
 * @param {string} [persona] - 角色名稱，預設讀取配置
 * @returns {{ label: string, desc: string, prompt: string }}
 */
export const getPersona = (persona) => {
    const cfg = persona ? { personality: persona } : loadCfg();
    const p = PERSONA[cfg.personality];
    if (cfg.personality === "custom" && cfg.customPrompt) {
        return {
            label: `✏️ ${cfg.customPrompt.slice(0, 30)}`,
            desc: "使用者自定義",
            prompt: cfg.customPrompt,
        };
    }
    return p || { label: "", desc: "", prompt: "" };
};
/**
 * 取得所有可用角色
 * @returns {Array<{ name: string, label: string, desc: string }>}
 */
export const getPersonaList = () => Object.entries(PERSONA).map(([k, v]) => ({
    name: k,
    label: v.label,
    desc: v.desc,
}));
/**
 * 取得目前個性維度設定
 * @returns {object}
 */
export const getTraits = () => {
    const cfg = loadCfg();
    return { ...cfg.traits };
};
/**
 * 設定單一個性維度
 * @param {string} key - 維度名稱: warmth, proactive, depth, patience, humor
 * @param {number} val - 1-5
 * @returns {{ ok: boolean, error?: string, trait?: string, val?: number }}
 */
export const setTrait = (key, val) => {
    const allowed = Object.keys(TRAIT_META);
    if (!allowed.includes(key))
        return {
            ok: false,
            error: `未知維度: ${key}，可用: ${allowed.join(", ")}`,
        };
    const n = typeof val === "string" ? parseInt(val, 10) : val;
    if (isNaN(n) || n < 1 || n > 5)
        return { ok: false, error: "值需為 1-5" };
    const cfg = loadCfg();
    cfg.traits[key] = n;
    saveCfg({ traits: cfg.traits });
    return { ok: true, trait: key, val: n };
};
// ─── 使用者程度自動偵測 ───
const ADVANCED_KW = [
    "refactor",
    "optimize",
    "implement",
    "deploy",
    "architecture",
    "dependency",
    "concurrency",
    "middleware",
    "orm",
    "ci/cd",
    "kubernetes",
    "docker",
    "microservices",
    "api",
    "sdk",
    "database",
    "index",
    "query",
    "normalization",
    "cache",
    "compiler",
    "runtime",
    "memory",
    "thread",
    "async",
    "algorithm",
    "complexity",
    "polymorphism",
    "inheritance",
    "design pattern",
    "dependency injection",
    "unit test",
    "重構",
    "優化",
    "部署",
    "架構",
    "併發",
    "中介層",
    "依賴注入",
    "設計模式",
    "單元測試",
    "容器化",
    "編譯",
];
const BEGINNER_KW = [
    "how to start",
    "what is",
    "help me understand",
    "beginner",
    "tutorial",
    "simple",
    "easy",
    "basic",
    "example for",
    "入門",
    "新手",
    "什麼是",
    "怎麼用",
    "基礎",
    "簡單",
    "教教我",
    "不懂",
    "不會",
    "怎麼開始",
];
/**
 * 從互動歷史推斷用戶的一般程度
 * @returns {'advanced'|'mixed'|'unknown'}
 */
const inferUserLevelFromHistory = () => {
    try {
        const logFile = path.join(DIRS.behavior, "interactions.jsonl");
        if (!fs.existsSync(logFile))
            return "unknown";
        const raw = fs.readFileSync(logFile, "utf-8");
        const lines = raw.trim().split("\n").filter(Boolean).slice(-50); // 只看最近 50 筆
        if (lines.length < 3)
            return "unknown";
        // 計算最近互動中「被拒絕」的比例（拒絕多可能代表不滿意）
        let rejected = 0;
        for (const l of lines) {
            try {
                const e = JSON.parse(l);
                if (e.feedback === "rejected")
                    rejected++;
            }
            catch { }
        }
        const rejectRate = rejected / lines.length;
        // 分析最近互動的 prompt 長度與複雜度
        const avgLen = lines.reduce((s, l) => {
            try {
                return s + (JSON.parse(l).prompt || "").length;
            }
            catch {
                return s;
            }
        }, 0) / lines.length;
        // 結論
        if (rejectRate > 0.3)
            return "mixed"; // 常拒絕 → 需求不合，保持中立
        if (avgLen > 150)
            return "advanced"; // 平均問句長 → 有經驗
        return "unknown";
    }
    catch {
        return "unknown";
    }
};
/**
 * 根據用戶訊息自動判斷適合的角色
 * 原則：不隨便貼小白標籤，懂程式的人也會問簡單問題
 * @param {string} msg - 用戶最新訊息
 * @returns {string} 角色名稱（空字串 = 使用預設）
 */
export const detectUserLevel = (msg) => {
    if (!msg)
        return "";
    const lower = msg.toLowerCase();
    // 檢測關鍵字
    const adv = ADVANCED_KW.filter((k) => lower.includes(k.toLowerCase())).length;
    const beg = BEGINNER_KW.filter((k) => lower.includes(k.toLowerCase())).length;
    const len = msg.length;
    const hasCode = msg.includes("```") ||
        lower.includes("function") ||
        lower.includes("class ") ||
        lower.includes("const ") ||
        lower.includes("let ") ||
        lower.includes("import ");
    // 互動歷史（用於校正）
    const historyLevel = inferUserLevelFromHistory();
    // ─── 決策邏輯（低誤判為原則） ───
    // 1. 有程式碼 → 程式設計師
    if (hasCode)
        return "programmer";
    // 2. 多個進階詞 + 無基礎詞 → 程式設計師
    if (adv >= 2 && beg === 0)
        return "programmer";
    // 3. 混合詞（進階+基礎）→ 學生模式（願意教學）
    if (adv >= 1 && beg >= 1)
        return "student";
    // 4. 純進階詞 + 長文 → 程式設計師
    if (adv >= 1 && len > 80)
        return "programmer";
    // 5. 以下情況才考慮 beginner（門檻較高）
    const isStrongBeginner = beg >= 3;
    const isOnlyBeginner = beg >= 1 && adv === 0;
    // 有歷史紀錄且偏向進階 → 不降級為 beginner
    if (isOnlyBeginner && historyLevel === "advanced")
        return "student";
    // 真的很新手信號才標 beginner
    if (isStrongBeginner && adv === 0)
        return "beginner";
    // 6. 中等長度 + 有基礎詞 → 學生模式（保守選擇）
    if (len > 60 && beg >= 1)
        return "student";
    // 7. 超短問句（< 15字）→ 不判斷，用預設（誰都可能問短問題）
    if (len < 15)
        return "";
    // 8. 不確定 → 回空（保留預設角色）
    return "";
};
/**
 * 分析用戶並取得建議的角色與解說
 * @param {string} msg - 用戶訊息
 * @returns {{ persona: string, label: string, reason: string, confidence: string }}
 */
export const analyzeUserLevel = (msg) => {
    const detected = detectUserLevel(msg);
    const reasons = [];
    const lower = msg.toLowerCase();
    const adv = ADVANCED_KW.filter((k) => lower.includes(k.toLowerCase()));
    const beg = BEGINNER_KW.filter((k) => lower.includes(k.toLowerCase()));
    if (adv.length)
        reasons.push(`進階詞: ${adv.slice(0, 3).join(", ")}`);
    if (beg.length)
        reasons.push(`基礎詞: ${beg.slice(0, 3).join(", ")}`);
    if (msg.includes("```") ||
        lower.includes("function") ||
        lower.includes("const "))
        reasons.push("包含程式碼");
    if (msg.length > 200)
        reasons.push("長文");
    if (!detected) {
        return {
            persona: "",
            label: "使用預設角色",
            reason: reasons.length
                ? reasons.join("、") + "，信號不明確，保留目前設定"
                : "無明確判斷依據，使用預設角色",
            confidence: "low",
        };
    }
    const info = getPersona(detected);
    let confidence = "medium";
    if (detected === "programmer" && adv.length >= 2)
        confidence = "high";
    if (detected === "beginner" && beg.length >= 3)
        confidence = "high";
    if (detected === "student" && adv.length >= 1 && beg.length >= 1)
        confidence = "high";
    return {
        persona: detected,
        label: info.label,
        reason: reasons.length ? reasons.join("、") : "模式匹配",
        confidence,
    };
};
/**
 * 取得專業水平標籤
 * @param {number} [level] - 1-5，預設讀取配置
 * @returns {{ label: string, desc: string, prompt: string }}
 */
export const getProLevel = (level) => {
    const cfg = level ? { proLevel: level } : loadCfg();
    const lv = PRO_LEVELS[cfg.proLevel];
    return lv || PRO_LEVELS[3];
};
/**
 * 產生完整 system prompt（專業水平 + 角色 + 語言 + 詳細度）
 * 支援自動偵測用戶程度切換角色（autoPersona 開啟時）
 * @param {number} [level] - 覆蓋專業水平
 * @param {string} [persona] - 覆蓋角色
 * @param {string} [userMsg] - 用戶最新訊息（啟用 autoPersona 時自動分析）
 * @returns {string}
 */
export const getProLevelPrompt = (level, persona, userMsg) => {
    const cfg = loadCfg();
    const pro = PRO_LEVELS[level ?? cfg.proLevel] || PRO_LEVELS[3];
    const verbosity = cfg.responseVerbosity ?? 3;
    const lang = cfg.responseLang ?? "zh-TW";
    // 角色：優先明確指定 > autoPersona 自動偵測 > 配置中的固定角色
    let role = persona ?? cfg.personality ?? "";
    let autoInfo = null;
    if (!persona && cfg.autoPersona && userMsg) {
        const d = detectUserLevel(userMsg);
        if (d) {
            role = d;
            autoInfo = getPersona(d);
        }
    }
    const parts = [pro.prompt];
    // 角色補強
    if (role) {
        const r = PERSONA[role];
        if (role === "custom" && cfg.customPrompt) {
            parts.push(`\n[角色設定]\n${cfg.customPrompt}`);
        }
        else if (r?.prompt) {
            parts.push(`\n[角色設定]\n${r.prompt}`);
        }
        if (autoInfo) {
            parts.push(`\n（本次回應根據問題性質調整了說明方式）`);
        }
    }
    // 個性維度（貼心、積極、深度、耐心、幽默）
    const traitParts = buildTraitPrompts(cfg.traits);
    if (traitParts.length) {
        parts.push(`\n[個性特質]\n${traitParts.join("\n")}`);
    }
    // 語言
    if (lang === "zh-TW")
        parts.push("一律使用繁體中文（正體）回應，嚴禁簡體字。");
    else
        parts.push("Respond in English.");
    // 詳細度（與 depth 維度連動）
    if (verbosity <= 2 || cfg.traits.depth <= 2)
        parts.push("保持精簡，只回答必要的內容，不延伸。");
    else if (verbosity >= 4 || cfg.traits.depth >= 4)
        parts.push("可適度延伸說明相關背景與原理，幫助深入理解。");
    return parts.join("\n\n");
};
// ═══════════════════════════════════════════════
// 人性化輔助
// ═══════════════════════════════════════════════
/**
 * 取得隱私設定摘要
 * @returns {object}
 */
export const getPrivacyInfo = () => {
    const cfg = loadCfg();
    const m = new Metrics();
    return {
        learningConsent: cfg.learningConsent,
        dataRetention: `${cfg.dataRetention} 天`,
        allowCloudSync: cfg.allowCloudSync ? "允許" : "不允許",
        totalDataPoints: m.get().dataPoints,
        dataDir: BASE,
        diskUsage: getDirSize(BASE),
    };
};
const getDirSize = (dir) => {
    let size = 0;
    try {
        const walk = (d) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const fp = path.join(d, e.name);
                if (e.isDirectory())
                    walk(fp);
                else if (e.isFile())
                    size += fs.statSync(fp).size;
            }
        };
        if (fs.existsSync(dir))
            walk(dir);
    }
    catch { }
    return size < 1024
        ? `${size} B`
        : size < 1048576
            ? `${(size / 1024).toFixed(1)} KB`
            : `${(size / 1048576).toFixed(1)} MB`;
};
/**
 * 學習建議 — 根據當前狀態給出下一步行動
 * @returns {string[]}
 */
export const getLearningSuggestions = () => {
    const all = getLearningMetrics();
    const m = all.metrics;
    const cfg = loadCfg();
    const tips = [];
    if (!cfg.learningConsent) {
        tips.push("🔒 學習功能已關閉，執行 `qwen_learn_config learningConsent=true` 開啟");
        return tips;
    }
    if (m.dataPoints === 0) {
        tips.push("💡 還沒有任何互動記錄，開始使用 AI 助理就會自動累積");
        tips.push("📊 也可以先執行 `qwen_learn_code_style` 分析專案風格");
        return tips;
    }
    if (!all.codeStyle) {
        tips.push("📝 尚未分析程式碼風格，執行 `qwen_learn_code_style path=/your/project` 開始");
    }
    if (m.dataPoints < cfg.level2At) {
        const need = cfg.level2At - m.dataPoints;
        tips.push(`📈 再 ${need} 次互動即可升級 Level 2（模式識別），繼續使用即可`);
    }
    else if (m.level === 2) {
        const need = cfg.level3At - m.dataPoints;
        tips.push(`📈 再 ${need} 次互動即可升級 Level 3（模型微調）`);
        if (!all.responseStyle) {
            tips.push("💬 執行 `qwen_learn_response_style` 分析回應偏好");
        }
        tips.push("🔧 執行 `qwen_learn_recommend` 查看個人化推薦");
    }
    else if (m.level === 3) {
        tips.push("🎉 已達最高學習層級！定期匯出模型備份：`qwen_learn_export`");
        if (m.accuracy < 0.7) {
            tips.push("📊 準確度偏低，多使用 `qwen_record_feedback` 標記反饋來改善");
        }
    }
    if (m.interactions.rejected > m.interactions.accepted) {
        tips.push("⚠️ 拒絕次數高於接受次數，考慮調整回應偏好：`qwen_learn_config responseVerbosity=4`");
    }
    if (m.dataPoints > 0 && m.accuracy >= 0.9) {
        tips.push("🌟 準確度超過 90%！學習效果良好");
    }
    return tips;
};
/**
 * 進度條視覺化
 * @param {number} val - 當前值
 * @param {number} max - 最大值
 * @param {number} [width=12] - 寬度
 * @returns {string}
 */
export const formatProgress = (val, max, width = 12) => {
    const pct = Math.min(val / max, 1);
    const filled = Math.round(pct * width);
    const bar = "█".repeat(filled) + "░".repeat(width - filled);
    return `${bar} ${(pct * 100).toFixed(0)}%`;
};
/**
 * 人性化指標摘要（純文字，適合工具輸出）
 * @returns {string}
 */
export const summarizeMetrics = () => {
    const all = getLearningMetrics();
    const m = all.metrics;
    const cfg = loadCfg();
    const lines = [];
    lines.push(`📚 自我學習系統`);
    lines.push(`層級: Level ${m.level} （${LV[m.level] || "未知"}）`);
    lines.push(`資料: ${m.dataPoints} 筆互動・準確度 ${(m.accuracy * 100).toFixed(0)}%`);
    lines.push(`反饋: ✅ ${m.interactions.accepted}・✏️ ${m.interactions.edited}・❌ ${m.interactions.rejected}`);
    // 進度條（到下個 level）
    const next = m.level === 1 ? cfg.level2At : m.level === 2 ? cfg.level3At : m.dataPoints;
    const cur = m.level === 3 ? m.dataPoints : m.dataPoints;
    lines.push(`進度: ${formatProgress(cur, next)}`);
    if (m.improvements.length) {
        const last = m.improvements[m.improvements.length - 1];
        lines.push(`近期: ${last}`);
    }
    lines.push(`下一步: ${m.nextMilestone}`);
    // 建議
    const tips = getLearningSuggestions();
    if (tips.length) {
        lines.push("");
        for (const t of tips)
            lines.push(t);
    }
    return lines.join("\n");
};
export { Metrics, BASE as MODELS_DIR };
//# sourceMappingURL=self-learning.js.map