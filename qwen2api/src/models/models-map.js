const axios = require("axios");
const accountManager = require("../utils/account.js");
const { getSsxmodItna, getSsxmodItna2 } = require("../utils/ssxmod-manager");
const {
  getProxyAgent,
  getChatBaseUrl,
  applyProxyToAxiosConfig,
} = require("../utils/proxy-helper");
const { generateUUID } = require("../utils/tools.js");
const { logger } = require("../utils/logger");

let cachedModels = null;
let fetchPromise = null;

const getLatestModels = async (force = false) => {
  if (cachedModels && !force) return cachedModels;
  if (fetchPromise) return fetchPromise;

  const chatBaseUrl = getChatBaseUrl();
  const account = accountManager.getAccount();
  const proxyAgent = getProxyAgent(account);
  const token = account ? account.token : "";

  // 嘗試用 Chrome Fetch 取得模型列表 (繞過 WAF)
  const tryChromeFetch = async () => {
    try {
      const { getInstance } = require("../utils/chrome-fetch");
      const chromeFetch = getInstance();
      const result = await chromeFetch.fetch(`${chatBaseUrl}/api/v2/configs/`, {
        headers: { source: "web", version: "0.2.67" },
      });
      if (!result || !result.ok) return null;
      const data = JSON.parse(result.body);
      if (data?.success && data?.data) {
        const raw = data.data;
        if (Array.isArray(raw)) return raw;
        if (raw?.models && Array.isArray(raw.models)) return raw.models;
        logger.warn(
          "Chrome Fetch /api/v2/configs/ 回傳非陣列格式，嘗試 /api/v2/models/",
          "MODEL",
        );
        return null;
      }
    } catch (e) {
      logger.warn(`Chrome Fetch 取得模型列表失敗: ${e.message}`, "MODEL");
    }
    return null;
  };

  const tryChromeFetchModels = async () => {
    try {
      const { getInstance } = require("../utils/chrome-fetch");
      const chromeFetch = getInstance();
      const result = await chromeFetch.fetch(`${chatBaseUrl}/api/v2/models/`, {
        headers: {
          source: "web",
          version: "0.2.67",
          Authorization: token ? "Bearer " + token : "",
        },
      });
      if (!result || !result.ok) return null;
      const data = JSON.parse(result.body);
      if (data?.success && Array.isArray(data?.data)) {
        return data.data;
      }
    } catch (e) {
      logger.warn(
        `Chrome Fetch 取得 /api/v2/models/ 失敗: ${e.message}`,
        "MODEL",
      );
    }
    return null;
  };

  fetchPromise = (async () => {
    const TIMEOUT_MS = 30000;
    const deadline = Date.now() + TIMEOUT_MS;

    if (Date.now() < deadline) {
      const modelsData = await tryChromeFetchModels();
      if (modelsData) {
        cachedModels = modelsData;
        fetchPromise = null;
        return cachedModels;
      }
    }

    if (Date.now() < deadline) {
      const configData = await tryChromeFetch();
      if (configData) {
        cachedModels = configData;
        fetchPromise = null;
        return cachedModels;
      }
    }

    if (Date.now() < deadline) {
      try {
        const requestConfig = {
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
            ...(token && {
              cookie: `token=${token};ssxmod_itna=${getSsxmodItna()};ssxmod_itna2=${getSsxmodItna2()}`,
            }),
            origin: chatBaseUrl,
            host: chatBaseUrl.replace("https://", ""),
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
          },
        };
        if (proxyAgent) {
          requestConfig.httpsAgent = proxyAgent;
          requestConfig.proxy = false;
        }
        const response = await axios.get(
          `${chatBaseUrl}/api/models`,
          requestConfig,
        );
        cachedModels = response.data.data || [];
      } catch (error) {
        logger.error(`取得模型列表失敗: ${error.message}`, "MODEL");
        cachedModels = [];
      }
    } else {
      logger.warn("取得模型列表超時 (30s)，使用空陣列", "MODEL");
      cachedModels = [];
    }

    fetchPromise = null;
    return cachedModels;
  })();

  return fetchPromise;
};

const getDefaultModelByChatType = async (chatType) => {
  const models = await getLatestModels();
  const matchedModel = models.find((model) =>
    model?.info?.meta?.chat_type?.includes(chatType),
  );
  return matchedModel?.id || null;
};

module.exports = {
  getLatestModels,
  getDefaultModelByChatType,
};
