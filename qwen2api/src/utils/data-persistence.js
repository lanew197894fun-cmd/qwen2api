const fs = require('fs').promises
const path = require('path')
const config = require('../config/index.js')
const redisClient = require('./redis')
const { logger } = require('./logger')

/**
 * 資料持久化管理器
 * 統一處理帳戶資料的儲存和讀取
 */
class DataPersistence {
  constructor() {
    this.dataFilePath = path.join(__dirname, '../../data/data.json')
  }

  /**
   * 載入所有帳戶資料
   * @returns {Promise<Array>} 帳戶列表
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
          logger.error(`不支援的資料儲存模式: ${config.dataSaveMode}`, 'DATA')
          throw new Error(`不支援的資料儲存模式: ${config.dataSaveMode}`)
      }
    } catch (error) {
      logger.error('載入帳戶資料失敗', 'DATA', '', error)
      throw error
    }
  }

  /**
   * 儲存單個帳戶資料
   * @param {string} email - 郵箱
   * @param {Object} accountData - 帳戶資料
   * @returns {Promise<boolean>} 儲存是否成功
   */
  async saveAccount(email, accountData) {
    try {
      switch (config.dataSaveMode) {
        case 'redis':
          return await this._saveToRedis(email, accountData)
        case 'file':
          return await this._saveToFile(email, accountData)
        case 'none':
          logger.warn('環境變數模式不支援儲存帳戶資料', 'DATA')
          return false
        default:
          logger.error(`不支援的資料儲存模式: ${config.dataSaveMode}`, 'DATA')
          throw new Error(`不支援的資料儲存模式: ${config.dataSaveMode}`)
      }
    } catch (error) {
      logger.error(`儲存帳戶資料失敗 (${email})`, 'DATA', '', error)
      return false
    }
  }

  /**
   * 批次儲存帳戶資料
   * @param {Array} accounts - 帳戶列表
   * @returns {Promise<boolean>} 儲存是否成功
   */
  async saveAllAccounts(accounts) {
    try {
      switch (config.dataSaveMode) {
        case 'redis':
          return await this._saveAllToRedis(accounts)
        case 'file':
          return await this._saveAllToFile(accounts)
        case 'none':
          logger.warn('環境變數模式不支援儲存帳戶資料', 'DATA')
          return false
        default:
          logger.error(`不支援的資料儲存模式: ${config.dataSaveMode}`, 'DATA')
          throw new Error(`不支援的資料儲存模式: ${config.dataSaveMode}`)
      }
    } catch (error) {
      logger.error('批次儲存帳戶資料失敗', 'DATA', '', error)
      return false
    }
  }

  /**
   * 從 Redis 載入帳戶資料
   * @private
   */
  async _loadFromRedis() {
    const accounts = await redisClient.getAllAccounts()
    return accounts.length > 0 ? accounts : []
  }

  /**
   * 從檔案載入帳戶資料
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
   * 從環境變數載入帳戶資料
   * @private
   */
  async _loadFromEnv() {
    if (!process.env.ACCOUNTS) {
      return []
    }

    const { parseAccountLine } = require('./account-parser')
    const accountTokens = process.env.ACCOUNTS.split(',')
    const accounts = []

    // 解析委託給共用 parser，與後臺批次新增保持一致；
    // 注意：這裡僅載入憑據，token 在 Account 類中按需登入獲取
    for (const item of accountTokens) {
      const parsed = parseAccountLine(item)
      if (parsed) {
        accounts.push({ ...parsed, token: null, expires: null })
      }
    }

    return accounts
  }

  /**
   * 儲存到 Redis
   * @private
   */
  async _saveToRedis(email, accountData) {
    return await redisClient.setAccount(email, accountData)
  }

  /**
   * 儲存到檔案
   * @private
   */
  async _saveToFile(email, accountData) {
    await this._ensureDataFileExists()
    
    const fileContent = await fs.readFile(this.dataFilePath, 'utf-8')
    const data = JSON.parse(fileContent)
    
    if (!data.accounts) {
      data.accounts = []
    }

    // 查詢現有帳戶或新增新帳戶
    const existingIndex = data.accounts.findIndex(account => account.email === email)
    const updatedAccount = {
      email,
      password: accountData.password,
      token: accountData.token,
      expires: accountData.expires,
      proxy: accountData.proxy ?? null
    }

    if (existingIndex !== -1) {
      data.accounts[existingIndex] = updatedAccount
    } else {
      data.accounts.push(updatedAccount)
    }

    await fs.writeFile(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  }

  /**
   * 批次儲存到 Redis
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
   * 批次儲存到檔案
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
      proxy: account.proxy ?? null
    }))

    await fs.writeFile(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8')
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
      logger.info('資料檔案不存在，正在建立預設檔案...', 'FILE', '📁')

      // 確保目錄存在
      const dirPath = path.dirname(this.dataFilePath)
      await fs.mkdir(dirPath, { recursive: true })

      // 建立預設資料結構
      const defaultData = {
        defaultHeaders: null,
        defaultCookie: null,
        accounts: []
      }

      await fs.writeFile(this.dataFilePath, JSON.stringify(defaultData, null, 2), 'utf-8')
      logger.success('預設資料檔案建立成功', 'FILE')
    }
  }
}

module.exports = DataPersistence
