const axios = require("axios");
const accountManager = require("./account.js");
const config = require("../config/index.js");
const { logger } = require("./logger");
const { getSsxmodItna, getSsxmodItna2 } = require("./ssxmod-manager");
const {
  getProxyAgent,
  getChatBaseUrl,
  applyProxyToAxiosConfig,
} = require("./proxy-helper");
const { generateUUID } = require("./tools.js");
const { getInstance: getChromeFetch } = require("./chrome-fetch");

// 傳輸層（非 HTTP）錯誤碼 — 這些重試的, HTTP 回應不重試
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNABORTED",
  "EAI_AGAIN",
]);

const isRetryableNetworkError = (error) => {
  if (!error) return false;
  // 已收到 HTTP 回應 = 上游回包了, 不是傳輸問題
  if (error.response) return false;
  if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) return true;
  if (
    typeof error.message === "string" &&
    error.message.includes("socket hang up")
  )
    return true;
  return false;
};

// ═══ Fix 2026-07-06 (v2): WAF 阻擋判斷 — HTTP 403/503 視為 WAF 可重試 ═══
const isWafBlock = (error) => {
  if (!error || !error.response) return false;
  const status = error.response.status;
  // WAF 常見狀態碼：403 (Forbidden)、503 (Service Unavailable)、429 (Rate Limit)
  return status === 403 || status === 503 || status === 429;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ═══ Fix 2026-07-06 (v2): Chat ID 快取 — 跨請求復用減少 WAF 觸發 ═══
// 同一個 model 在同一次對話中復用 chat_id，避免每個請求都建新 chat
const _chatIdCache = new Map(); // model → { chatId, expiresAt }
const _CHAT_ID_TTL = 30 * 60 * 1000; // 30 分鐘過期

/**
 * 取得或建立 chat_id（快取優先）
 * @param {string} token - JWT token
 * @param {string} model - 模型名稱
 * @param {object|null} account - 帳戶物件
 * @returns {Promise<string|null>}
 */
const getCachedChatId = async (token, model, account) => {
  const now = Date.now();
  const cached = _chatIdCache.get(model);
  if (cached && cached.chatId && now < cached.expiresAt) {
    return cached.chatId;
  }

  // 快取未命中或過期 → 建立新 chat
  const chatId = await _doCreateChatId(token, model, account);
  if (chatId) {
    _chatIdCache.set(model, { chatId, expiresAt: now + _CHAT_ID_TTL });
    // 限制快取大小（避免記憶體洩漏）
    if (_chatIdCache.size > 50) {
      const firstKey = _chatIdCache.keys().next().value;
      _chatIdCache.delete(firstKey);
    }
  }
  return chatId;
};

/**
 * 清除指定模型的 chat_id 快取（當請求返回無效 chat 時呼叫）
 * @param {string} model
 */
const invalidateChatId = (model) => {
  _chatIdCache.delete(model);
};

/**
 * 實際呼叫上游 API 建立新 chat（抽離自 generateChatID）
 */
const _doCreateChatId = async (token, model, account) => {
  try {
    const chatBaseUrl = getChatBaseUrl();
    const proxyAgent = getProxyAgent(account);
    const requestConfig = {
      timeout: 20000,
      headers: {
        "sec-ch-ua-platform": '"Windows"',
        authorization: `Bearer ${token}`,
        referer: `${chatBaseUrl}/`,
        "accept-language": "zh-CN,zh;q=0.9",
        "sec-ch-ua":
          '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "content-type": "application/json",
        "bx-v": "2.5.36",
        accept: "*/*",
        "accept-encoding": "gzip, deflate, br, zstd",
        source: "web",
        version: "0.2.63",
        timezone: new Date().toString().replace(/GMT\+0800/, "GMT+0800"),
        "x-request-id": generateUUID(),
        connection: "keep-alive",
        cookie: `token=${token};ssxmod_itna=${getSsxmodItna()};ssxmod_itna2=${getSsxmodItna2()}`,
        host: chatBaseUrl.replace("https://", ""),
        origin: chatBaseUrl,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      },
    };
    if (proxyAgent) {
      requestConfig.httpsAgent = proxyAgent;
      requestConfig.proxy = false;
    }
    const response = await axios.post(
      `${chatBaseUrl}/api/v2/chats/new`,
      {
        title: "New Chat",
        models: [model],
        chat_mode: "normal",
        chat_type: "t2t",
        timestamp: new Date().getTime(),
      },
      requestConfig,
    );
    return response.data?.data?.id || null;
  } catch (error) {
    // WAF 阻擋時不記錄為 error（避免誤報）
    if (isWafBlock(error)) {
      logger.warn(
        `建立 chat_id 被 WAF 阻擋 (HTTP ${error.response?.status})，稍後重試`,
        "REQUEST",
      );
    } else {
      logger.error("建立 chat_id 失敗", "CHAT", "", error.message);
    }
    return null;
  }
};

/**
 * 發送聊天請求
 * @param {Object} body - 請求體
 * @returns {Promise<Object>} 回應結果
 */
const sendChatRequest = async (body) => {
  // 取得可用的賬戶（包含 proxy 等完整字段）
  const currentAccount = accountManager.getAccount();
  const currentToken = currentAccount ? currentAccount.token : null;

  if (!currentToken) {
    logger.error("無法取得有效的訪問令牌", "TOKEN");
    return { status: false, response: null };
  }

  // ====== Chrome Fetch Proxy (僅用於 SSE 串流，跳過 createChat) ======
  // ═══ Fix 2026-07-07: 只嘗試已有 chat_id 的 SSE 請求 ═══
  // Chrome 內的 POST fetch 會被 WAF 阻擋（redirect 關閉 page context），
  // 導致 createChat 永遠逾時 20s。axios+SSXMOD cookies 可繞過 WAF 建立 chat_id，
  // 因此 createChat 階段直接走 axios，已有 chat_id 時才嘗試 Chrome SSE 串流。
  const tryChromeSse = async () => {
    if (
      process.env.DISABLE_BROWSER === "true" ||
      process.env.CHROME_DISABLED === "true"
    )
      return null;
    // 若無 chat_id 且 body 沒帶 → Chrome 需要先 createChat，跳過（已知失敗）
    if (!body.chat_id) return null;
    try {
      const chromeFetch = getChromeFetch();
      if (!chromeFetch) return null;
      const result = await chromeFetch.sendChatRequest(body, currentAccount);
      if (result.status && result.response) {
        logger.network(`[Chrome Fetch] SSE 串流成功`, "REQUEST");
        return result;
      }
    } catch (e) {
      logger.warn(`[Chrome Fetch] 異常: ${e.message}`, "REQUEST");
    }
    return null;
  };

  const chromeResult = await tryChromeSse();
  if (chromeResult) return chromeResult;

  // ====== 降級路徑: axios (可能被 WAF 阻擋) ======
  const chatBaseUrl = getChatBaseUrl();
  const proxyAgent = getProxyAgent(currentAccount);

  const requestConfig = {
    headers: {
      "sec-ch-ua-platform": '"Windows"',
      authorization: `Bearer ${currentToken}`,
      referer: `${chatBaseUrl}/`,
      "accept-language": "zh-CN,zh;q=0.9",
      "sec-ch-ua":
        '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      "content-type": "application/json",
      "bx-v": "2.5.36",
      accept: "text/event-stream",
      "accept-encoding": "gzip, deflate, br, zstd",
      source: "web",
      version: "0.2.63",
      timezone: new Date().toString().replace(/GMT\+0800/, "GMT+0800"),
      "x-request-id": generateUUID(),
      connection: "keep-alive",
      cookie: `token=${currentToken};ssxmod_itna=${getSsxmodItna()};ssxmod_itna2=${getSsxmodItna2()}`,
      host: chatBaseUrl.replace("https://", ""),
      origin: chatBaseUrl,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-accel-buffering": "no",
    },
    responseType: "stream",
    timeout: 60 * 1000,
  };

  if (proxyAgent) {
    requestConfig.httpsAgent = proxyAgent;
    requestConfig.proxy = false;
  }

  // ═══ Fix 2026-07-06 (v3): 使用快取 chat_id 減少 WAF 觸發 ═══
  // 每次請求都建新 chat 會增加 WAF 觸發機會，改用 getCachedChatId
  // 同模型在 30 分鐘內復用同一 chat_id
  const chat_id = await getCachedChatId(
    currentToken,
    body.model,
    currentAccount,
  );

  // ═══ Fix 2026-07-04: chat_id 為 null 時跳過請求，避免上游收到 ?chat_id=null ═══
  if (!chat_id) {
    logger.error("產生chat_id失敗，無法發送請求", "REQUEST");
    return { status: false, response: null, error: "chat_id_failed" };
  }

  const url = `${chatBaseUrl}/api/v2/chat/completions?chat_id=` + chat_id;
  const payload = { ...body, stream: true, chat_id };

  const maxRetries = Math.max(0, parseInt(config.chatRetryCount, 10) || 0);
  const backoffMs = Math.max(0, parseInt(config.chatRetryBackoffMs, 10) || 0);
  const totalAttempts = maxRetries + 1;

  let lastError = null;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      if (attempt === 1) logger.network(`發送聊天請求 (axios)`, "REQUEST");
      const response = await axios.post(url, payload, requestConfig);
      if (response.status === 200) {
        return {
          currentToken,
          currentAccount,
          status: true,
          response: response.data,
        };
      }
      lastError = new Error(`Unexpected status ${response.status}`);
      lastError.response = { status: response.status };
      break;
    } catch (error) {
      lastError = error;
      // ═══ Fix v3: WAF 阻擋時清除快取，下次重試用新 chat_id ═══
      if (isWafBlock(error)) {
        invalidateChatId(body.model);
        logger.warn(
          `🧹 WAF 阻擋 (HTTP ${error.response?.status})，清除 chat_id 快取後重試`,
          "REQUEST",
        );
        // ═══ Fix 2026-07-07: WAF 觸發時嘗試恢復 Chrome Fetch ═══
        // Axios WAF 阻擋表示 cookie 不夠力，嘗試重新啟用 Chrome Fetch
        if (process.env.CHROME_DISABLED === "true") {
          logger.info("🔄 WAF 阻擋觸發 Chrome Fetch 自動恢復...", "REQUEST");
          process.env.CHROME_DISABLED = "false";
          process.env.DISABLE_BROWSER = "false";
        }
      }
      if (isRetryableNetworkError(error) && attempt < totalAttempts) {
        logger.warn(
          `聊天請求傳輸錯誤 (嘗試 ${attempt}/${totalAttempts}, code=${error.code || "unknown"}): ${error.message}`,
          "REQUEST",
        );
        if (backoffMs > 0) await delay(backoffMs);
        continue;
      }
      break;
    }
  }

  if (lastError && currentAccount?.email) {
    const hadHttpResponse = !!lastError.response;
    if (!hadHttpResponse && isRetryableNetworkError(lastError)) {
      logger.error(
        `聊天請求傳輸失敗 (已嘗試 ${totalAttempts} 次): ${lastError.message}`,
        "REQUEST",
      );
      logger.info(
        `賬戶 ${currentAccount.email} 標記失敗 (傳輸錯誤, 累計接近 cooldown)`,
        "ACCOUNT",
      );
      accountManager.recordAccountFailure(currentAccount.email, lastError.code);
    } else {
      const status = lastError.response?.status;
      logger.error("發送聊天請求失敗", "REQUEST", "", lastError.message);
      accountManager.recordAccountError(currentAccount.email, status);
      // ═══ Fix v3: WAF 阻擋時清除聊天 ID 快取，下次使用新 chat ═══
      if (isWafBlock(lastError)) {
        invalidateChatId(body.model);
        logger.warn(
          `🧹 WAF 阻擋 (HTTP ${status})，清除 ${body.model} 的 chat_id 快取`,
          "REQUEST",
        );
      }
    }
  } else if (lastError) {
    logger.error("發送聊天請求失敗", "REQUEST", "", lastError.message);
    // ═══ Fix v3: 無帳號情境也清除快取 ═══
    if (isWafBlock(lastError)) {
      invalidateChatId(body.model);
    }
  }

  return { status: false, response: null };
};

/**
 * 產生chat_id
 * @param {string} currentToken
 * @param {string} model
 * @param {Object} [account] - 目前賬戶物件（用於解析帳號級代理）
 * @returns {Promise<string|null>} 回傳產生的chat_id，如果失敗則回傳null
 */
const generateChatID = async (currentToken, model, account) => {
  // 直接走 axios + SSXMOD cookie 繞過 WAF
  // Chrome Fetch createChat 不走 page.evaluate（Node fetch 被 WAF 擋），跳過以省時
  try {
    const chatBaseUrl = getChatBaseUrl();
    const proxyAgent = getProxyAgent(account);

    const requestConfig = {
      timeout: 20000,
      headers: {
        "sec-ch-ua-platform": '"Windows"',
        authorization: `Bearer ${currentToken}`,
        referer: `${chatBaseUrl}/`,
        "accept-language": "zh-CN,zh;q=0.9",
        "sec-ch-ua":
          '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "content-type": "application/json",
        "bx-v": "2.5.36",
        accept: "*/*",
        "accept-encoding": "gzip, deflate, br, zstd",
        source: "web",
        version: "0.2.63",
        timezone: new Date().toString().replace(/GMT\+0800/, "GMT+0800"),
        "x-request-id": generateUUID(),
        connection: "keep-alive",
        cookie: `token=${currentToken};ssxmod_itna=${getSsxmodItna()};ssxmod_itna2=${getSsxmodItna2()}`,
        host: chatBaseUrl.replace("https://", ""),
        origin: chatBaseUrl,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      },
    };

    if (proxyAgent) {
      requestConfig.httpsAgent = proxyAgent;
      requestConfig.proxy = false;
    }

    const response_data = await axios.post(
      `${chatBaseUrl}/api/v2/chats/new`,
      {
        title: "New Chat",
        models: [model],
        chat_mode: "normal",
        chat_type: "t2t",
        timestamp: new Date().getTime(),
      },
      requestConfig,
    );

    return response_data.data?.data?.id || null;
  } catch (error) {
    logger.error("產生chat_id失敗", "CHAT", "", error.message);
    return null;
  }
};

module.exports = {
  sendChatRequest,
  generateChatID,
  getCachedChatId,
  invalidateChatId,
};
