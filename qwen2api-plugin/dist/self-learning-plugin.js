/**
 * self-learning-plugin.js — 自我學習系統獨立 OpenCode 插件
 *
 * 可單獨被 OpenCode 載入，不依賴 qwen2api 或其他服務。
 * 提供學習工具、自動記錄、個人化推薦。
 *
 * 載入方式 (opencode.json):
 *   "plugin": ["file:///path/to/self-learning-plugin.js"]
 *
 * 或與主插件合併使用:
 *   "plugin": [
 *     "file:///path/to/index.js",
 *     "file:///path/to/self-learning-plugin.js"
 *   ]
 */
import { tool } from "@opencode-ai/plugin";
import { learnCodeStyle, learnResponseStyle, learnProblemSolving, recordInteraction, getLearningMetrics, resetLearningData, exportModel, importModel, getPersonalRecommendation, getInteractions, getConfig, updateConfig, getPrivacyInfo, getLearningSuggestions, summarizeMetrics, getProLevel, getPersona, getPersonaList, getTraits, setTrait, analyzeUserLevel, getProLevelPrompt, } from "./self-learning.js";
const ESC = {
    grn: "\x1b[32m",
    cyn: "\x1b[36m",
    yel: "\x1b[33m",
    red: "\x1b[31m",
    dim: "\x1b[2m",
    rst: "\x1b[0m",
};
// ═══ Fix 2026-07-06: 級別控制，預設只顯示 error，避免污染系統對話框
const _LOG_LEVEL = (() => {
    const raw = process.env.PROXY_LOG_LEVEL || process.env.LOG_LEVEL || "";
    const map = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
    if (raw && map[raw] !== undefined)
        return map[raw];
    return 1; // 預設 error
})();
const log = {
    ok: (...a) => {
        if (_LOG_LEVEL >= 2)
            console.log(`${ESC.grn}✓${ESC.rst}`, ...a);
    },
    info: (...a) => {
        if (_LOG_LEVEL >= 3)
            console.log(`${ESC.cyn}ℹ${ESC.rst}`, ...a);
    },
    warn: (...a) => {
        if (_LOG_LEVEL >= 2)
            console.log(`${ESC.yel}⚠${ESC.rst}`, ...a);
    },
    error: (...a) => {
        if (_LOG_LEVEL >= 1)
            console.log(`${ESC.red}✗${ESC.rst}`, ...a);
    },
};
// 將 "a.b.c" = val 轉成 {a: {b: {c: val}}}
function buildNested(key, val) {
    const segs = key.split(".");
    const out = {};
    let cur = out;
    for (let i = 0; i < segs.length - 1; i++) {
        cur[segs[i]] = {};
        cur = cur[segs[i]];
    }
    cur[segs[segs.length - 1]] = val;
    return out;
}
/** @type {import('@opencode-ai/plugin').Plugin} */
const Plugin = async (input) => {
    log.info("自我學習系統插件載入中...");
    return {
        tool: {
            // ═══ 學習工具 ═══
            self_learn_code_style: tool({
                description: "分析指定專案的程式碼風格（命名、縮排、錯誤處理、註解、引入偏好）。分析結果會儲存供後續個人化推薦使用。",
                args: {
                    projectPath: tool.schema
                        .string()
                        .describe("專案絕對路徑，如 /home/user/my-project"),
                },
                async execute(args) {
                    const r = await learnCodeStyle(args.projectPath);
                    if (r.error)
                        return `❌ ${r.error}`;
                    const lines = [];
                    lines.push("📊 **程式碼風格分析**");
                    lines.push(`  檔案: ${r.totalFiles} | 行數: ${r.totalLines}`);
                    const n = r.naming;
                    lines.push(`  📝 命名: camelCase ${n.camelCase}% | snake_case ${n.snake_case}% | PascalCase ${n.PascalCase}%`);
                    const i = r.indent;
                    lines.push(`  📐 縮排: 2空格 ${i.spaces2}% | 4空格 ${i.spaces4}% | Tab ${i.tabs}%`);
                    const e = r.errorHandling;
                    lines.push(`  ⚠️ 錯誤處理: tryCatch ${e.tryCatch}次 | earlyReturn ${e.earlyReturn}次`);
                    const c = r.comments;
                    lines.push(`  💬 註解: ${c.total} 處 | ESM: ${r.imports.esm} | CJS: ${r.imports.cjs}`);
                    lines.push(`\n✅ 已儲存風格資料，使用 \`self_learn_status\` 查看學習進度`);
                    return lines.join("\n");
                },
            }),
            self_learn_response_style: tool({
                description: "分析互動記錄中的回應偏好（長度分佈、代碼使用量、解釋深度）。",
                args: {},
                async execute() {
                    const interactions = getInteractions();
                    const r = learnResponseStyle(interactions);
                    const len = r.responseLength;
                    const total = len.short + len.medium + len.long || 1;
                    return [
                        "📊 **回應風格分析**",
                        `  短回應 (<100字): ${len.short} 次 (${+((len.short / total) * 100).toFixed(1)}%)`,
                        `  中回應 (100-500字): ${len.medium} 次 (${+((len.medium / total) * 100).toFixed(1)}%)`,
                        `  長回應 (>500字): ${len.long} 次 (${+((len.long / total) * 100).toFixed(1)}%)`,
                        `  代碼區塊: ${r.codeBlockUsage} 次`,
                        `  解釋深度: ${r.explanationDepth}/3`,
                        `\n✅ 持續記錄互動會讓分析更準確`,
                    ].join("\n");
                },
            }),
            self_record_feedback: tool({
                description: "記錄對 AI 回應的反饋，幫助系統學習你的偏好。支援三種反饋：accepted（完全接受）、edited（有修改）、rejected（拒絕）。",
                args: {
                    feedback: tool.schema
                        .string()
                        .describe("反饋類型: accepted / edited / rejected"),
                    prompt: tool.schema.string().optional().describe("原始提示（選填）"),
                    response: tool.schema
                        .string()
                        .optional()
                        .describe("回應內容（選填）"),
                },
                async execute(args) {
                    const fb = args.feedback || "accepted";
                    const m = recordInteraction(args.prompt || "", args.response || "", fb);
                    return `📝 **反饋已記錄**\n  類型: ${fb}\n  總資料: ${m.dataPoints} 筆 | 準確度: ${(m.accuracy * 100).toFixed(1)}% | Level ${m.level}`;
                },
            }),
            // ═══ 狀態與推薦 ═══
            self_learn_status: tool({
                description: "查看自我學習系統的完整狀態：層級、資料量、準確度、下一步建議。加 detail=full 看原始數據。",
                args: {
                    detail: tool.schema
                        .string()
                        .optional()
                        .describe("設 'full' 顯示完整原始數據"),
                },
                async execute(args) {
                    if (args.detail === "full") {
                        const all = getLearningMetrics();
                        const m = all.metrics;
                        let msg = `🧠 **自我學習系統** (完整)\n`;
                        msg += `  層級: Level ${m.level}\n`;
                        msg += `  資料: ${m.dataPoints} 筆 | 準確度 ${(m.accuracy * 100).toFixed(1)}%\n`;
                        msg += `  反饋: ✅${m.interactions.accepted} ✏️${m.interactions.edited} ❌${m.interactions.rejected}\n`;
                        if (all.codeStyle)
                            msg += `\n📝 程式碼風格: 已學習 (${all.codeStyle.totalFiles} 檔案)`;
                        if (all.responseStyle)
                            msg += `\n💬 回應風格: 已學習`;
                        if (all.knowledge?.toolUsage)
                            msg += `\n🔧 常用工具: ${Object.keys(all.knowledge.toolUsage).length} 種`;
                        return msg;
                    }
                    return summarizeMetrics();
                },
            }),
            self_learn_recommend: tool({
                description: "基於學習數據提供個人化建議：命名風格、縮排、錯誤處理策略、常用工具。",
                args: {},
                async execute() {
                    const r = getPersonalRecommendation();
                    let msg = `🎯 **個人化推薦**\n`;
                    msg += `  信心指數: ${(r.confidence * 100).toFixed(1)}%\n\n`;
                    msg += `**程式碼風格**\n  命名: ${r.codeStyle.naming}\n  縮排: ${r.codeStyle.indent > 0 ? `${r.codeStyle.indent} 空格` : "Tab"}\n\n`;
                    msg += `**策略**\n  錯誤處理: ${r.strategy}\n\n`;
                    if (r.tools.length)
                        msg += `**常用工具**\n  ${r.tools.map((t) => `• ${t}`).join("\n  ")}`;
                    return msg;
                },
            }),
            // ═══ 配置 ═══
            self_learn_config: tool({
                description: "檢視或修改自我學習配置。可用欄位: proLevel(1-5), personality(角色名), autoPersona(true/false), learningConsent(true/false), responseVerbosity(1-5), customPrompt(自定義角色描述)。不加參數 = 檢視目前配置。",
                args: {
                    key: tool.schema
                        .string()
                        .optional()
                        .describe("欄位名稱，如 proLevel、personality、autoPersona"),
                    value: tool.schema.string().optional().describe("欄位值"),
                },
                async execute(args) {
                    if (!args.key) {
                        const cfg = getConfig();
                        const pro = getProLevel();
                        const persona = getPersona();
                        const traits = getTraits();
                        const tips = getLearningSuggestions();
                        let msg = `⚙️ **自我學習配置**\n`;
                        msg += `  學習功能: ${cfg.learningConsent ? "🟢 開啟" : "🔴 關閉"}\n`;
                        msg += `  專業水平: ${pro.label} (${cfg.proLevel}/5)\n`;
                        msg += `  角色: ${persona.label || "無"}\n`;
                        msg += `  自動偵測: ${cfg.autoPersona ? "🟢 開啟" : "⚪ 關閉"}\n`;
                        msg += `  詳細度: ${cfg.responseVerbosity}/5\n`;
                        msg += `  語言: ${cfg.responseLang}\n`;
                        if (cfg.customPrompt)
                            msg += `  自訂義: ${cfg.customPrompt.slice(0, 60)}\n`;
                        msg += `\n🧬 個性:\n`;
                        for (const [k, v] of Object.entries(traits)) {
                            const meta = {
                                warmth: "🤗貼心",
                                proactive: "⚡積極",
                                depth: "📚深度",
                                patience: "🧘耐心",
                                humor: "😄幽默",
                            }[k] || k;
                            msg += `  ${meta}: ${"█".repeat(v)}${"░".repeat(5 - v)} (${v}/5)\n`;
                        }
                        if (tips.length) {
                            msg += `\n💡 **建議**\n`;
                            for (const t of tips.slice(0, 3))
                                msg += `  ${t}\n`;
                        }
                        msg += `\n✏️ 修改: \`self_learn_config key="欄位" value="值"\``;
                        return msg;
                    }
                    if (args.key === "personality" && args.value === "?") {
                        let msg = `🧑 **角色列表**\n`;
                        for (const p of getPersonaList()) {
                            msg += `  ${p.label} — ${p.desc}\n`;
                        }
                        msg += `\n自定義: \`self_learn_config key="customPrompt" value="你的描述"\``;
                        return msg;
                    }
                    let val = args.value;
                    if (val === "true")
                        val = true;
                    else if (val === "false")
                        val = false;
                    else if (/^\d+$/.test(val))
                        val = parseInt(val, 10);
                    const result = updateConfig({ [args.key]: val });
                    if (!result.changed.length)
                        return `⚠️ 無效欄位: ${args.key}`;
                    let extra = "";
                    if (args.key === "personality") {
                        const info = getPersona(val);
                        extra = `\n📖 ${info.label}: ${info.desc}`;
                    }
                    return `✅ 已更新 ${result.changed.join(", ")}${extra}`;
                },
            }),
            self_learn_trait: tool({
                description: "微調模型個性特質。維度: warmth(貼心), proactive(積極), depth(深度), patience(耐心), humor(幽默)，值 1-5。",
                args: {
                    key: tool.schema
                        .string()
                        .describe("特質名稱: warmth, proactive, depth, patience, humor"),
                    value: tool.schema.string().describe("數值 1-5"),
                },
                async execute(args) {
                    const r = setTrait(args.key, args.value);
                    if (!r.ok)
                        return `❌ ${r.error}`;
                    const meta = {
                        warmth: "🤗貼心",
                        proactive: "⚡積極",
                        depth: "📚深度",
                        patience: "🧘耐心",
                        humor: "😄幽默",
                    }[r.trait] || r.trait;
                    return `✅ ${meta} → ${r.val}/5\n  ${"█".repeat(r.val)}${"░".repeat(5 - r.val)}`;
                },
            }),
            self_learn_analyze: tool({
                description: "分析你的問題風格，自動推薦適合的角色與回應模式。",
                args: {
                    message: tool.schema.string().describe("你的問題或文字內容"),
                },
                async execute(args) {
                    const r = analyzeUserLevel(args.message);
                    let msg = `🔍 **分析結果**\n`;
                    msg += `  推薦: ${r.label}\n`;
                    if (r.reason)
                        msg += `  依據: ${r.reason}\n`;
                    if (r.persona) {
                        const info = getPersona(r.persona);
                        msg += `\n📖 ${info.desc}\n`;
                    }
                    return msg;
                },
            }),
            self_learn_export: tool({
                description: "匯出個人化模型為 JSON 檔案，用於備份或轉移到其他機器。",
                args: {},
                async execute() {
                    const r = exportModel();
                    return `📦 模型已匯出\n  路徑: ${r.path}\n  大小: ${(r.size / 1024).toFixed(1)} KB`;
                },
            }),
            self_learn_prompt: tool({
                description: "預覽目前設定的 system prompt 內容，包含專業水平、角色、個性特質的完整提示。",
                args: {
                    message: tool.schema
                        .string()
                        .optional()
                        .describe("模擬用戶訊息（啟用 autoPersona 時有效）"),
                },
                async execute(args) {
                    const p = getProLevelPrompt(undefined, undefined, args.message || "");
                    return `📋 **System Prompt 預覽**\n\n${p}`;
                },
            }),
            self_learn_reset: tool({
                description: "⚠️ 重置所有學習資料（程式碼風格、回應偏好、互動記錄、指標）。此操作不可回復。",
                args: {},
                async execute() {
                    resetLearningData();
                    return "🔄 所有學習資料已清空。";
                },
            }),
            // ═══ 配置管理 ═══
            self_config_get: tool({
                description: "讀取 OpenCode 系統設定。不加 key 顯示概要，指定 key 顯示特定欄位值。支援點記法如 providers.openai.apiKey。",
                args: {
                    key: tool.schema
                        .string()
                        .optional()
                        .describe("設定路徑，如 plugin、provider、model。留空顯示全部"),
                },
                async execute(args) {
                    try {
                        const url = input.serverUrl ?? new URL("http://localhost:4096");
                        const res = await fetch(new URL("/config", url));
                        if (!res.ok)
                            return `❌ 讀取設定失敗: ${res.status}`;
                        const cfg = await res.json();
                        if (args.key) {
                            const val = args.key.split(".").reduce((o, k) => o?.[k], cfg);
                            if (val === undefined)
                                return `❌ 找不到設定: ${args.key}`;
                            return [
                                `🔍 **${args.key}**`,
                                "",
                                "```json",
                                JSON.stringify(val, null, 2),
                                "```",
                            ].join("\n");
                        }
                        const lines = ["⚙️ **OpenCode 系統設定**"];
                        if (cfg.plugin?.length)
                            lines.push(`\n📦 **插件** (${cfg.plugin.length}):\n  ${cfg.plugin.join("\n  ")}`);
                        if (cfg.provider)
                            lines.push(`\n🤖 **供應商**: ${Object.keys(cfg.provider).join(", ")}`);
                        if (cfg.model)
                            lines.push(`\n🧠 **模型**: ${cfg.model}`);
                        const providerCount = cfg.providers?.length ?? Object.keys(cfg.provider ?? {}).length;
                        if (providerCount)
                            lines.push(`\n🔌 **已設定供應商**: ${providerCount}`);
                        lines.push('\n💡 查看特定設定: `self_config_get key="欄位"`');
                        return lines.join("\n");
                    }
                    catch (err) {
                        return `❌ 讀取設定異常: ${err instanceof Error ? err.message : String(err)}`;
                    }
                },
            }),
            self_config_set: tool({
                description: "修改 OpenCode 系統設定。支援點記法如 providers.openai.apiKey。值會以 JSON 型別解析（數字、布林、陣列、物件）。",
                args: {
                    key: tool.schema
                        .string()
                        .describe("設定路徑，如 plugin、model、provider.anthropic.apiKey"),
                    value: tool.schema
                        .string()
                        .describe("設定值。自動推斷型別：true/false→布林、數字→數字、[]/{}→物件"),
                },
                async execute(args) {
                    try {
                        let parsed;
                        try {
                            parsed = JSON.parse(args.value);
                        }
                        catch {
                            parsed = args.value;
                        }
                        const body = buildNested(args.key, parsed);
                        const url = input.serverUrl ?? new URL("http://localhost:4096");
                        const res = await fetch(new URL("/global/config", url), {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(body),
                        });
                        if (!res.ok) {
                            const text = await res.text().catch(() => "");
                            return `❌ 更新失敗 (${res.status}): ${text}`;
                        }
                        return `✅ **設定已更新**\n  ${args.key} → ${JSON.stringify(parsed)}\n💡 可用 \`self_config_get key="${args.key}"\` 確認`;
                    }
                    catch (err) {
                        return `❌ 更新設定異常: ${err instanceof Error ? err.message : String(err)}}`;
                    }
                },
            }),
        },
        // ═══ 事件：自動記錄工具使用 ═══
        event: async ({ event }) => {
            if (event?.name?.includes("Tool") || event?.type === "tool") {
                const toolName = event?.tool?.name || event?.name;
                if (toolName && !toolName.startsWith("self_")) {
                    learnProblemSolving([toolName]);
                }
            }
        },
        // ═══ 系統提示注入（含即時學習狀態） ═══
        "experimental.chat.system.transform": async (_input, output) => {
            const m = getLearningMetrics().metrics;
            const level = m.level, acc = (m.accuracy * 100).toFixed(0);
            output.system.push(`\n<plugin_info name="self-learning">
自我學習系統 Level ${level}・準確度 ${acc}%
可用工具（AI 函式呼叫）：self_learn_*（配置/學習/分析）| self_config_*（系統設定）
用法範例：呼叫 self_learn_trait 工具調整語氣，呼叫 self_record_feedback 記錄偏好
注意：以上均為 AI 函式呼叫工具，不可透過 bash 執行。
</plugin_info>`);
        },
    };
};
export default Plugin;
export { Plugin };
//# sourceMappingURL=self-learning-plugin.js.map