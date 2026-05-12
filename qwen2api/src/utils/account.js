const config = require("../config/index.js");
const DataPersistence = require("./data-persistence");
const TokenManager = require("./token-manager");
const AccountRotator = require("./account-rotator");
const { logger } = require("./logger");
/**
 * 帳戶管理器
 * 統一管理帳戶、令牌、模型等功能
 */
class Account {
  constructor() {
    // 初始化各個管理器
    this.dataPersistence = new DataPersistence();
    this.tokenManager = new TokenManager();
    this.accountRotator = new AccountRotator();

    // 帳戶資料
    this.accountTokens = [];
    this.isInitialized = false;

    // 配置資訊
    this.defaultHeaders = config.defaultHeaders || {};

    // cli請求次數定時重新整理器
    this.cliRequestNumberInterval = null;
    this.cliDailyResetInterval = null;

    // 初始化
    this._initialize();
  }

  /**
   * 非同步初始化
   * @private
   */
  async _initialize() {
    try {
      // 載入帳戶資訊
      await this.loadAccountTokens();

      // 設定定期重新整理令牌
      if (config.autoRefresh) {
        this.refreshInterval = setInterval(
          () => this.autoRefreshTokens(),
          (config.autoRefreshInterval || 21600) * 1000, // 預設6小時
        );
      }

      this.isInitialized = true;
      logger.success(
        `帳戶管理器初始化完成，共載入 ${this.accountTokens.length} 個帳戶`,
        "ACCOUNT",
      );
    } catch (error) {
      this.isInitialized = false;
      logger.error("帳戶管理器初始化失敗", "ACCOUNT", "", error);
    }
  }

  /**
   * 載入帳戶令牌資料
   * @returns {Promise<void>}
   */
  async loadAccountTokens() {
    try {
      this.accountTokens = await this.dataPersistence.loadAccounts();

      // 如果是環境變數模式，需要進行登入獲取令牌
      if (config.dataSaveMode === "none" && this.accountTokens.length > 0) {
        await this._loginEnvironmentAccounts();
      }

      // 驗證和清理無效令牌
      await this._validateAndCleanTokens();

      // 更新帳戶輪詢器
      this.accountRotator.setAccounts(this.accountTokens);

      // CLI 初始化（上游 portal.qwen.ai 持續 504，暫跳過）
      // if (this.accountTokens.length > 0) { ... }

      // 設定cli定時器 每天00:00:00重新整理請求次數
      this._setupDailyResetTimer();

      logger.success(`成功載入 ${this.accountTokens.length} 個帳戶`, "ACCOUNT");
    } catch (error) {
      logger.error("載入帳戶令牌失敗", "ACCOUNT", "", error);
      this.accountTokens = [];
      this.accountRotator.setAccounts(this.accountTokens);
      throw error;
    }
  }

  /**
   * 為環境變數模式的帳戶進行登入
   * @private
   */
  async _loginEnvironmentAccounts() {
    const loginPromises = this.accountTokens.map(async (account) => {
      if (!account.token && account.email && account.password) {
        const token = await this.tokenManager.login(
          account.email,
          account.password,
          account,
        );
        if (token) {
          const decoded = this.tokenManager.validateToken(token);
          if (decoded) {
            account.token = token;
            account.expires = decoded.exp;
          }
        }
      }
      return account;
    });

    this.accountTokens = await Promise.all(loginPromises);
  }

  /**
   * 初始化CLI帳戶
   * @param {Object} account - 帳戶物件
   * @private
   */
  async _initializeCliAccount(account) {
    try {
      const cliManager = require("./cli.manager");
      const cliAccount = await cliManager.initCliAccount(
        account.token,
        account,
      );

      if (
        cliAccount.access_token &&
        cliAccount.refresh_token &&
        cliAccount.expiry_date
      ) {
        account.cli_info = {
          access_token: cliAccount.access_token,
          refresh_token: cliAccount.refresh_token,
          expiry_date: cliAccount.expiry_date,
          refresh_token_interval: setInterval(
            async () => {
              try {
                const refreshToken = await cliManager.refreshAccessToken(
                  {
                    access_token: account.cli_info.access_token,
                    refresh_token: account.cli_info.refresh_token,
                    expiry_date: account.cli_info.expiry_date,
                  },
                  account,
                );
                if (
                  refreshToken.access_token &&
                  refreshToken.refresh_token &&
                  refreshToken.expiry_date
                ) {
                  account.cli_info.access_token = refreshToken.access_token;
                  account.cli_info.refresh_token = refreshToken.refresh_token;
                  account.cli_info.expiry_date = refreshToken.expiry_date;
                  logger.info(`CLI帳戶 ${account.email} 令牌重新整理成功`, "CLI");
                }
              } catch (error) {
                logger.error(
                  `CLI帳戶 ${account.email} 令牌重新整理失敗`,
                  "CLI",
                  "",
                  error,
                );
              }
              // 每2小時重新整理一次
            },
            1000 * 60 * 60 * 2,
          ),
          request_number: 0,
        };
        logger.success(`CLI帳戶 ${account.email} 初始化成功`, "CLI");
      } else {
        logger.error(
          `CLI帳戶 ${account.email} 初始化失敗：無效的響應資料`,
          "CLI",
          "",
          cliAccount,
        );
      }
    } catch (error) {
      logger.error(`CLI帳戶 ${account.email} 初始化失敗`, "CLI", "", error);
    }
  }

  /**
   * 設定每日重置定時器
   * @private
   */
  _setupDailyResetTimer() {
    logger.info("設定CLI請求次數每日重置定時器", "CLI");

    // 計算到下一天00:00:00的毫秒數
    const now = new Date();
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
    );
    const timeDiff = tomorrow.getTime() - now.getTime();

    logger.info(
      `距離下次重置還有 ${Math.round(timeDiff / 1000 / 60)} 分鐘`,
      "CLI",
    );

    // 首次執行使用setTimeout
    this.cliRequestNumberInterval = setTimeout(() => {
      // 重置所有CLI帳戶的請求次數
      this._resetCliRequestNumbers();

      // 設定每24小時執行一次的定時器
      this.cliDailyResetInterval = setInterval(
        () => {
          this._resetCliRequestNumbers();
        },
        24 * 60 * 60 * 1000,
      );
    }, timeDiff);
  }

  /**
   * 重置CLI請求次數
   * @private
   */
  _resetCliRequestNumbers() {
    const cliAccounts = this.accountTokens.filter(
      (account) => account.cli_info,
    );
    cliAccounts.forEach((account) => {
      account.cli_info.request_number = 0;
    });
    logger.info(`已重置 ${cliAccounts.length} 個CLI帳戶的請求次數`, "CLI");
  }

  /**
   * 驗證和清理無效令牌
   * @private
   */
  async _validateAndCleanTokens() {
    const validAccounts = [];

    for (const account of this.accountTokens) {
      if (account.token && this.tokenManager.validateToken(account.token)) {
        validAccounts.push(account);
      } else if (account.email && account.password) {
        // 嘗試重新登入
        logger.info(`令牌無效，嘗試重新登入: ${account.email}`, "TOKEN", "🔄");
        const newToken = await this.tokenManager.login(
          account.email,
          account.password,
          account,
        );
        if (newToken) {
          const decoded = this.tokenManager.validateToken(newToken);
          if (decoded) {
            account.token = newToken;
            account.expires = decoded.exp;
            validAccounts.push(account);
          }
        }
      }
    }

    this.accountTokens = validAccounts;
  }

  /**
   * 自動重新整理即將過期的令牌
   * @param {number} thresholdHours - 過期閾值（小時）
   * @returns {Promise<number>} 成功重新整理的令牌數量
   */
  async autoRefreshTokens(thresholdHours = 24) {
    if (!this.isInitialized) {
      logger.warn("帳戶管理器尚未初始化，跳過自動重新整理", "TOKEN");
      return 0;
    }

    logger.info("開始自動重新整理令牌...", "TOKEN", "🔄");

    // 獲取需要重新整理的帳戶
    const needsRefresh = this.accountTokens.filter((account) =>
      this.tokenManager.isTokenExpiringSoon(account.token, thresholdHours),
    );

    if (needsRefresh.length === 0) {
      logger.info("沒有需要重新整理的令牌", "TOKEN");
      return 0;
    }

    logger.info(`發現 ${needsRefresh.length} 個令牌需要重新整理`, "TOKEN");

    let successCount = 0;
    let failedCount = 0;

    // 逐個重新整理帳戶，每次成功後立即儲存
    for (const account of needsRefresh) {
      try {
        const updatedAccount = await this.tokenManager.refreshToken(account);
        if (updatedAccount) {
          // 立即更新記憶體中的帳戶資料
          const index = this.accountTokens.findIndex(
            (acc) => acc.email === account.email,
          );
          if (index !== -1) {
            this.accountTokens[index] = updatedAccount;
          }

          // 立即儲存到持久化儲存
          await this.dataPersistence.saveAccount(account.email, {
            password: updatedAccount.password,
            token: updatedAccount.token,
            expires: updatedAccount.expires,
            proxy: updatedAccount.proxy ?? account.proxy ?? null,
          });

          // 重置失敗計數
          this.accountRotator.resetFailures(account.email);
          successCount++;

          logger.info(
            `帳戶 ${account.email} 令牌重新整理並儲存成功 (${successCount}/${needsRefresh.length})`,
            "TOKEN",
            "✅",
          );
        } else {
          // 記錄失敗的帳戶
          this.accountRotator.recordFailure(account.email);
          failedCount++;
          logger.error(
            `帳戶 ${account.email} 令牌重新整理失敗 (${failedCount} 個失敗)`,
            "TOKEN",
            "❌",
          );
        }
      } catch (error) {
        this.accountRotator.recordFailure(account.email);
        failedCount++;
        logger.error(
          `帳戶 ${account.email} 重新整理過程中出錯`,
          "TOKEN",
          "",
          error,
        );
      }

      // 新增延遲避免請求過於頻繁
      await this._delay(1000);
    }

    // 更新輪詢器
    this.accountRotator.setAccounts(this.accountTokens);

    logger.success(
      `令牌重新整理完成: 成功 ${successCount} 個，失敗 ${failedCount} 個`,
      "TOKEN",
    );
    return successCount;
  }

  /**
   * 獲取下一個可用的帳戶物件（包含 proxy 等完整欄位）
   * @returns {Object|null} 帳戶物件或 null
   */
  getAccount() {
    if (!this.isInitialized) {
      logger.warn("帳戶管理器尚未初始化完成", "ACCOUNT");
      return null;
    }

    if (this.accountTokens.length === 0) {
      logger.error("沒有可用的帳戶令牌", "ACCOUNT");
      return null;
    }

    const account = this.accountRotator.getNextAccount();
    if (!account) {
      logger.error("所有帳戶令牌都不可用", "ACCOUNT");
    }

    return account;
  }

  /**
   * 獲取可用的帳戶令牌（向後相容的便捷方法）
   * @returns {string|null} 帳戶令牌或null
   */
  getAccountToken() {
    const account = this.getAccount();
    return account ? account.token : null;
  }

  /**
   * 根據郵箱獲取特定帳戶物件
   * @param {string} email - 郵箱地址
   * @returns {Object|null} 帳戶物件或 null
   */
  getAccountByEmail(email) {
    return this.accountRotator.getAccountByEmail(email);
  }

  /**
   * 根據令牌反查帳戶物件（用於只持有 token 的下游呼叫解析帳號級代理）
   * @param {string} token - 訪問令牌
   * @returns {Object|null} 帳戶物件或 null
   */
  getAccountByToken(token) {
    if (!token) return null;
    return this.accountTokens.find((acc) => acc.token === token) || null;
  }

  /**
   * 根據郵箱獲取特定帳戶的令牌（向後相容）
   * @param {string} email - 郵箱地址
   * @returns {string|null} 帳戶令牌或null
   */
  getTokenByEmail(email) {
    return this.accountRotator.getTokenByEmail(email);
  }

  /**
   * 儲存更新後的帳戶資料
   * @param {Array} updatedAccounts - 更新後的帳戶列表
   * @private
   */
  async _saveUpdatedAccounts(updatedAccounts) {
    try {
      for (const account of updatedAccounts) {
        await this.dataPersistence.saveAccount(account.email, {
          password: account.password,
          token: account.token,
          expires: account.expires,
          proxy: account.proxy ?? null,
        });
      }
    } catch (error) {
      logger.error("儲存更新後的帳戶資料失敗", "ACCOUNT", "", error);
    }
  }

  /**
   * 手動重新整理指定帳戶的令牌
   * @param {string} email - 郵箱地址
   * @returns {Promise<boolean>} 重新整理是否成功
   */
  async refreshAccountToken(email) {
    const account = this.accountTokens.find((acc) => acc.email === email);
    if (!account) {
      logger.error(`未找到郵箱為 ${email} 的帳戶`, "ACCOUNT");
      return false;
    }

    const updatedAccount = await this.tokenManager.refreshToken(account);
    if (updatedAccount) {
      // 更新記憶體中的資料
      const index = this.accountTokens.findIndex((acc) => acc.email === email);
      if (index !== -1) {
        this.accountTokens[index] = updatedAccount;
      }

      // 儲存到持久化儲存
      await this.dataPersistence.saveAccount(email, {
        password: updatedAccount.password,
        token: updatedAccount.token,
        expires: updatedAccount.expires,
        proxy: updatedAccount.proxy ?? account.proxy ?? null,
      });

      // 重置失敗計數
      this.accountRotator.resetFailures(email);

      return true;
    }

    return false;
  }

  // 更新銷燬方法，清除定時器
  destroy() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  /**
   * 生成 Markdown 表格
   * @param {Array} websites - 網站資訊陣列
   * @param {string} mode - 模式 ('table' 或 'text')
   * @returns {Promise<string>} Markdown 字串
   */
  async generateMarkdownTable(websites, mode) {
    // 輸入校驗
    if (!Array.isArray(websites) || websites.length === 0) {
      return "";
    }

    let markdown = "";
    if (mode === "table") {
      markdown += "| **序號** | **網站URL** | **來源** |\n";
      markdown += "|:---|:---|:---|\n";
    }

    // 預設值
    const DEFAULT_TITLE = "未知標題";
    const DEFAULT_URL = "https://www.baidu.com";
    const DEFAULT_HOSTNAME = "未知來源";

    // 表格內容
    websites.forEach((site, index) => {
      const { title, url, hostname } = site;
      // 處理欄位值，若為空則使用預設值
      const urlCell = `[${title || DEFAULT_TITLE}](${url || DEFAULT_URL})`;
      const hostnameCell = hostname || DEFAULT_HOSTNAME;
      if (mode === "table") {
        markdown += `| ${index + 1} | ${urlCell} | ${hostnameCell} |\n`;
      } else {
        markdown += `[${index + 1}] ${urlCell} | 來源: ${hostnameCell}\n`;
      }
    });

    return markdown;
  }

  /**
   * 獲取所有帳戶資訊
   * @returns {Array} 帳戶列表
   */
  getAllAccountKeys() {
    return this.accountTokens;
  }

  /**
   * 使用者登入（委託給 TokenManager）
   * @param {string} email - 郵箱
   * @param {string} password - 密碼
   * @returns {Promise<string|null>} 令牌或null
   */
  async login(email, password) {
    return await this.tokenManager.login(email, password);
  }

  /**
   * 獲取帳戶健康狀態統計
   * @returns {Object} 健康狀態統計
   */
  getHealthStats() {
    const tokenStats = this.tokenManager.getTokenHealthStats(
      this.accountTokens,
    );
    const rotatorStats = this.accountRotator.getStats();

    return {
      accounts: tokenStats,
      rotation: rotatorStats,
      initialized: this.isInitialized,
    };
  }

  /**
   * 記錄帳戶使用失敗
   * @param {string} email - 郵箱地址
   */
  recordAccountFailure(email) {
    this.accountRotator.recordFailure(email);
  }

  /**
   * 重置帳戶失敗計數
   * @param {string} email - 郵箱地址
   */
  resetAccountFailures(email) {
    this.accountRotator.resetFailures(email);
  }

  /**
   * 新增新帳戶
   * @param {string} email - 郵箱
   * @param {string} password - 密碼
   * @param {string|null} [proxy] - 帳號專屬代理 URL（HTTP/HTTPS/SOCKS5）
   * @returns {Promise<boolean>} 新增是否成功
   */
  async addAccount(email, password, proxy = null) {
    try {
      // 檢查帳戶是否已存在
      const existingAccount = this.accountTokens.find(
        (acc) => acc.email === email,
      );
      if (existingAccount) {
        logger.warn(`帳戶 ${email} 已存在`, "ACCOUNT");
        return false;
      }

      // 嘗試登入獲取令牌
      const token = await this.tokenManager.login(email, password);
      if (!token) {
        logger.error(`帳戶 ${email} 登入失敗，無法新增`, "ACCOUNT");
        return false;
      }

      const decoded = this.tokenManager.validateToken(token);
      if (!decoded) {
        logger.error(`帳戶 ${email} 令牌無效，無法新增`, "ACCOUNT");
        return false;
      }

      const newAccount = {
        email,
        password,
        token,
        expires: decoded.exp,
        proxy: typeof proxy === "string" && proxy.trim() ? proxy.trim() : null,
      };

      // 新增到記憶體
      this.accountTokens.push(newAccount);
      const insertedIndex = this.accountTokens.length - 1;

      // 儲存到持久化儲存
      const saved = await this.dataPersistence.saveAccount(email, newAccount);
      if (!saved) {
        this.accountTokens.splice(insertedIndex, 1);
        this.accountRotator.setAccounts(this.accountTokens);
        logger.error(`帳戶 ${email} 持久化失敗，已回滾記憶體資料`, "ACCOUNT");
        return false;
      }

      // 更新輪詢器
      this.accountRotator.setAccounts(this.accountTokens);

      logger.success(`成功新增帳戶: ${email}`, "ACCOUNT");
      return true;
    } catch (error) {
      logger.error(`新增帳戶失敗 (${email})`, "ACCOUNT", "", error);
      return false;
    }
  }

  /**
   * 直接新增帳戶（已有token，無需登入）
   * @param {string} email - 郵箱
   * @param {string} password - 密碼
   * @param {string} token - 已獲取的令牌
   * @param {number} expires - 過期時間戳
   * @param {string|null} [proxy] - 帳號專屬代理 URL
   * @returns {Promise<boolean>} 新增是否成功
   */
  async addAccountWithToken(email, password, token, expires, proxy = null) {
    try {
      // 檢查帳戶是否已存在
      const existingAccount = this.accountTokens.find(
        (acc) => acc.email === email,
      );
      if (existingAccount) {
        logger.warn(`帳戶 ${email} 已存在`, "ACCOUNT");
        return false;
      }

      const newAccount = {
        email,
        password,
        token,
        expires,
        proxy: typeof proxy === "string" && proxy.trim() ? proxy.trim() : null,
      };

      // 新增到記憶體
      this.accountTokens.push(newAccount);
      const insertedIndex = this.accountTokens.length - 1;

      // 儲存到持久化儲存
      const saved = await this.dataPersistence.saveAccount(email, newAccount);
      if (!saved) {
        this.accountTokens.splice(insertedIndex, 1);
        this.accountRotator.setAccounts(this.accountTokens);
        logger.error(`帳戶 ${email} 持久化失敗，已回滾記憶體資料`, "ACCOUNT");
        return false;
      }

      // 更新輪詢器
      this.accountRotator.setAccounts(this.accountTokens);

      logger.success(`成功新增帳戶: ${email}`, "ACCOUNT");
      return true;
    } catch (error) {
      logger.error(`新增帳戶失敗 (${email})`, "ACCOUNT", "", error);
      return false;
    }
  }

  /**
   * 更新帳戶的代理 URL
   * 同時使舊 URL 對應的 agent 失效（釋放底層 socket）
   * @param {string} email - 郵箱
   * @param {string|null} proxy - 新代理 URL，空字串/null 表示清除
   * @returns {Promise<boolean>} 更新是否成功
   */
  async updateAccountProxy(email, proxy) {
    try {
      const account = this.accountTokens.find((acc) => acc.email === email);
      if (!account) {
        logger.warn(`帳戶 ${email} 不存在`, "ACCOUNT");
        return false;
      }

      const oldProxy = account.proxy || null;
      const newProxy =
        typeof proxy === "string" && proxy.trim() ? proxy.trim() : null;

      if (oldProxy === newProxy) {
        logger.info(`帳戶 ${email} 代理未變化，無需更新`, "ACCOUNT");
        return true;
      }

      // 先更新記憶體，再持久化；持久化失敗時回滾
      account.proxy = newProxy;
      const saved = await this.dataPersistence.saveAccount(email, {
        password: account.password,
        token: account.token,
        expires: account.expires,
        proxy: newProxy,
      });
      if (!saved) {
        account.proxy = oldProxy;
        logger.error(`帳戶 ${email} 代理持久化失敗，已回滾記憶體資料`, "ACCOUNT");
        return false;
      }

      // 舊代理 URL 不再被該帳戶引用，主動失效快取
      // 注意：其他帳戶可能仍在使用同一 URL，但 invalidate 僅按 URL 操作；
      // 多帳戶共享代理的場景下後續請求會重新建立 agent，安全
      if (oldProxy && oldProxy !== newProxy) {
        const { invalidateProxyAgent } = require("./proxy-helper");
        invalidateProxyAgent(oldProxy);
      }

      logger.success(
        `帳戶 ${email} 代理更新成功 (${oldProxy || "無"} → ${newProxy || "無"})`,
        "ACCOUNT",
      );
      return true;
    } catch (error) {
      logger.error(`更新帳戶 ${email} 代理失敗`, "ACCOUNT", "", error);
      return false;
    }
  }

  /**
   * 移除帳戶
   * @param {string} email - 郵箱地址
   * @returns {Promise<boolean>} 移除是否成功
   */
  async removeAccount(email) {
    try {
      const index = this.accountTokens.findIndex((acc) => acc.email === email);
      if (index === -1) {
        logger.warn(`帳戶 ${email} 不存在`, "ACCOUNT");
        return false;
      }

      // 從記憶體中移除
      this.accountTokens.splice(index, 1);

      // 更新輪詢器
      this.accountRotator.setAccounts(this.accountTokens);

      logger.success(`成功移除帳戶: ${email}`, "ACCOUNT");
      return true;
    } catch (error) {
      logger.error(`移除帳戶失敗 (${email})`, "ACCOUNT", "", error);
      return false;
    }
  }

  /**
   * 刪除帳戶（向後相容）
   * @param {string} email - 郵箱地址
   * @returns {boolean} 刪除是否成功
   */
  deleteAccount(email) {
    const index = this.accountTokens.findIndex((t) => t.email === email);
    if (index !== -1) {
      this.accountTokens.splice(index, 1);
      this.accountRotator.setAccounts(this.accountTokens);
      return true;
    }
    return false;
  }

  /**
   * 為指定帳戶初始化CLI資訊（公共方法）
   * @param {Object} account - 帳戶物件
   * @returns {Promise<boolean>} 初始化是否成功
   */
  async initializeCliForAccount(account) {
    if (!account) {
      logger.error("帳戶物件不能為空", "CLI");
      return false;
    }

    try {
      await this._initializeCliAccount(account);
      return true;
    } catch (error) {
      logger.error(`為帳戶 ${account.email} 初始化CLI失敗`, "CLI", "", error);
      return false;
    }
  }

  /**
   * 延遲函式
   * @param {number} ms - 延遲毫秒數
   * @private
   */
  async _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 清理資源
   */
  destroy() {
    // 清理自動重新整理定時器
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    // 清理CLI請求次數重置定時器
    if (this.cliRequestNumberInterval) {
      clearTimeout(this.cliRequestNumberInterval);
      this.cliRequestNumberInterval = null;
    }

    if (this.cliDailyResetInterval) {
      clearInterval(this.cliDailyResetInterval);
      this.cliDailyResetInterval = null;
    }

    // 清理所有CLI帳戶的重新整理定時器
    this.accountTokens.forEach((account) => {
      if (account.cli_info && account.cli_info.refresh_token_interval) {
        clearInterval(account.cli_info.refresh_token_interval);
        account.cli_info.refresh_token_interval = null;
      }
    });

    this.accountRotator.reset();
    logger.info("帳戶管理器已清理資源", "ACCOUNT", "🧹");
  }
}

if (!(process.env.API_KEY || config.apiKey)) {
  logger.error("請務必設定 API_KEY 環境變數", "CONFIG", "⚙️");
  process.exit(1);
}

const accountManager = new Account();

// 新增程式退出時的清理
process.on("exit", () => {
  if (accountManager) {
    accountManager.destroy();
  }
});

// 處理意外退出
process.on("SIGINT", () => {
  if (accountManager) {
    accountManager.destroy();
  }
  process.exit(0);
});

module.exports = accountManager;
