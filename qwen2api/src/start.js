// ⚡ dotenv 必須在 logger 之前載入，否則 env 變數不會生效
require("dotenv").config();

// 處理 --force 參數：清除埠佔用後重啟
const FORCE = process.argv.includes("--force");
if (FORCE) {
  const PORT = process.env.SERVICE_PORT || 3000;
  const { execSync } = require("child_process");
  try {
    const pid = execSync(`lsof -ti :${PORT} -sTCP:LISTEN 2>/dev/null`, {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    if (pid) {
      process.stdout.write(
        `[start] --force: 清除埠 ${PORT} 佔用 (PID ${pid})\n`,
      );
      execSync(`kill -9 ${pid} 2>/dev/null`, { timeout: 2000 });
      const start = Date.now();
      while (Date.now() - start < 5000) {
        try {
          execSync(`lsof -ti :${PORT} 2>/dev/null`, { timeout: 1000 });
        } catch {
          break;
        }
      }
    }
  } catch {}
}

const cluster = require("cluster");
const os = require("os");
const { logger } = require("./utils/logger");

// 取得CPU核心數
const cpuCores = os.cpus().length;

// 取得環境變數配置
const PM2_INSTANCES = process.env.PM2_INSTANCES || "1";
const SERVICE_PORT = process.env.SERVICE_PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "production";

// 解析行程數
let instances;
if (PM2_INSTANCES === "max") {
  instances = cpuCores;
} else if (!isNaN(PM2_INSTANCES)) {
  instances = parseInt(PM2_INSTANCES);
} else {
  instances = 1;
}

// 限制行程數不能超過CPU核心數
if (instances > cpuCores) {
  logger.warn(
    `配置的行程數(${instances})超過CPU核心數(${cpuCores})，自動調整為${cpuCores}`,
    "AUTO",
  );
  instances = cpuCores;
}

// 智慧判斷啟動方式
if (instances === 1) {
  require("./server.js");
} else {
  if (process.env.PM2_USAGE || process.env.pm_id !== undefined) {
    require("./server.js");
  } else if (cluster.isMaster) {
    logger.info(`🔥 使用Node.js叢集模式啟動 (${instances}個行程)`, "AUTO");
    for (let i = 0; i < instances; i++) cluster.fork();
    cluster.on("exit", (worker, code, signal) => {
      if (!worker.exitedAfterDisconnect) cluster.fork();
    });
    process.on("SIGTERM", () => {
      cluster.disconnect(() => process.exit(0));
    });
    process.on("SIGINT", () => {
      cluster.disconnect(() => process.exit(0));
    });
  } else {
    require("./server.js");
    process.on("SIGTERM", () => process.exit(0));
    process.on("SIGINT", () => process.exit(0));
  }
}
