const os = require("os");

// 獲取CPU核心數
const cpuCores = os.cpus().length;

// 解析程式數配置
let instances = process.env.PM2_INSTANCES || 1;
if (instances === "max") {
  instances = cpuCores;
} else if (!isNaN(instances)) {
  instances = parseInt(instances);
} else {
  instances = 1;
}

// 限制程式數不能超過CPU核心數
if (instances > cpuCores) {
  console.log(
    `⚠️  警告: 配置的程式數(${instances})超過CPU核心數(${cpuCores})，自動調整為${cpuCores}`,
  );
  instances = cpuCores;
}

// ⚠️ 棄用注意：qwen2api 目前由 bun 直接啟動（plugin autoStart + systemd）
// PM2 不再管理此服務。此檔案保留僅供回顧。
// 若日後需重新啟用 PM2，請先確認 start.js 中的 cluster 邏輯已關閉
// （將 exec_mode 改為 'fork'，避免雙重 cluster 導致 EADDRINUSE）
module.exports = {
  apps: [
    {
      name: "qwen2api",
      script: "./src/server.js",
      instances: 1,
      exec_mode: "fork",

      // 環境變數
      env: {
        PM2_USAGE: "true",
      },

      // 日誌配置
      log_file: "./logs/pm2-combined.log",
      out_file: "./logs/pm2-out.log",
      error_file: "./logs/pm2-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // 程式管理配置
      max_memory_restart: process.env.PM2_MAX_MEMORY || "1G",
      min_uptime: "10s",
      max_restarts: 10,

      // 監聽檔案變化
      watch: false,
      ignore_watch: ["node_modules", "logs", "caches", "data"],

      // 其他配置
      merge_logs: true,
      time: true,
    },
  ],
};
