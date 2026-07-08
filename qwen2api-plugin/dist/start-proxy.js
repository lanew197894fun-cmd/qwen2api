#!/usr/bin/env bun
/**
 * start-proxy.js — 獨立啟動 Chat Proxy（支援背景執行）
 * 用法: bun start-proxy.js
 *
 * 背景執行（可靠）:
 *   setsid bun start-proxy.js > /tmp/proxy.log 2>&1 &
 *   disown
 *
 * 設計原則：
 * - 背景模式（no TTY）：SIGHUP 忽略，設 keepalive 駐留
 * - 前景模式（有 TTY）：SIGHUP 觸發優雅關閉（drain → close）
 * - 關閉前先 drain 活躍 SSE 串流，避免對話框滯留
 */
import { startProxy, drainAndClose, getActiveSSECount } from "./chat-proxy.js";
import { onSafeSignal } from "./platform.js";
import { makeLogger } from "./color.js";
const log = makeLogger("proxy", "primary");
// ─── 背景模式偵測 ───
// 可透過 FOREGROUND=true 強制前景模式（即使 stdout 被 pipe）
const isBackground = !process.stdout.isTTY && process.env.FOREGROUND !== "true";
// 合併：EPIPE 靜默，其餘真實錯誤才噴（避免 parent pipe 斷掉時誤報）
const isPipeBreak = (e) => e?.code === "EPIPE" ||
    e?.code === "ECONNRESET" ||
    (e?.message || "").includes("write after end");
process.on("unhandledRejection", (e) => {
    if (isPipeBreak(e))
        return;
    log.error("💥 未捕捉 rejection:", e?.message || e);
});
process.on("uncaughtException", (e) => {
    if (isPipeBreak(e))
        return;
    log.error(`💥 未捕捉 exception: ${e.message}`);
    log.error("  ⚠️ 程序保持運行，請查看上方錯誤訊息並修復");
});
let server;
for (let retry = 0; retry < 3; retry++) {
    try {
        server = await startProxy();
        break;
    }
    catch (e) {
        log.error(`❌ 啟動失敗 (嘗試 ${retry + 1}/3): ${e.message}`);
        if (retry < 2)
            await new Promise((r) => setTimeout(r, 3000));
    }
}
if (!server) {
    log.error("❌ Chat Proxy 無法啟動，請檢查埠是否被佔用或 qwen2api 是否在執行");
    process.exit(1);
}
// ─── 背景模式 keepalive ───
// 背景執行（無 TTY）時，Node 的 HTTP server 雖會維持 event loop，
// 但為防止極端情況（系統 idle 太久、OS 發送特殊信號），設輕量定時器確保駐留
let keepaliveTimer = null;
if (isBackground) {
    keepaliveTimer = setInterval(() => { }, 60000);
    keepaliveTimer.unref(); // 不阻塞程序退出
    log.info(`🌙 背景模式：SIGHUP 已忽略，keepalive 已啟用`);
}
else {
    log.info(`🖥️  前景模式：SIGHUP 將觸發優雅關閉`);
}
// ─── 優雅關閉 ───
// 先 drain 活躍 SSE（發送 [DONE]），再關閉 server
const shutdown = async (sig) => {
    log.info(`🛑 收到 ${sig}，開始優雅關閉...`);
    const cnt = getActiveSSECount();
    if (cnt > 0) {
        log.info(`⏳ 等待 ${cnt} 個活躍 SSE 串流完成...`);
        await drainAndClose(server, 5000);
    }
    else {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
    }
    if (keepaliveTimer)
        clearInterval(keepaliveTimer);
    log.info(`✅ Proxy 已關閉`);
    process.exit(0);
};
// SIGHUP 策略：
// - 背景模式：忽略（終端機關閉不應殺死背景程序）
// - 前景模式：觸發優雅關閉
if (isBackground) {
    onSafeSignal("SIGHUP", () => {
        log.debug("SIGHUP 已忽略（背景模式）");
    });
}
else {
    onSafeSignal("SIGHUP", () => shutdown("SIGHUP"));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
//# sourceMappingURL=start-proxy.js.map