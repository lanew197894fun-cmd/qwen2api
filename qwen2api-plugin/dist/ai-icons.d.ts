/**
 * ai-icons.ts — AI 情境圖示系統
 *
 * 兩層圖示對應：
 *   1. work context  → 工作情境（code review → 🔍, debugging → 🐛）
 *   2. plugin type   → 插件類型（memory → 🧠, AI → 🤖）
 *   3. tool prefix   → 工具類別（knowledge → 📚, error → 🐛, conversation → 💬）
 */
export declare const WORK_ICONS: Record<string, string>;
export declare const PLUGIN_ICONS: Record<string, string>;
export declare const TOOL_PREFIX_ICONS: Record<string, string>;
export declare const PLUGIN_KEYWORD_ICONS: Record<string, string>;
export declare const DEFAULT_ICON = "\uD83D\uDCE6";
/** Emoji 寬度計算 — CLI 顯示校正 */
export declare function getDisplayWidth(text: string): number;
/** 根據字串取得對應的工作情境圖示 */
export declare function getWorkIcon(context: string): string;
/** 根據插件名稱/ID 取得對應的插件類型圖示 */
export declare function getPluginIcon(name: string): string;
/** 根據工具名稱前綴取得類別圖示 */
export declare function getToolIcon(name: string): string;
/** 根據插件狀態取得狀態圖示 */
export declare function getStatusIcon(status: string): string;
//# sourceMappingURL=ai-icons.d.ts.map