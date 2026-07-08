/**
 * evolution-engine.js — 自主進化引擎
 *
 * 根據歷史互動數據自動微調路由策略與關鍵字權重。
 * 透過自我學習系統的反饋進行閉環進化，無需手動干預。
 *
 * 設計原則：
 * • 依賴注入：self-learning 模組為可選依賴，無依賴時靜默降級
 * • 單例管理：模組級狀態，無需額外初始化步驟（init可選）
 * • 非阻塞：所有分析非同步執行，不影響請求處理
 *
 * 整合方式（chat-proxy.js）：
 *   import * as evo from "./evolution-engine.js"
 *   evo.init({ complexKeywords: COMPLEX_KEYWORDS }) // 可選
 *   // 事件驅動：每 TRIGGER_THRESHOLD 筆新紀錄自動觸發，無需定時器
 *   const w = evo.getWeight("debug")                  // 取得動態權重
 *   const p = evo.getPenalty("coding")                // 取得歷史懲罰
 *
 * 分析報告自動推送至 KNOWLEDGE_API_URL (預設本機 telegram-bridge API)，
 * 寫入知識庫供後續查閱與評分依據。
 */
import { makeLogger } from "./color.js";
const log = makeLogger("evolution", "secondary");
// ─── 預設配置（env 可覆寫）───
const EVOLUTION_ENABLED = process.env.PROXY_EVOLUTION !== "off";
const AUTO_ADJUST = process.env.PROXY_AUTO_ADJUST !== "off";
// 事件驅動：不再使用定時輪詢，改為每 N 筆新紀錄自動觸發分析
const TRIGGER_THRESHOLD = parseInt(process.env.PROXY_EVOLUTION_TRIGGER || "50");
const KNOWLEDGE_API_URL = process.env.KNOWLEDGE_API_URL || "http://127.0.0.1:4377";
const DEFAULT_COGNITIVE_KW = [
    "explain",
    "why",
    "how",
    "concept",
    "theory",
    "principle",
    "compare",
    "evaluate",
    "assess",
    "reasoning",
    "deduce",
    "interpret",
    "clarify",
    "解釋",
    "為什麼",
    "如何",
    "概念",
    "理論",
    "原理",
    "比較",
    "評估",
    "分析",
    "推論",
    "演繹",
    "詮釋",
    "釐清",
];
// ─── 內部狀態（模組級 Singleton）───
let _sl = null; // self-learning module ref（可選）
let _complex = []; // complex keywords from host
let _cognitive = []; // cognitive keywords
let _weights = new Map(); // keyword.toLowerCase() -> weight
let _suggestions = [];
// 事件驅動觸發計數器：累積新紀錄達 threshold 即自動分析
let _triggerCount = 0;
let _idleTimer = null;
const IDLE_MS = 300000; // 5 分鐘無新紀錄也觸發一次（防完全閒置失憶）
// ═══ 停滯/超時追蹤 ═══
// per-model 統計：latency 總和、請求數、超時數、停滯（>120s）數
let _modelPerf = new Map(); // model -> { count, totalLatency, timeouts, stalls, lastLatency, updatedAt }
// ═══ Fix 2026-07-07: 長文生成/複雜任務 >120s 才視為停滯，避免正常長時間推理觸發誤判
const STALL_THRESHOLD_MS = parseInt(process.env.EVO_STALL_THRESHOLD_MS || "120000");
const TIMEOUT_THRESHOLD_MS = parseInt(process.env.PROXY_TIMEOUT_MS || "120000");
// ═══ 持久化至磁碟（進程重啟不丟失）═══
const PERSIST_DIR = process.env.EVOLUTION_DATA_DIR ||
    (typeof process !== "undefined" && process.env.HOME
        ? `${process.env.HOME}/.opencode`
        : "/tmp/.opencode");
const PERSIST_PATH = `${PERSIST_DIR}/evolution-stats.json`;
const _saveStats = () => {
    try {
        const dir = require("path").dirname(PERSIST_PATH);
        if (!require("fs").existsSync(dir)) {
            require("fs").mkdirSync(dir, { recursive: true });
        }
        const data = {};
        for (const [model, s] of _modelPerf) {
            data[model] = s;
        }
        require("fs").writeFileSync(PERSIST_PATH, JSON.stringify(data, null, 2), "utf-8");
    }
    catch (_) {
        // 持久化失敗不影響運行
    }
};
const _loadStats = () => {
    try {
        if (!require("fs").existsSync(PERSIST_PATH))
            return;
        const raw = require("fs").readFileSync(PERSIST_PATH, "utf-8");
        const data = JSON.parse(raw);
        const now = Date.now();
        const MAX_AGE = 24 * 60 * 60 * 1000; // 24hr: 超過此期限的歷史數據全部清除
        let loaded = 0;
        let expired = 0;
        for (const [model, s] of Object.entries(data)) {
            // ═══ Fix 2026-07-06: 超過 24 小時的歷史數據不載入（避免舊妨害新）
            // 大型模型在重啟後可能已有改善，不應被舊數據懲罰
            if (s.updatedAt && now - s.updatedAt > MAX_AGE) {
                expired++;
                continue;
            }
            _modelPerf.set(model, s);
            loaded++;
        }
        if (loaded > 0) {
            log.info(`📊 已載入 ${loaded} 筆模型效能歷史${expired ? ` (${expired} 筆已過期忽略)` : ""}`);
        }
        if (expired > 0 && loaded === 0) {
            log.info(`🧹 ${expired} 筆模型效能歷史已過期（>24hr），全部清除`);
        }
        // 清除超過 24 小時的舊檔案，下次啟動時不再載入
        if (expired > loaded * 2 || (expired > 0 && loaded === 0)) {
            try {
                require("fs").writeFileSync(PERSIST_PATH, "{}", "utf-8");
            }
            catch { }
        }
    }
    catch (_) {
        // 載入失敗不影響運行
    }
};
// ═══════════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════════
/**
 * 初始化進化引擎
 * @param {object} opts
 * @param {object}  [opts.selfLearning]    - self-learning 模組（可選）
 * @param {string[]} [opts.complexKeywords]  - 複雜關鍵字列表
 * @param {string[]} [opts.cognitiveKeywords]- 認知關鍵字列表
 */
export const init = (opts = {}) => {
    _sl = opts.selfLearning || null;
    _complex = opts.complexKeywords || [];
    _cognitive = opts.cognitiveKeywords || DEFAULT_COGNITIVE_KW;
    _resetWeights();
    _loadStats();
    if (EVOLUTION_ENABLED) {
        log.info(`🧬 進化引擎已啟動 (事件驅動，每 ${TRIGGER_THRESHOLD} 筆新紀錄自動分析，閒置 5 分鐘防護)`);
    }
};
const _resetWeights = () => {
    _weights.clear();
    for (const kw of _complex)
        _weights.set(kw.toLowerCase(), 1);
    for (const kw of _cognitive)
        _weights.set(kw.toLowerCase(), 1);
};
// ═══════════════════════════════════════════════
// 公開 API
// ═══════════════════════════════════════════════
/** 取得關鍵字動態權重 */
export const getWeight = (kw) => _weights.get(kw.toLowerCase()) || 1;
/** 取得認知關鍵字列表 */
export const getCognitiveKeywords = () => [..._cognitive];
/** 取得目前建議 */
export const getSuggestions = () => [..._suggestions];
/** 是否運作中 */
export const isRunning = () => EVOLUTION_ENABLED;
/** 事件模式：回傳觸發閾值與目前累積 */
export const getTriggerState = () => ({
    threshold: TRIGGER_THRESHOLD,
    count: _triggerCount,
});
/**
 * 歷史懲罰分數：若該任務類型近期拒絕率高，返回懲罰值強制升級模型
 * @param {string} taskType - "coding" | "chat"
 * @returns {number} 0 | 1 | 2
 */
export const getPenalty = (taskType) => {
    if (!_sl)
        return 0;
    try {
        const list = _sl.getInteractions();
        if (!list?.length)
            return 0;
        const relevant = list.slice(-50).filter((i) => i.taskType === taskType);
        if (relevant.length < 5)
            return 0;
        const rate = relevant.filter((i) => i.feedback === "rejected").length /
            relevant.length;
        if (rate > 0.3)
            return 2;
        if (rate > 0.1)
            return 1;
    }
    catch { }
    return 0;
};
// ═══════════════════════════════════════════════
// 停滯/超時追蹤 API
// ═══════════════════════════════════════════════
/**
 * 記錄模型 latency 與超時，用於路由自動調整
 * @param {string} model - 模型名稱
 * @param {number} latencyMs - 回應延遲（毫秒）
 * @param {boolean} isTimeout - 是否為超時/停滯
 * @param {boolean} [isWaf] - 是否為 WAF 阻擋（非模型問題，不計入統計）
 */
export const recordModelLatency = (model, latencyMs, isTimeout = false, isWaf = false) => {
    // ═══ Fix 2026-07-06 (v3): WAF 阻擋跳過統計（非模型問題） ═══
    if (isWaf) {
        log.debug(`跳過 WAF 阻擋的 latency 記錄: ${model}`);
        return;
    }
    // ═══ Fix 2026-07-07: 統一 key 為小寫，避免 qwen3.6-max-preview vs Qwen3.6-Max-Preview 被分開追蹤
    const key = (model || "unknown").toLowerCase();
    let s = _modelPerf.get(key);
    if (!s) {
        s = {
            count: 0,
            totalLatency: 0,
            timeouts: 0,
            stalls: 0,
            lastLatency: 0,
            updatedAt: Date.now(),
        };
        _modelPerf.set(key, s);
    }
    s.count++;
    s.totalLatency += latencyMs;
    s.lastLatency = latencyMs;
    s.updatedAt = Date.now();
    if (isTimeout)
        s.timeouts++;
    if (latencyMs > STALL_THRESHOLD_MS)
        s.stalls++;
    _saveStats();
    // 事件驅動：累積新紀錄，達閾值自動觸發分析
    _triggerCount++;
    _clearIdleTimer();
    if (_triggerCount >= TRIGGER_THRESHOLD) {
        _triggerCount = 0;
        evolve(); // fire-and-forget
    }
    else {
        // 閒置防護：最後一筆紀錄後 IDLE_MS 無新紀錄也觸發一次
        _idleTimer = setTimeout(() => {
            if (_triggerCount > 0) {
                const n = _triggerCount;
                _triggerCount = 0;
                log.info(`🧬 閒置觸發: ${n} 筆未分析紀錄`);
                evolve();
            }
        }, IDLE_MS);
        _idleTimer.unref?.();
    }
};
const _clearIdleTimer = () => {
    if (_idleTimer) {
        clearTimeout(_idleTimer);
        _idleTimer = null;
    }
};
/**
 * 取得所有模型效能統計
 * @returns {Array<{model: string, count: number, avgLatency: number, timeoutRate: number, stallRate: number}>}
 */
export const getModelStats = () => {
    const out = [];
    for (const [model, s] of _modelPerf) {
        out.push({
            model,
            count: s.count,
            avgLatency: s.count > 0 ? Math.round(s.totalLatency / s.count) : 0,
            lastLatency: s.lastLatency,
            timeoutRate: s.count > 0 ? +(s.timeouts / s.count).toFixed(3) : 0,
            stallRate: s.count > 0 ? +(s.stalls / s.count).toFixed(3) : 0,
        });
    }
    return out.sort((a, b) => b.count - a.count);
};
/**
 * 判斷某模型是否高停滯率（用於路由決策）
 * @param {string} model
 * @param {number} [threshold=0.3] - 停滯率閾值
 * @returns {boolean}
 */
export const isModelStalling = (model, threshold = 0.3) => {
    const s = _modelPerf.get(model);
    // ═══ Fix 2026-07-07: 至少 10 筆樣本才判定，避免 session 殘留的少量壞數據誤判
    if (!s || s.count < 10)
        return false;
    return s.stalls / s.count > threshold;
};
/**
 * 判斷某模型是否高超時率
 * @param {string} model
 * @param {number} [threshold=0.2]
 * @returns {boolean}
 */
export const isModelTimingOut = (model, threshold = 0.2) => {
    const s = _modelPerf.get(model);
    // ═══ Fix 2026-07-07: 至少 10 筆樣本才判定，避免 session 殘留的少量壞數據誤判
    if (!s || s.count < 10)
        return false;
    return s.timeouts / s.count > threshold;
};
/**
 * 根據目前效能統計建議替代模型等級
 * @returns {object|null} { from: string, to: string, reason: string } | null
 */
export const suggestFallbackRoute = () => {
    // ═══ Fix 2026-07-06: 至少 5 筆樣本才建議降級
    const stats = getModelStats().filter((s) => s.count >= 5);
    for (const s of stats) {
        if (s.stallRate > 0.3 || s.timeoutRate > 0.2) {
            // 嘗試降級或升級模型
            const downMap = { large: "medium", medium: "small", small: null };
            const next = downMap[s.model] || "small";
            if (next)
                return {
                    from: s.model,
                    to: next,
                    reason: `${s.model} 停滯率 ${(s.stallRate * 100).toFixed(1)}%/超時率 ${(s.timeoutRate * 100).toFixed(1)}%`,
                };
        }
    }
    return null;
};
/**
 * 自動調整關鍵字權重（依拒絕率）
 * 若某關鍵字在表現不佳的模型上拒絕率 > 40%，提高權重以觸發更強模型
 */
export const adjustWeights = (recent, modelStats) => {
    if (!AUTO_ADJUST || !_sl)
        return;
    const poor = new Set(Object.entries(modelStats)
        .filter(([, s]) => s.t >= 5 && s.a / s.t < 0.6)
        .map(([m]) => m));
    if (!poor.size)
        return;
    const kwRate = {};
    for (const i of recent) {
        if (!poor.has(i.modelUsed))
            continue;
        const p = (i.prompt || "").toLowerCase();
        const rej = i.feedback === "rejected";
        for (const kw of [..._complex, ..._cognitive]) {
            const k = kw.toLowerCase();
            if (p.includes(k)) {
                if (!kwRate[k])
                    kwRate[k] = { t: 0, r: 0 };
                kwRate[k].t++;
                if (rej)
                    kwRate[k].r++;
            }
        }
    }
    let n = 0;
    for (const [kw, s] of Object.entries(kwRate)) {
        if (s.t < 3)
            continue;
        const acceptRate = 1 - s.r / s.t;
        if (s.r / s.t > 0.4) {
            const cur = _weights.get(kw) || 1;
            const nw = Math.min(cur + 0.5, 3);
            if (nw !== cur) {
                _weights.set(kw, nw);
                const msg = `⚖️ 權重上調: "${kw}" ${cur.toFixed(1)}→${nw.toFixed(1)}` +
                    ` (拒絕率 ${((s.r / s.t) * 100).toFixed(1)}%)`;
                _suggestions.push(msg);
                n++;
            }
        }
        else if (acceptRate > 0.85 && s.t >= 5) {
            const cur = _weights.get(kw) || 1;
            if (cur > 1) {
                const nw = Math.max(cur - 0.3, 1);
                _weights.set(kw, nw);
                const msg = `⚖️ 權重下調: "${kw}" ${cur.toFixed(1)}→${nw.toFixed(1)}` +
                    ` (接受率 ${(acceptRate * 100).toFixed(1)}%)`;
                _suggestions.push(msg);
                n++;
            }
        }
    }
    if (n)
        log.info(`🧬 已調整 ${n} 個關鍵字權重`);
};
/**
 * 推送進化分析報告至知識庫（KNOWLEDGE_API_URL），作為評分依據
 * 非阻塞，失敗不影響主流程
 */
const _pushAnalysisReport = async (analysis) => {
    const { ts, totalInteractions, modelStats, suggestionCount, weightChanges } = analysis;
    const dateStr = new Date(ts).toISOString().slice(0, 16).replace("T", " ");
    const lines = [`# 🧬 進化分析報告 ${dateStr}`, ""];
    lines.push(`**互動樣本**: ${totalInteractions} 筆`);
    lines.push(`**建議數**: ${suggestionCount} 條`);
    if (weightChanges > 0)
        lines.push(`**權重調整**: ${weightChanges} 個關鍵字`);
    lines.push("");
    if (modelStats.length > 0) {
        lines.push("## 模型效能");
        lines.push("| 模型 | 請求數 | 平均延遲 | 超時率 | 停滯率 |");
        lines.push("|------|--------|----------|--------|--------|");
        for (const m of modelStats) {
            lines.push(`| ${m.model} | ${m.count} | ${m.avgLatency}ms | ${(m.timeoutRate * 100).toFixed(1)}% | ${(m.stallRate * 100).toFixed(1)}% |`);
        }
        lines.push("");
    }
    if (_suggestions.length > 0) {
        lines.push("## 建議");
        for (const s of _suggestions.slice(0, 10)) {
            lines.push(`- ${s}`);
        }
    }
    try {
        const res = await fetch(`${KNOWLEDGE_API_URL}/api/push/knowledge`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: `🧬 進化分析 ${dateStr}`,
                content: lines.join("\n"),
                category: "進化引擎",
                tags: ["evolution", "analysis"],
            }),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok)
            log.warn(`push report: HTTP ${res.status}`);
    }
    catch (e) {
        // 知識庫不可用 → 本地文件備援
        try {
            const { existsSync, mkdirSync, appendFileSync } = require("fs");
            const { dirname } = require("path");
            const fp = `${PERSIST_DIR}/evolution-report.md`;
            const dir = dirname(fp);
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            appendFileSync(fp, `\n---\n${lines.join("\n")}\n`, "utf-8");
        }
        catch (_) {
            /* 本地寫入也失敗則忽略 */
        }
    }
};
// ═══════════════════════════════════════════════
// 完整進化分析（背景定時器回調）
// ═══════════════════════════════════════════════
/**
 * 執行一次完整進化分析
 * 1. 計算各模型接受率
 * 2. 識別表現不佳的模型-任務組合
 * 3. 認知關鍵字效能分析
 * 4. 自動調整關鍵字權重
 * 5. 持久化建議至 self-learning 配置
 * 6. 推送分析報告至知識庫
 */
export const evolve = async () => {
    if (!EVOLUTION_ENABLED || !_sl)
        return;
    try {
        const list = _sl.getInteractions();
        if (list.length < 10)
            return;
        // 事件驅動：分析過去 24h 內未分析過的互動（至少取最近 100 筆）
        const recent = list.slice(-100);
        if (!recent.length)
            return;
        log.info(`🧬 進化分析: ${recent.length} 筆互動 (事件驅動)...`);
        const now = Date.now();
        _suggestions = [];
        // 1. 模型統計
        const ms = {};
        for (const i of recent) {
            const m = i.modelUsed || "unknown";
            if (!ms[m])
                ms[m] = { t: 0, a: 0, r: 0 };
            ms[m].t++;
            if (i.feedback === "accepted")
                ms[m].a++;
            if (i.feedback === "rejected")
                ms[m].r++;
        }
        // 2. 低接受率模型
        for (const [m, s] of Object.entries(ms)) {
            if (s.t >= 5 && s.a / s.t < 0.6) {
                const msg = `📉 模型 ${m} 接受率 ${((s.a / s.t) * 100).toFixed(1)}%`;
                log.warn(msg);
                _suggestions.push(msg);
            }
        }
        // 3. 認知任務分析
        const cog = recent.filter((i) => i.isCognitive);
        if (cog.length > 0) {
            const lat = cog.reduce((s, i) => s + (i.latencyMs || 0), 0) / cog.length;
            const rr = cog.filter((i) => i.feedback === "rejected").length / cog.length;
            if (rr > 0.4 && lat > 10000) {
                const msg = `🧠 認知任務高延遲(${Math.round(lat)}ms)` +
                    ` 且高拒絕率(${(rr * 100).toFixed(1)}%)`;
                _suggestions.push(msg);
            }
        }
        // 3b. 停滯分析（需至少 5 筆樣本）
        const perfStats = getModelStats();
        for (const ps of perfStats) {
            if (ps.count >= 5 && ps.stallRate > 0.3) {
                const msg = `⏰ 模型 ${ps.model} 高停滯率 ${(ps.stallRate * 100).toFixed(1)}% (${ps.stalls}/${ps.count})，平均延遲 ${ps.avgLatency}ms`;
                _suggestions.push(msg);
            }
            if (ps.count >= 5 && ps.timeoutRate > 0.15) {
                const msg = `⏰ 模型 ${ps.model} 高超時率 ${(ps.timeoutRate * 100).toFixed(1)}% (${ps.timeouts}/${ps.count})`;
                _suggestions.push(msg);
            }
        }
        const fallback = suggestFallbackRoute();
        if (fallback) {
            const msg = `🔄 建議路由降級: ${fallback.from} → ${fallback.to} (${fallback.reason})`;
            _suggestions.push(msg);
        }
        // 4. 自動調整權重
        adjustWeights(recent, ms);
        // 5. 持久化建議至 Self-Learning
        if (_suggestions.length) {
            try {
                const cfg = _sl.getConfig();
                const merged = [
                    ..._suggestions,
                    ...(cfg.evolutionSuggestions || []),
                ].slice(0, 10);
                _sl.updateConfig({ evolutionSuggestions: merged });
            }
            catch { }
        }
        log.info(`🧬 進化分析完成。產生 ${_suggestions.length} 條建議 (觸發計數器已重置)。`);
        // 6. 推送分析報告至知識庫
        if (_suggestions.length > 0) {
            const perfStats = getModelStats();
            _pushAnalysisReport({
                ts: now,
                totalInteractions: recent.length,
                modelStats: perfStats,
                suggestionCount: _suggestions.length,
                weightChanges: 0,
            });
        }
    }
    catch (e) {
        log.error(`❌ 進化分析失敗: ${e.message}`);
    }
};
// ═══════════════════════════════════════════════
// 事件驅動管理（不再使用定時輪詢）
// ═══════════════════════════════════════════════
/** 重置觸發計數器（強制重設累積狀態） */
export const resetTrigger = () => {
    _triggerCount = 0;
    _clearIdleTimer();
};
/** 被動狀態檢查（無外部事件時可手動呼叫） */
export const flushPending = () => {
    if (_triggerCount > 0) {
        const n = _triggerCount;
        _triggerCount = 0;
        _clearIdleTimer();
        evolve();
        return n;
    }
    return 0;
};
/**
 * 更新關鍵字列表（配置熱重載時呼叫）
 * 保留現有權重，僅新增缺失項
 */
export const updateKeywords = (complex, cognitive) => {
    if (complex)
        _complex = complex;
    if (cognitive)
        _cognitive = cognitive;
    // 為新增的關鍵字設定預設權重
    for (const kw of _complex) {
        const k = kw.toLowerCase();
        if (!_weights.has(k))
            _weights.set(k, 1);
    }
    for (const kw of _cognitive) {
        const k = kw.toLowerCase();
        if (!_weights.has(k))
            _weights.set(k, 1);
    }
};
//# sourceMappingURL=evolution-engine.js.map