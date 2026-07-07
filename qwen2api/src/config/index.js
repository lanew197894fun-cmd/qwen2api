const dotenv = require("dotenv");
dotenv.config();

/**
 * 解析 API_KEY 環境變數，支援逗號分隔的多個 key
 * @returns {Object} 包含 apiKeys 陣列和 adminKey 的物件
 */
const parseApiKeys = () => {
  const apiKeyEnv = process.env.API_KEY;
  if (!apiKeyEnv) {
    return { apiKeys: [], adminKey: null };
  }

  const keys = apiKeyEnv
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  return {
    apiKeys: keys,
    adminKey: keys.length > 0 ? keys[0] : null,
  };
};

const { apiKeys, adminKey } = parseApiKeys();

const config = {
  dataSaveMode: process.env.DATA_SAVE_MODE || "none",
  apiKeys: apiKeys,
  adminKey: adminKey,
  batchLoginConcurrency: Math.max(
    1,
    parseInt(process.env.BATCH_LOGIN_CONCURRENCY) || 5,
  ),
  simpleModelMap: process.env.SIMPLE_MODEL_MAP === "true" ? true : false,
  listenAddress:
    process.env.LISTEN_ADDRESS ||
    (process.env.TAILSCALE_IP ? "0.0.0.0" : "127.0.0.1"),
  listenPort: process.env.SERVICE_PORT || 3000,
  searchInfoMode: process.env.SEARCH_INFO_MODE === "table" ? "table" : "text",
  outThink: process.env.OUTPUT_THINK === "true" ? true : false,
  redisURL: process.env.REDIS_URL || null,
  autoRefresh: true,
  autoRefreshInterval: 6 * 60 * 60,
  cacheMode: process.env.CACHE_MODE || "default",
  logLevel: process.env.LOG_LEVEL || "INFO",
  enableFileLog: process.env.ENABLE_FILE_LOG === "true",
  logDir: process.env.LOG_DIR || "./logs",
  maxLogFileSize: parseInt(process.env.MAX_LOG_FILE_SIZE) || 10,
  maxLogFiles: parseInt(process.env.MAX_LOG_FILES) || 5,
  // 自定義反代 URL 配置
  qwenChatProxyUrl: process.env.QWEN_CHAT_PROXY_URL || "https://chat.qwen.ai",
  qwenCliProxyUrl: process.env.QWEN_CLI_PROXY_URL || "https://portal.qwen.ai",
  // 代理配置
  proxyUrl: process.env.PROXY_URL || null,
  // chat 請求重試配置（運行時可被 web UI 覆蓋，見 src/utils/data-persistence.js#loadSettings）
  chatRetryCount: Math.max(0, parseInt(process.env.CHAT_RETRY_COUNT, 10) || 1),
  chatRetryBackoffMs: Math.max(
    0,
    parseInt(process.env.CHAT_RETRY_BACKOFF_MS, 10) || 400,
  ),
  // 關閉 API Key 驗證（開發/內部環境）
  authDisabled: process.env.AUTH_DISABLED === "true",
};

module.exports = config;
