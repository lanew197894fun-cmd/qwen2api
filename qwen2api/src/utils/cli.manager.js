const crypto = require("crypto");
const { logger } = require("./logger");
const {
  getProxyAgent,
  getChatBaseUrl,
  applyProxyToFetchOptions,
} = require("./proxy-helper");

/**
 * 為 PKCE 產生隨機代碼驗證器
 * @returns {string} 43-128個字符的隨機字符串
 */
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * 使用 SHA-256 從代碼驗證器產生代碼挑戰
 * @param {string} codeVerifier - 代碼驗證器字符串
 * @returns {string} 代碼挑戰字符串
 */
function generateCodeChallenge(codeVerifier) {
  const hash = crypto.createHash("sha256");
  hash.update(codeVerifier);
  return hash.digest("base64url");
}

/**
 * 產生 PKCE 代碼驗證器和挑戰對
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
   * 讀取回應體
   * @param {Response} response - Fetch 回應物件
   * @returns {Promise<*>} 回應體
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
   * 啟動 OAuth 設備授權流程
   * @param {Object} [account] - Qwen 賬戶物件（用於解析帳號級代理）
   * @returns {Promise<Object>} 包含設備代碼、驗證URL和代碼驗證器的物件
   */
  async initiateDeviceFlow(account) {
    // 產生 PKCE 代碼驗證器和挑戰
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
      signal: AbortSignal.timeout(10000),
    };

    applyProxyToFetchOptions(fetchOptions, account);

    try {
      const response = await fetch(
        `${chatBaseUrl}/api/v1/oauth2/device/code`,
        fetchOptions,
      );

      if (response.ok) {
        const result = await response.json();
        return {
          status: true,
          ...result,
          code_verifier: code_verifier,
        };
      } else {
        const responseBody = await this.readResponseBody(response);
        logger.error("CLI設備授權初始化失敗", "CLI", "", {
          status: response.status,
          statusText: response.statusText,
          body: responseBody,
        });
        throw new Error("device_flow_failed");
      }
    } catch (error) {
      logger.error("CLI設備授權流程異常", "CLI", "", {
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
   * @param {string} user_code - 使用者代碼
   * @param {string} access_token - 訪問令牌
   * @param {Object} [account] - Qwen 賬戶物件（用於解析帳號級代理）
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
        signal: AbortSignal.timeout(10000),
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
        logger.error("CLI設備授權確認失敗", "CLI", "", {
          status: response.status,
          statusText: response.statusText,
          body: responseBody,
        });
        throw new Error("authorize_failed");
      }
    } catch (error) {
      logger.error("CLI設備授權確認異常", "CLI", "", {
        url: `${chatBaseUrl}/api/v2/oauth2/authorize`,
        message: error.message,
      });
      return false;
    }
  }

  /**
   * 輪詢取得訪問令牌
   * @param {string} device_code - 設備代碼
   * @param {string} code_verifier - 代碼驗證器
   * @param {Object} [account] - Qwen 賬戶物件（用於解析帳號級代理）
   * @returns {Promise<Object>} 訪問令牌資訊
   */
  async pollForToken(device_code, code_verifier, account) {
    const maxAttempts = 1;
    const timeoutMs = 8000;
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
        signal: AbortSignal.timeout(timeoutMs),
      };

      applyProxyToFetchOptions(fetchOptions, account);

      try {
        const response = await fetch(
          `${chatBaseUrl}/api/v1/oauth2/token`,
          fetchOptions,
        );

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
              "CLI輪詢令牌成功但回傳資料不完整",
              "CLI",
              "",
              tokenData,
            );
          }

          return credentials;
        }

        const responseBody = await this.readResponseBody(response);
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
      } catch (error) {
        logger.error(
          `CLI輪詢令牌異常 (${attempt + 1}/${maxAttempts})`,
          "CLI",
          "",
          {
            url: `${chatBaseUrl}/api/v1/oauth2/token`,
            message: error.message,
          },
        );
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
   * 初始化 CLI 賬戶
   * @param {string} access_token - 訪問令牌
   * @param {Object} [account] - Qwen 賬戶物件（用於解析帳號級代理）
   * @returns {Promise<Object>} 賬戶資訊
   */
  async initCliAccount(access_token, account) {
    const deviceFlow = await this.initiateDeviceFlow(account);
    if (!deviceFlow.status) {
      logger.error("CLI賬戶初始化失敗：設備授權流程未成功啟動", "CLI");
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
      logger.error("CLI賬戶初始化失敗：設備授權確認未通過", "CLI", "", {
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
        "CLI賬戶初始化失敗：輪詢令牌回傳資料不完整",
        "CLI",
        "",
        cliToken,
      );
    }
    return cliToken;
  }

  /**
   * 重新整理訪問令牌
   * @param {Object} CliAccount - 賬戶資訊
   * @param {Object} [account] - Qwen 賬戶物件（用於解析帳號級代理）
   * @returns {Promise<Object>} 賬戶資訊
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
        signal: AbortSignal.timeout(8000),
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
