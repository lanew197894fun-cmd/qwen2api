#!/usr/bin/env bun
/**
 * start-proxy.js — 獨立啟動 Chat Proxy（支援背景執行）
 * 用法: bun start-proxy.js
 *
 * 背景執行（可靠）:
 *   setsid bun start-proxy.js > /tmp/proxy.log 2>&1 &
 *   disown
 */
import { startProxy } from "./chat-proxy.js";
import { onSafeSignal } from "./platform.js";

const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const LV = (() => {
  const raw = process.env.PROXY_LOG_LEVEL;
  if (raw && LOG_LEVELS[raw] !== undefined) return LOG_LEVELS[raw];
  if (process.env.PROXY_QUIET === "true" || process.env.PROXY_QUIET === "1")
    return 0;
  return 2; // 預設 warn
})();
const log = {
  info: (...a) => {
    if (LV >= 3) console.log("[proxy]", ...a);
  },
  error: (...a) => {
    if (LV >= 1) console.error("[proxy]", ...a);
  },
};

process.on("unhandledRejection", (e) => {
  log.error("💥 未捕捉 rejection:", e?.message || e);
});
process.on("uncaughtException", (e) => {
  log.error("💥 未捕捉 exception:", e?.message || e);
});

// SIGHUP 忽略（支援 nohup/setsid 背景執行，Windows 無此信號）
onSafeSignal("SIGHUP", () => {});

try {
  var server = await startProxy();
} catch (e) {
  log.error(`❌ 啟動失敗: ${e.message}`);
  process.exit(1);
}

// 定期 keepalive（維持 event loop）
const keepalive = setInterval(() => {}, 60000);

const shutdown = (sig) => {
  log.info(`收到 ${sig}，關閉中...`);
  clearInterval(keepalive);
  server.close(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// EADDRINUSE 等嚴重錯誤不應被靜默吞掉，直接 exit
process.on("uncaughtException", (e) => {
  log.error(`💥 未捕捉 exception: ${e.message}`);
  process.exit(1);
});
