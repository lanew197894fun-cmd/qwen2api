const crypto = require("crypto");
const { logger } = require("./logger");
const {
  getProxyAgent,
  getChatBaseUrl,
  applyProxyToFetchOptions,
} = require("./proxy-helper");

/**
 * 為 PKCE 生成隨機程式碼驗證器
 * @returns {string} 43-128個字元的隨機字串
 */
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * 使用 SHA-256 從程式碼驗證器生成程式碼挑戰
 * @param {string} codeVerifier - 程式碼驗證器字串
 * @returns {string} 程式碼挑戰字串
 */
function generateCodeChallenge(codeVerifier) {
  const hash = crypto.createHash("sha256");
  hash.update(codeVerifier);
  return hash.digest("base64url");
}

/**
 * 生成 PKCE 程式碼驗證器和挑戰對
 * @returns {Object} 包含 code_verifier 和 code_challenge 的物件
 */
function generatePKCEPair() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  return {
    code_verifier: codeVerifier,
    code_challenge: codeChallenge,
  };
}

class CliAuthManager {
  /**
   * 讀取響應體
   * @param {Response} response - Fetch 響應物件
   * @returns {Promise<*>} 響應體
   */
  async readResponseBody(response) {
    const contentType = response.headers.get("content-type") || "";
    const rawText = await response.text();

    if (!rawText) {
      return "";
    }

    if (contentType.includes("application/json")) {
      try {
        return JSON.parse(rawText);
      } catch (error) {
        return rawText;
      }
    }

    return rawText;
  }

  /**
   * 啟動 OAuth 裝置授權流程
   * @param {Object} [account] - Qwen 帳戶物件（用於解析帳號級代理）
   * @returns {Promise<Object>} 包含裝置程式碼、驗證URL和程式碼驗證器的物件
   */
  async initiateDeviceFlow(account) {
    // 生成 PKCE 程式碼驗證器和挑戰
    const { code_verifier, code_challenge } = generatePKCEPair();

    const bodyData = new URLSearchParams({
      client_id: "f0304373b74a44d2b584a3fb70ca9e56",
      scope: "openid profile email model.completion",
      code_challenge: code_challenge,
      code_challenge_method: "S256",
    });

    const chatBaseUrl = getChatBaseUrl();

    const fetchOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: bodyData,
    };

    applyProxyToFetchOptions(fetchOptions, account);
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 10000);
    fetchOptions.signal = ac.signal;

    try {
      const response = await fetch(
        `${chatBaseUrl}/api/v1/oauth2/device/code`,
        fetchOptions,
      );
      clearTimeout(tid);

      if (response.ok) {
        const result = await response.json();
        return {
          status: true,
          ...result,
          code_verifier: code_verifier,
        };
      } else {
        const responseBody = await this.readResponseBody(response);
        logger.error("CLI裝置授權初始化失敗", "CLI", "", {
          status: response.status,
          statusText: response.statusText,
          body: responseBody,
        });
        throw new Error("device_flow_failed");
      }
    } catch (error) {
      logger.error("CLI裝置授權流程異常", "CLI", "", {
        url: `${chatBaseUrl}/api/v1/oauth2/device/code`,
        message: error.message,
      });
      return {
        status: false,
        device_code: null,
        user_code: null,
        verification_uri: null,
        verification_uri_complete: null,
        expires_in: null,
        code_verifier: null,
      };
    }
  }

  /**
   * 授權登入
   * @param {string} user_code - 使用者程式碼
   * @param {string} access_token - 訪問令牌
   * @param {Object} [account] - Qwen 帳戶物件（用於解析帳號級代理）
   * @returns {Promise<boolean>} 是否授權成功
   */
  async authorizeLogin(user_code, access_token, account) {
    try {
      const chatBaseUrl = getChatBaseUrl();

      const fetchOptions = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${access_token}`,
        },
        body: JSON.stringify({
          approved: true,
          user_code: user_code,
        }),
      };

      applyProxyToFetchOptions(fetchOptions, account);

      const response = await fetch(
        `${chatBaseUrl}/api/v2/oauth2/authorize`,
        fetchOptions,
      );

      if (response.ok) {
        return true;
      } else {
        const responseBody = await this.readResponseBody(response);
        logger.error("CLI裝置授權確認失敗", "CLI", "", {
          status: response.status,
          statusText: response.statusText,
          body: responseBody,
        });
        throw new Error("authorize_failed");
      }
    } catch (error) {
      logger.error("CLI裝置授權確認異常", "CLI", "", {
        url: `${chatBaseUrl}/api/v2/oauth2/authorize`,
        message: error.message,
      });
      return false;
    }
  }

  /**
   * 輪詢獲取訪問令牌
   * @param {string} device_code - 裝置程式碼
   * @param {string} code_verifier - 程式碼驗證器
   * @param {Object} [account] - Qwen 帳戶物件（用於解析帳號級代理）
   * @returns {Promise<Object>} 訪問令牌資訊
   */
  async pollForToken(device_code, code_verifier, account) {
    let pollInterval = 5000;
    const maxAttempts = 3;
    const chatBaseUrl = getChatBaseUrl();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const bodyData = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: "f0304373b74a44d2b584a3fb70ca9e56",
        device_code: device_code,
        code_verifier: code_verifier,
      });

      const fetchOptions = {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: bodyData,
      };

      applyProxyToFetchOptions(fetchOptions, account);
      const ac3 = new AbortController();
      const tid3 = setTimeout(() => ac3.abort(), 10000);
      fetchOptions.signal = ac3.signal;

      try {
        const response = await fetch(
          `${chatBaseUrl}/api/v1/oauth2/token`,
          fetchOptions,
        );
        clearTimeout(tid3);

        if (response.ok) {
          const tokenData = await response.json();

          // 轉換為憑據格式
          const credentials = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || undefined,
            expiry_date: tokenData.expires_in
              ? Date.now() + tokenData.expires_in * 1000
              : undefined,
          };

          if (
            !credentials.access_token ||
            !credentials.refresh_token ||
            !credentials.expiry_date
          ) {
            logger.error(
              "CLI輪詢令牌成功但返回資料不完整",
              "CLI",
              "",
              tokenData,
            );
          }

          return credentials;
        }

        const responseBody = await this.readResponseBody(response);
        // 504 為上游閘道錯誤，重試無效，直接放棄
        if (response.status === 504) {
          logger.warn(`CLI輪詢令牌-上游504，放棄重試`, "CLI");
          return {
            status: false,
            access_token: null,
            refresh_token: null,
            expiry_date: null,
          };
        }
        logger.warn(
          `CLI輪詢令牌未完成 (${attempt + 1}/${maxAttempts})`,
          "CLI",
          "",
          {
            status: response.status,
            statusText: response.statusText,
            body: responseBody,
          },
        );

        // 等待5秒, 然後繼續輪詢
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        // 等待5秒, 然後繼續輪詢
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        logger.error(
          `CLI輪詢令牌異常 (${attempt + 1}/${maxAttempts})`,
          "CLI",
          "",
          {
            url: `${chatBaseUrl}/api/v1/oauth2/token`,
            message: error.message,
          },
        );
        continue;
      }
    }

    return {
      status: false,
      access_token: null,
      refresh_token: null,
      expiry_date: null,
    };
  }

  /**
   * 初始化 CLI 帳戶
   * @param {string} access_token - 訪問令牌
   * @param {Object} [account] - Qwen 帳戶物件（用於解析帳號級代理）
   * @returns {Promise<Object>} 帳戶資訊
   */
  async initCliAccount(access_token, account) {
    const deviceFlow = await this.initiateDeviceFlow(account);
    if (!deviceFlow.status) {
      logger.error("CLI帳戶初始化失敗：裝置授權流程未成功啟動", "CLI");
      return {
        status: false,
        access_token: null,
        refresh_token: null,
        expiry_date: null,
      };
    }

    if (
      !(await this.authorizeLogin(deviceFlow.user_code, access_token, account))
    ) {
      logger.error("CLI帳戶初始化失敗：裝置授權確認未通過", "CLI", "", {
        user_code: deviceFlow.user_code,
      });
      return {
        status: false,
        access_token: null,
        refresh_token: null,
        expiry_date: null,
      };
    }

    const cliToken = await this.pollForToken(
      deviceFlow.device_code,
      deviceFlow.code_verifier,
      account,
    );
    if (
      !cliToken.access_token ||
      !cliToken.refresh_token ||
      !cliToken.expiry_date
    ) {
      logger.error(
        "CLI帳戶初始化失敗：輪詢令牌返回資料不完整",
        "CLI",
        "",
        cliToken,
      );
    }
    return cliToken;
  }

  /**
   * 重新整理訪問令牌
   * @param {Object} CliAccount - 帳戶資訊
   * @param {Object} [account] - Qwen 帳戶物件（用於解析帳號級代理）
   * @returns {Promise<Object>} 帳戶資訊
   */
  async refreshAccessToken(CliAccount, account) {
    try {
      if (!CliAccount || !CliAccount.refresh_token) {
        throw new Error();
      }

      const chatBaseUrl = getChatBaseUrl();

      const bodyData = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: CliAccount.refresh_token,
        client_id: "f0304373b74a44d2b584a3fb70ca9e56",
      });

      const fetchOptions = {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: bodyData,
      };

      applyProxyToFetchOptions(fetchOptions, account);

      const response = await fetch(
        `${chatBaseUrl}/api/v1/oauth2/token`,
        fetchOptions,
      );

      if (response.ok) {
        const tokenData = await response.json();

        return {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || CliAccount.refresh_token,
          expiry_date: Date.now() + tokenData.expires_in * 1000,
        };
      }
    } catch (error) {
      return {
        status: false,
        access_token: null,
        refresh_token: null,
        expiry_date: null,
      };
    }
  }
}

module.exports = new CliAuthManager();
