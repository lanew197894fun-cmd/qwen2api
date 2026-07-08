/**
 * intelligent-tuning.js — 智能微調層（持久化版）
 *
 * 基於模型即時行為觀察，動態調整 tool prompt 風格與系統參數。
 * 補足 evolution-engine（長期統計）與 self-learning（用戶偏好）之間
 * 的短中期即時調整缺口。
 *
 * ═══ Fix 2026-07-04: 持久化支援 ═══
 * 問題：進程重啟後 _patterns 中的行為數據全部遺失，
 * 導致每次重啟都要從頭學習模型行為（停滯率、延遲、prompt 風格）。
 * 修復：每次 recordResponse 後 debounced 保存至 ~/.opencode/tuning/tuning-data.json，
 * 啟動時自動載入。
 *
 * 核心機制：
 * 1. 行為追蹤 — 每次模型回應記錄其模式（停滯/完成/拒絕/空內容）
 * 2. Prompt 動態調整 — 根據模型行為調整 tool prompt 語氣與內容
 * 3. 參數自調 — 動態調整重試次數、超時閾值、停滯檢測敏感度
 * 4. 路由提示 — 提供即時路由建議（給 chat-proxy.js 參考）
 *
 * 整合方式（chat-proxy.js）：
 *   import * as tune from "./intelligent-tuning.js";
 *   tune.recordResponse(model, "stall");
 *   const prompt = tune.buildAdaptivePrompt(tools);
 *   const hint = tune.getRoutingHint(model);
 */
import fs from "node:fs";
import path from "node:path";
import { makeLogger } from "./color.js";
const log = makeLogger("tuning", "secondary");
// ═══ 持久化路徑 & 檔案操作 ═══
const _homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
const _tuningDir = `${_homeDir}/.opencode/tuning`;
const _persistPath = `${_tuningDir}/tuning-data.json`;
/**
 * 從磁碟載入持久化的 tuning 數據
 */
const _load = () => {
    try {
        if (!fs.existsSync(_persistPath)) {
            log.debug("無持久化 tuning 數據，從頭開始");
            return null;
        }
        const raw = fs.readFileSync(_persistPath, "utf-8");
        const data = JSON.parse(raw);
        // 基本驗證
        if (!data || !data.patterns || typeof data.patterns !== "object") {
            log.warn("⚠️ tuning 數據格式異常，跳過載入");
            return null;
        }
        log.info(`📂 已載入 tuning 數據: ${Object.keys(data.patterns).length} 模型, ${data.globalResponseCount || 0} 次回應`);
        return data;
    }
    catch (e) {
        log.warn(`⚠️ 載入 tuning 數據失敗: ${e.message}`);
        return null;
    }
};
/**
 * 保存 tuning 數據至磁碟（同步寫入，避免進程退出時遺失）
 */
const _save = () => {
    try {
        const patterns = {};
        for (const [model, p] of _patterns) {
            patterns[model] = { ...p };
        }
        const data = {
            version: 2,
            savedAt: Date.now(),
            patterns,
            globalStallRate: _globalStallRate,
            globalResponseCount: _globalResponseCount,
            globalStallCount: _globalStallCount,
        };
        fs.mkdirSync(_tuningDir, { recursive: true });
        fs.writeFileSync(_persistPath, JSON.stringify(data, null, 2), "utf-8");
    }
    catch (e) {
        log.warn(`⚠️ 保存 tuning 數據失敗: ${e.message}`);
    }
};
// ═══ Debounced 自動保存 ═══
let _saveTimer = null;
const _debouncedSave = () => {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        _save();
        _saveTimer = null;
    }, 5000); // 5 秒 debounce
};
// ═══ 行為狀態（持久化） ═══
/** @type {Map<string, {responses: number, stalls: number, completes: number, empties: number, rejects: number, avgLatency: number, lastAction: string, consecutiveStalls: number, promptStyle: string}>} */
const _patterns = new Map();
// 全域行為摘要（跨模型）
let _globalStallRate = 0;
let _globalResponseCount = 0;
let _globalStallCount = 0;
// 當前 prompt 風格（依行為動態切換）
let _currentPromptStyle = "normal"; // "normal" | "strict" | "gentle" | "urgent"
// 當前的停滯檢測敏感度（動態調整）
let _stallSensitivity = 1.0; // 0.5=寬鬆  1.0=正常  1.5=嚴格
let _consecutiveStallThreshold = 2; // 連續幾次停滯後改用更強 prompt
// ═══ 模組初始化：載入持久化數據 ═══
(() => {
    const data = _load();
    if (data) {
        _globalStallRate = data.globalStallRate || 0;
        _globalResponseCount = data.globalResponseCount || 0;
        _globalStallCount = data.globalStallCount || 0;
        if (data.patterns) {
            for (const [model, p] of Object.entries(data.patterns)) {
                _patterns.set(model, p);
            }
        }
    }
})();
// ═══ 公開 API ═══
/**
 * 記錄一次模型回應行為
 * @param {string} model - 模型名稱
 * @param {string} action - "stall" | "complete" | "empty" | "reject" | "tool_call"
 * @param {number} [latencyMs=0] - 延遲毫秒
 */
export const recordResponse = (model, action, latencyMs = 0) => {
    const key = model || "unknown";
    let p = _patterns.get(key);
    if (!p) {
        p = {
            responses: 0,
            stalls: 0,
            completes: 0,
            empties: 0,
            rejects: 0,
            avgLatency: 0,
            lastAction: action,
            consecutiveStalls: 0,
            promptStyle: "normal",
        };
        _patterns.set(key, p);
    }
    p.responses++;
    p.lastAction = action;
    // 更新延遲
    if (latencyMs > 0) {
        p.avgLatency =
            p.avgLatency > 0
                ? Math.round((p.avgLatency * (p.responses - 1) + latencyMs) / p.responses)
                : latencyMs;
    }
    // 依行為更新統計
    switch (action) {
        case "stall":
            p.stalls++;
            p.consecutiveStalls++;
            _globalStallCount++;
            break;
        case "complete":
        case "tool_call":
            p.completes++;
            p.consecutiveStalls = 0; // 完成則重置連續停滯
            break;
        case "empty":
            p.empties++;
            p.consecutiveStalls++;
            break;
        case "reject":
            p.rejects++;
            p.consecutiveStalls++;
            break;
    }
    _globalResponseCount++;
    // 根據行為動態調整 prompt 風格
    _adjustPromptStyle(key);
    // ═══ 持久化：debounced 保存 ═══
    _debouncedSave();
};
/**
 * 取得當前適應性 tool prompt（依模型行為動態調整）
 * @param {Array} tools - 工具定義陣列
 * @param {string} [model] - 當前模型名稱
 * @returns {string|null} 動態 tool prompt，或 null（無工具時）
 */
export const buildAdaptivePrompt = (tools, model) => {
    if (!tools?.length)
        return null;
    const names = tools.map((t) => t.function?.name || t.name).join(", ");
    const style = model
        ? _patterns.get(model)?.promptStyle || _currentPromptStyle
        : _currentPromptStyle;
    // 動態生成 prompt 基礎部分
    const base = `可用工具: ${names}。`;
    switch (style) {
        case "urgent":
            // 緊急模式：連續停滯後使用，但仍允許模型先思考
            return [
                "===== 請直接行動 =====",
                base,
                "請使用 bash 工具執行需要的操作。",
                "建立檔案用: cat > 'file.ts' << 'EOF'",
                "=====",
            ].join("\n");
        case "strict":
            // 嚴格模式：要求執行但允許模型先分析思考
            return [
                "===== 執行要求 =====",
                base,
                "請使用可用的工具來完成任務。",
                "建立檔案用: cat > '檔名' << 'EOF'",
                "複雜任務拆多個 bash 依次執行。",
                "===== 範例 =====",
                "  cat > 'script.ts' << 'EOF'",
                "  console.log('hello')",
                "  EOF",
                "  bun run script.ts",
                "===== 請直接執行 =====",
            ].join("\n");
        case "normal":
            // 一般模式（預設）：模型可先分析再執行
            return [
                "===== 任務指引 =====",
                base,
                "請根據任務需求使用工具。需要先分析就分析，準備好就直接執行。",
                "建立檔案格式: cat > 'path/file' << 'EOF'",
                "=====",
            ].join("\n");
        case "gentle":
            // 友善模式：模型抗拒時使用，給予最大彈性
            return [
                base,
                "請使用工具來完成任務。你可以先思考再執行，也可以直接執行。",
                "如果遇到困難，可以輸出你認為合理的命令。",
            ].join("\n");
        default:
            return null;
    }
};
/**
 * 取得當前路由提示
 * @param {string} model - 模型名稱
 * @returns {{level: string, reason: string}|null} 路由調整建議
 */
export const getRoutingHint = (model) => {
    const p = _patterns.get(model);
    if (!p || p.responses < 3)
        return null;
    const stallRate = p.stalls / p.responses;
    const emptyRate = p.empties / p.responses;
    if (stallRate > 0.5 || emptyRate > 0.3) {
        return {
            level: "downgrade",
            reason: `行爲異常: 停滯率 ${(stallRate * 100).toFixed(0)}%${emptyRate > 0.3 ? `, 空內容率 ${(emptyRate * 100).toFixed(0)}%` : ""}`,
        };
    }
    if (stallRate > 0.3 || emptyRate > 0.15) {
        return {
            level: "caution",
            reason: `行爲不穩定: 停滯率 ${(stallRate * 100).toFixed(0)}%`,
        };
    }
    return null;
};
/**
 * 取得動態化停滯檢查參數
 * @param {string} model - 模型名稱
 * @returns {{threshold: number, sensitivity: number, maxRetries: number}}
 */
export const getStallParams = (model) => {
    const p = _patterns.get(model);
    const base = {
        threshold: parseInt(process.env.STALL_THRESHOLD_MS || "30000"),
        sensitivity: _stallSensitivity,
        maxRetries: parseInt(process.env.MAX_STALL_RETRIES || "2"),
    };
    if (!p || p.responses < 3)
        return base;
    // 若模型有連續停滯，提高敏感度
    if (p.consecutiveStalls >= 2) {
        return {
            ...base,
            sensitivity: 1.5,
            maxRetries: Math.min(base.maxRetries + 1, 4),
        };
    }
    // 若模型表現良好，降低敏感度避免誤判
    if (p.completes > p.stalls * 3 && p.responses >= 5) {
        return {
            ...base,
            sensitivity: 0.7,
            maxRetries: Math.max(base.maxRetries - 1, 1),
        };
    }
    return base;
};
/**
 * 根據模型行為調整對應的矯正提示
 * @param {string} model
 * @param {number} retryCount - 目前第幾次重試（0-based）
 * @returns {string} 矯正訊息
 */
export const getCorrectionMessage = (model, retryCount) => {
    const p = _patterns.get(model);
    const consecutive = p?.consecutiveStalls || 0;
    if (retryCount >= 2 || consecutive >= 3) {
        return [
            "===== 請執行 =====",
            "請使用 bash 工具執行你剛才分析的步驟。",
            "範例:",
            "  mkdir -p src/components",
            "  cat > 'src/index.ts' << 'EOF'",
            "  console.log('hello')",
            "  EOF",
            "  bun run src/index.ts",
            "===== 請執行 =====",
        ].join("\n");
    }
    if (retryCount >= 1 || consecutive >= 2) {
        return [
            "===== 請執行 =====",
            "請使用 bash 工具執行任務。",
            "範例:",
            "  mkdir -p src/components",
            "  cat > 'src/index.ts' << 'EOF'",
            "  console.log('hello')",
            "  EOF",
            "  bun run src/index.ts",
            "===== 請執行 =====",
        ].join("\n");
    }
    return [
        "===== 請行動 =====",
        "請使用 bash 命令來完成任務。",
        "範例: cat > 'file.ts' << 'EOF' ... EOF",
    ].join("\n");
};
/**
 * 根據模型歷史行為提供動態超時建議（速度優化）
 * 慢速模型 → 放寬 timeout 避免誤殺
 * 快速模型 → 縮短 timeout 提升用戶體驗
 *
 * @param {string} model - 模型名稱
 * @param {number} [defaultTimeout=120000] - 預設超時 ms
 * @returns {number} 建議的超時毫秒數
 */
export const getTimeoutMs = (model, defaultTimeout = 120000) => {
    const p = _patterns.get(model);
    if (!p || p.responses < 3)
        return defaultTimeout;
    // 若模型有近期高延遲，適當放寬
    const hasStallHistory = p.stalls > 0 || p.empties > 0;
    const recentAvg = p.avgLatency;
    // 模型平均延遲 <10s 且無異常 → 縮短 timeout 加速回饋
    if (recentAvg < 10000 &&
        !hasStallHistory &&
        p.completes > p.responses * 0.8) {
        return Math.round(defaultTimeout * 0.7); // 縮短 30%
    }
    // 模型平均延遲 >45s 或有大量停滯 → 放寬 timeout
    if (recentAvg > 45000 || p.stalls > p.responses * 0.3) {
        return Math.round(defaultTimeout * 1.4); // 放寬 40%
    }
    // 模型平均延遲 25-45s → 適度放寬
    if (recentAvg > 25000) {
        return Math.round(defaultTimeout * 1.2);
    }
    return defaultTimeout;
};
/**
 * 重置特定模型的追蹤數據（供測試用）
 */
export const resetModel = (model) => {
    _patterns.delete(model);
};
/**
 * 取得目前所有模型的追蹤統計
 */
export const getStats = () => {
    const out = [];
    for (const [model, p] of _patterns) {
        out.push({
            model,
            responses: p.responses,
            stallRate: p.responses > 0 ? +(p.stalls / p.responses).toFixed(3) : 0,
            emptyRate: p.responses > 0 ? +(p.empties / p.responses).toFixed(3) : 0,
            avgLatency: p.avgLatency,
            consecutiveStalls: p.consecutiveStalls,
            promptStyle: p.promptStyle,
        });
    }
    return out.sort((a, b) => b.responses - a.responses);
};
export const getCurrentStyle = () => _currentPromptStyle;
/**
 * 強制立即保存（供 shutdown 時呼叫）
 */
export const flush = () => {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    _save();
    log.info("💾 tuning 數據已強制保存");
};
/**
 * 取得持久化路徑（供除錯用）
 */
export const getPersistPath = () => _persistPath;
// ═══ 內部方法 ═══
/**
 * 根據模型行為動態調整 prompt 風格
 */
const _adjustPromptStyle = (key) => {
    const p = _patterns.get(key);
    if (!p || p.responses < 2)
        return;
    const stallRate = p.stalls / p.responses;
    const emptyRate = p.empties / p.responses;
    const abnormalRate = (p.stalls + p.empties) / p.responses;
    // 決定 prompt 風格
    let newStyle;
    if (p.consecutiveStalls >= 3) {
        newStyle = "urgent";
    }
    else if (abnormalRate > 0.6 || stallRate > 0.4) {
        newStyle = "urgent";
    }
    else if (abnormalRate > 0.4 || stallRate > 0.25) {
        newStyle = "strict";
    }
    else if (abnormalRate > 0.15) {
        newStyle = "normal";
    }
    else {
        newStyle = "normal"; // 表現好也用 normal，不要一直用 strict
    }
    // ═══ Fix: 只更新 per-model 風格，全域 _currentPromptStyle 僅作初始預設 ═══
    // 舊行為：_currentPromptStyle 因單一模型行為改變，影響所有無資料的新模型
    // 新行為：每個模型獨立追蹤，新模型一律從 normal 開始
    if (newStyle !== p.promptStyle) {
        log.info(`🎛️  [${key}] prompt 風格: ${p.promptStyle} → ${newStyle}` +
            ` (停滯率 ${(stallRate * 100).toFixed(0)}%/空內容 ${(emptyRate * 100).toFixed(0)}%)`);
        p.promptStyle = newStyle;
    }
    // 同步更新敏感度
    if (abnormalRate > 0.4) {
        _stallSensitivity = Math.min(_stallSensitivity + 0.1, 1.5);
    }
    else if (abnormalRate < 0.1 && _stallSensitivity > 1.0) {
        _stallSensitivity = Math.max(_stallSensitivity - 0.1, 0.7);
    }
    // 根據全域行為調整參數
    if (_globalResponseCount > 0) {
        _globalStallRate = _globalStallCount / _globalResponseCount;
    }
};
// ═══ 進程退出時強制保存 ═══
// 避免進程意外終止時遺失 tuning 數據
process.on("exit", () => {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    try {
        _save();
    }
    catch (_) { }
});
process.on("SIGINT", () => {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    try {
        _save();
        process.exit(0);
    }
    catch (_) {
        process.exit(0);
    }
});
process.on("SIGTERM", () => {
    clearTimeout(_saveTimer);
    _saveTimer = null;
    try {
        _save();
        process.exit(0);
    }
    catch (_) {
        process.exit(0);
    }
});
//# sourceMappingURL=intelligent-tuning.js.map