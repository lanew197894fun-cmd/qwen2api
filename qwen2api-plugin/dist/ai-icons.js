/**
 * ai-icons.ts — AI 情境圖示系統
 *
 * 兩層圖示對應：
 *   1. work context  → 工作情境（code review → 🔍, debugging → 🐛）
 *   2. plugin type   → 插件類型（memory → 🧠, AI → 🤖）
 *   3. tool prefix   → 工具類別（knowledge → 📚, error → 🐛, conversation → 💬）
 */
// ─── 工作情境圖示 ───
export const WORK_ICONS = {
    site_inspection: "🦺",
    coffee_run: "☕",
    data_analysis: "📉",
    bug_fixing: "🕷️",
    client_call: "🤙",
    code_review: "🔍",
    deployment: "🚀",
    testing: "🧪",
    documentation: "📝",
    planning: "📋",
    debugging: "🐛",
    research: "🔬",
    meeting: "🤝",
    brainstorm: "💡",
    thinking: "🧠",
    writing: "✍️",
    reading: "📖",
    learning: "📚",
    idle: "⏸️",
    error: "😵",
    celebrating: "🎉",
};
// ─── 插件類型圖示 ───
export const PLUGIN_ICONS = {
    memory: "🧠",
    "memory-lancedb-pro": "🧠",
    ai: "🤖",
    qwen2api: "🤖",
    llm: "🤖",
    system: "⚙️",
    plugins: "🧩",
    "plugins-system": "🧩",
    ui: "🎨",
    knowledge: "📚",
    dev: "🔧",
    developer: "🔧",
    scaffold: "🏗️",
    security: "🔒",
    network: "🌐",
    data: "📊",
    test: "🧪",
    autonomous: "🤔",
    "autonomous-decision": "🤔",
    monitor: "📡",
    tool: "🛠️",
    git: "🐙",
    github: "🐙",
    chat: "💬",
    proxy: "🔁",
    bridge: "🌉",
};
// ─── 工具前綴圖示 ───
export const TOOL_PREFIX_ICONS = {
    knowledge: "📚",
    memory: "🧠",
    lesson: "⚠️",
    error: "🐛",
    conversation: "💬",
    debug: "🔧",
    system: "⚙️",
    plugin: "🧩",
    self: "🔄",
    tool: "🛠️",
};
// ─── 插件關鍵字 → 圖示（用於 plugin/info 與 plugin/search 的預測） ───
export const PLUGIN_KEYWORD_ICONS = {
    memory: "🧠",
    lancedb: "🗄️",
    vector: "📐",
    qwen: "🤖",
    ai: "🤖",
    llm: "🤖",
    openai: "🤖",
    claude: "🤖",
    gemini: "🤖",
    plugin: "🧩",
    system: "⚙️",
    scaffold: "🏗️",
    knowledge: "📚",
    wiki: "📖",
    doc: "📝",
    test: "🧪",
    stability: "🛡️",
    autonomous: "🤔",
    decision: "⚖️",
    monitor: "📡",
    debug: "🔧",
    repair: "🛠️",
    chat: "💬",
    proxy: "🔁",
    bridge: "🌉",
    git: "🐙",
    github: "🐙",
    security: "🔒",
    auth: "🔑",
    data: "📊",
    analytics: "📈",
    network: "🌐",
    api: "🔌",
    tool: "🛠️",
    util: "🔧",
};
// ─── 預設 ───
export const DEFAULT_ICON = "📦";
/** Emoji 寬度計算 — CLI 顯示校正 */
export function getDisplayWidth(text) {
    let w = 0;
    for (const ch of text) {
        const code = ch.codePointAt(0);
        if (code >= 0x1f300 && code <= 0x1f9ff) {
            w += 2;
            continue;
        }
        if (code >= 0x2600 && code <= 0x26ff) {
            w += 2;
            continue;
        }
        if (code >= 0x2700 && code <= 0x27bf) {
            w += 2;
            continue;
        }
        if (code >= 0x1100 && code <= 0x115f) {
            w += 2;
            continue;
        }
        if (code >= 0x2e80 && code <= 0x303e) {
            w += 2;
            continue;
        }
        if (code >= 0x3040 && code <= 0xa4cf) {
            w += 2;
            continue;
        }
        if (code >= 0xac00 && code <= 0xd7a3) {
            w += 2;
            continue;
        }
        if (code >= 0xff00 && code <= 0xff60) {
            w += 2;
            continue;
        }
        w += 1;
    }
    return w;
}
// ─── 解析函數 ───
/** 根據字串取得對應的工作情境圖示 */
export function getWorkIcon(context) {
    const key = context.toLowerCase().replace(/[\s_-]+/g, "_");
    for (const [k, icon] of Object.entries(WORK_ICONS)) {
        if (key.includes(k))
            return icon;
    }
    return DEFAULT_ICON;
}
/** 根據插件名稱/ID 取得對應的插件類型圖示 */
export function getPluginIcon(name) {
    const key = name.toLowerCase();
    // 精確匹配優先
    if (PLUGIN_ICONS[key])
        return PLUGIN_ICONS[key];
    // 部分匹配
    for (const [k, icon] of Object.entries(PLUGIN_ICONS)) {
        if (key.includes(k))
            return icon;
    }
    // 根據特徵推斷
    if (key.includes("memory") || key.includes("記憶"))
        return "🧠";
    if (key.includes("ai") || key.includes("llm") || key.includes("qwen"))
        return "🤖";
    if (key.includes("plugin") || key.includes("系統"))
        return "🧩";
    if (key.includes("knowledge") || key.includes("知識"))
        return "📚";
    if (key.includes("test") || key.includes("測試"))
        return "🧪";
    if (key.includes("dev") || key.includes("開發"))
        return "🔧";
    if (key.includes("monitor") || key.includes("監控"))
        return "📡";
    if (key.includes("security") || key.includes("安全"))
        return "🔒";
    return DEFAULT_ICON;
}
/** 根據工具名稱前綴取得類別圖示 */
export function getToolIcon(name) {
    const prefix = name.split("/")[0];
    if (TOOL_PREFIX_ICONS[prefix])
        return TOOL_PREFIX_ICONS[prefix];
    return DEFAULT_ICON;
}
/** 根據插件狀態取得狀態圖示 */
export function getStatusIcon(status) {
    switch (status) {
        case "active":
            return "✅";
        case "inactive":
            return "⏸️";
        case "development":
            return "🔧";
        case "installed":
            return "📦";
        case "error":
            return "❌";
        default:
            return "❓";
    }
}
//# sourceMappingURL=ai-icons.js.map