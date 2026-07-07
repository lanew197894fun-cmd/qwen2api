const fs = require('fs').promises
const path = require('path')
const config = require('../config/index.js')
const redisClient = require('./redis')
const { logger } = require('./logger')

/**
 * 資料持久化管理器
 * 統一處理賬戶資料的存儲和讀取
 */
// Debounce 窗口（per-email）寫入 stats——避免每次 token 累計都觸發檔案 I/O
const STATS_PERSIST_DEBOUNCE_MS = 5000

class DataPersistence {
  constructor() {
    this.dataFilePath = path.join(__dirname, '../../data/data.json')
    // 每個 email 的待持久化 stats 與定時器（debounce）
    this._statsPersistTimers = new Map()
    this._statsPendingPayload = new Map()
  }

  /**
   * 載入所有賬戶資料
   * @returns {Promise<Array>} 賬戶列表
   */
  async loadAccounts() {
    try {
      switch (config.dataSaveMode) {
        case 'redis':
          return await this._loadFromRedis()
        case 'file':
          return await this._loadFromFile()
        case 'none':
          return await this._loadFromEnv()
        default:
          logger.error(`不支援的資料保存模式: ${config.dataSaveMode}`, 'DATA')
          throw new Error(`不支援的資料保存模式: ${config.dataSaveMode}`)
      }
    } catch (error) {
      logger.error('載入賬戶資料失敗', 'DATA', '', error)
      throw error
    }
  }

  /**
   * 保存單個賬戶資料
   * @param {string} email - 郵箱
   * @param {Object} accountData - 賬戶資料
   * @returns {Promise<boolean>} 保存是否成功
   */
  async saveAccount(email, accountData) {
    try {
      switch (config.dataSaveMode) {
        case 'redis':
          return await this._saveToRedis(email, accountData)
        case 'file':
          return await this._saveToFile(email, accountData)
        case 'none':
          logger.warn('環境變量模式不支援保存賬戶資料', 'DATA')
          return false
        default:
          logger.error(`不支援的資料保存模式: ${config.dataSaveMode}`, 'DATA')
          throw new Error(`不支援的資料保存模式: ${config.dataSaveMode}`)
      }
    } catch (error) {
      logger.error(`保存賬戶資料失敗 (${email})`, 'DATA', '', error)
      return false
    }
  }

  /**
   * 載入執行時設定（chat retry config 等）
   * 在 'none' 模式下回傳 {}, 因為沒有可寫存儲
   * @returns {Promise<Object>} 設定物件 (空物件表示尚未存儲任何值)
   */
  async loadSettings() {
    try {
      switch (config.dataSaveMode) {
        case 'redis':
          return (await redisClient.getSettings()) || {}
        case 'file':
          return await this._loadSettingsFromFile()
        case 'none':
          return {}
        default:
          logger.error(`不支援的資料保存模式: ${config.dataSaveMode}`, 'DATA')
          return {}
      }
    } catch (error) {
      logger.error('載入執行時設定失敗', 'DATA', '', error)
      return {}
    }
  }

  /**
   * 保存執行時設定（部分合併）
   * @param {Object} partial - 要寫入的字段
   * @returns {Promise<boolean>} 保存是否成功
   */
  async saveSettings(partial) {
    try {
      switch (config.dataSaveMode) {
        case 'redis':
          return await redisClient.setSettings(partial)
        case 'file':
          return await this._saveSettingsToFile(partial)
        case 'none':
          logger.warn('環境變量模式不支援保存執行時設定', 'DATA')
          return false
        default:
          logger.error(`不支援的資料保存模式: ${config.dataSaveMode}`, 'DATA')
          return false
      }
    } catch (error) {
      logger.error('保存執行時設定失敗', 'DATA', '', error)
      return false
    }
  }

  async _loadSettingsFromFile() {
    await this._ensureDataFileExists()
    const fileContent = await fs.readFile(this.dataFilePath, 'utf-8')
    const data = JSON.parse(fileContent)
    return (data.settings && typeof data.settings === 'object') ? data.settings : {}
  }

  async _saveSettingsToFile(partial) {
    await this._ensureDataFileExists()
    const fileContent = await fs.readFile(this.dataFilePath, 'utf-8')
    const data = JSON.parse(fileContent)
    data.settings = { ...(data.settings || {}), ...partial }
    await fs.writeFile(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  }

  /**
   * 批量保存賬戶資料
   * @param {Array} accounts - 賬戶列表
   * @returns {Promise<boolean>} 保存是否成功
   */
  async saveAllAccounts(accounts) {
    try {
      switch (config.dataSaveMode) {
        case 'redis':
          return await this._saveAllToRedis(accounts)
        case 'file':
          return await this._saveAllToFile(accounts)
        case 'none':
          logger.warn('環境變量模式不支援保存賬戶資料', 'DATA')
          return false
        default:
          logger.error(`不支援的資料保存模式: ${config.dataSaveMode}`, 'DATA')
          throw new Error(`不支援的資料保存模式: ${config.dataSaveMode}`)
      }
    } catch (error) {
      logger.error('批量保存賬戶資料失敗', 'DATA', '', error)
      return false
    }
  }

  /**
   * 從 Redis 載入賬戶資料
   * @private
   */
  async _loadFromRedis() {
    const accounts = await redisClient.getAllAccounts()
    return accounts.length > 0 ? accounts : []
  }

  /**
   * 從檔案載入賬戶資料
   * @private
   */
  async _loadFromFile() {
    // 確保檔案存在
    await this._ensureDataFileExists()
    
    const fileContent = await fs.readFile(this.dataFilePath, 'utf-8')
    const data = JSON.parse(fileContent)
    
    return data.accounts || []
  }

  /**
   * 從環境變量載入賬戶資料
   * @private
   */
  async _loadFromEnv() {
    if (!process.env.ACCOUNTS) {
      return []
    }

    const { parseAccountLine } = require('./account-parser')
    const accountTokens = process.env.ACCOUNTS.split(',')
    const accounts = []

    // 解析委託給共用 parser，與後臺批量新增保持一致；
    // 注意：這裡僅載入憑據，token 在 Account 類中按需登入取得
    for (const item of accountTokens) {
      const parsed = parseAccountLine(item)
      if (parsed) {
        accounts.push({ ...parsed, token: null, expires: null })
      }
    }

    return accounts
  }

  /**
   * 保存到 Redis
   * @private
   */
  async _saveToRedis(email, accountData) {
    return await redisClient.setAccount(email, accountData)
  }

  /**
   * 保存到檔案（MERGE 語義）
   * partial save（僅 token、proxy、stats）不應覆蓋未傳字段——保留 existing 值
   * @private
   */
  async _saveToFile(email, accountData) {
    await this._ensureDataFileExists()

    const fileContent = await fs.readFile(this.dataFilePath, 'utf-8')
    const data = JSON.parse(fileContent)

    if (!data.accounts) {
      data.accounts = []
    }

    const existingIndex = data.accounts.findIndex(account => account.email === email)
    const existing = existingIndex !== -1 ? data.accounts[existingIndex] : {}

    // 僅寫入顯式傳入的字段；未傳字段保留 existing 值。stats 同理——
    // 避免 token refresh / proxy update 的 partial save 把累計 stats 清零
    const merged = { ...existing, email }
    if (accountData.password !== undefined) merged.password = accountData.password
    if (accountData.token !== undefined) merged.token = accountData.token
    if (accountData.expires !== undefined) merged.expires = accountData.expires
    if (accountData.proxy !== undefined) merged.proxy = accountData.proxy ?? null
    if (accountData.stats !== undefined) merged.stats = accountData.stats
    if (accountData.statsHistory !== undefined) merged.statsHistory = accountData.statsHistory

    if (existingIndex !== -1) {
      data.accounts[existingIndex] = merged
    } else {
      data.accounts.push(merged)
    }

    await fs.writeFile(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  }

  /**
   * 批量保存到 Redis
   * @private
   */
  async _saveAllToRedis(accounts) {
    let successCount = 0
    for (const account of accounts) {
      const success = await this._saveToRedis(account.email, account)
      if (success) successCount++
    }
    return successCount === accounts.length
  }

  /**
   * 批量保存到檔案
   * @private
   */
  async _saveAllToFile(accounts) {
    await this._ensureDataFileExists()
    
    const fileContent = await fs.readFile(this.dataFilePath, 'utf-8')
    const data = JSON.parse(fileContent)
    
    data.accounts = accounts.map(account => ({
      email: account.email,
      password: account.password,
      token: account.token,
      expires: account.expires,
      proxy: account.proxy ?? null,
      stats: account.stats ?? undefined,
      statsHistory: account.statsHistory ?? undefined
    }))

    await fs.writeFile(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  }

  /**
   * 調度 per-account daily stats 持久化（debounce 5 秒）
   * 高頻 accumulateStats 調用合併為單次 I/O——重複調用替換上一個 timer
   * dataSaveMode='none' 時不寫盤，回傳 false
   * @param {string} email - 郵箱
   * @param {Object} stats - 完整 stats 物件 { chat: {input,output}, cli: {calls,input,output} }
   * @returns {boolean} 是否調度成功
   */
  saveAccountStats(email, stats) {
    if (config.dataSaveMode === 'none') {
      return false
    }
    if (!email || !stats) {
      return false
    }

    // 替換 pending payload 與 timer
    this._statsPendingPayload.set(email, stats)
    const prev = this._statsPersistTimers.get(email)
    if (prev) clearTimeout(prev)

    const timer = setTimeout(async () => {
      this._statsPersistTimers.delete(email)
      const payload = this._statsPendingPayload.get(email)
      this._statsPendingPayload.delete(email)
      if (!payload) return
      try {
        await this.saveAccount(email, { stats: payload })
      } catch (error) {
        logger.error(`stats 持久化失敗 (${email})`, 'STATS', '', error)
      }
    }, STATS_PERSIST_DEBOUNCE_MS)

    this._statsPersistTimers.set(email, timer)
    return true
  }

  /**
   * 確保資料檔案存在
   * @private
   */
  async _ensureDataFileExists() {
    try {
      await fs.access(this.dataFilePath)
    } catch (error) {
      logger.info('資料檔案不存在，正在創建預設檔案...', 'FILE', '📁')

      // 確保目錄存在
      const dirPath = path.dirname(this.dataFilePath)
      await fs.mkdir(dirPath, { recursive: true })

      // 創建預設資料結構
      const defaultData = {
        defaultHeaders: null,
        defaultCookie: null,
        accounts: []
      }

      await fs.writeFile(this.dataFilePath, JSON.stringify(defaultData, null, 2), 'utf-8')
      logger.success('預設資料檔案創建成功', 'FILE')
    }
  }
}

module.exports = DataPersistence
