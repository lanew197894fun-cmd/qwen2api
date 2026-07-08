/**
 * 自動判斷入口
 * @param {Object} ctx
 * @param {"error"|"fix"|"repeat"|"feedback"} ctx.type
 * @param {string} ctx.title - 簡短標題
 * @param {string} ctx.detail - 詳細描述/錯誤訊息
 * @param {string} [ctx.fix] - 解決方案（type=fix 時必填）
 * @param {number} [ctx.count=1] - 發生次數
 * @param {string} [ctx.source] - 來源（request/event/tool）
 * @returns {Promise<{action: string, target: string|null}>}
 */
export function autoJudge(ctx: {
    type: "error" | "fix" | "repeat" | "feedback";
    title: string;
    detail: string;
    fix?: string | undefined;
    count?: number | undefined;
    source?: string | undefined;
}): Promise<{
    action: string;
    target: string | null;
}>;
//# sourceMappingURL=auto-judge.d.ts.map