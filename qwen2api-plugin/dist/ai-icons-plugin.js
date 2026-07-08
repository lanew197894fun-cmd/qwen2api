/**
 * ai-icons-plugin.js — AI 情境圖示系統獨立插件
 *
 * 提供 plugin_icon 工具，讓 AI 在對話中查詢任何文字對應的 Emoji 圖示。
 * 支援工作情境、插件類型、工具前綴、狀態四種分類。
 */
import { tool } from "@opencode-ai/plugin";
import { getWorkIcon, getPluginIcon, getToolIcon, getStatusIcon, DEFAULT_ICON, } from "./ai-icons.ts";
/** 統一分派：auto 模式自動判斷類別 */
function getAIIcon(q) {
    const lq = q.toLowerCase();
    // 狀態關鍵字優先
    if ([
        "active",
        "inactive",
        "error",
        "installed",
        "development",
        "done",
        "pending",
        "success",
        "fail",
    ].some((k) => lq.includes(k)))
        return getStatusIcon(lq);
    // 工作情境關鍵字
    if ([
        "code review",
        "debug",
        "deploy",
        "test",
        "write",
        "read",
        "learn",
        "plan",
        "research",
        "meet",
        "fix",
    ].some((k) => lq.includes(k)))
        return getWorkIcon(lq);
    // 插件/工具名稱
    return getPluginIcon(lq);
}
const Plugin = async () => {
    return {
        tool: {
            plugin_icon: tool({
                description: "查詢 AI 工作情境/插件/工具對應的 Emoji 圖示。用於在對話中為任務添加視覺標記。",
                args: {
                    query: tool.schema
                        .string()
                        .describe("查詢關鍵字（插件名稱、工作情境、工具名稱或任意文字）"),
                    type: tool.schema
                        .string()
                        .optional()
                        .describe("查詢類型：auto=自動偵測, work=工作情境, plugin=插件, tool=工具, status=狀態"),
                },
                async execute(args) {
                    const q = args.query.toLowerCase();
                    const mode = args.type || "auto";
                    let out = `🔍 圖示查詢: "${args.query}"\n${"─".repeat(36)}\n\n`;
                    if (mode === "auto") {
                        const icon = getAIIcon(q);
                        out += `${icon}  ${args.query}\n\n${"─".repeat(36)}`;
                        out += `\n💡 自動匹配結果`;
                        out += `\n💡 使用 type=work/plugin/tool/status 指定查詢類別`;
                    }
                    else {
                        let icon = DEFAULT_ICON;
                        let src = mode;
                        switch (mode) {
                            case "work":
                                icon = getWorkIcon(q);
                                break;
                            case "plugin":
                                icon = getPluginIcon(q);
                                break;
                            case "tool":
                                icon = getToolIcon(q);
                                break;
                            case "status":
                                icon = getStatusIcon(q);
                                break;
                        }
                        out += `${icon}  ${src}: ${args.query}\n`;
                    }
                    out += `\n💡 圖示來源: ai-icons (情境圖示系統)`;
                    return out;
                },
            }),
        },
    };
};
export default Plugin;
export { Plugin };
//# sourceMappingURL=ai-icons-plugin.js.map