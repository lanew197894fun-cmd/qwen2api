const { logger } = require('./logger')

/**
 * 帳戶輪詢管理器
 * 負責帳戶的輪詢選擇和負載均衡
 */
class AccountRotator {
  constructor() {
    this.accounts = []
    this.currentIndex = 0
    this.lastUsedTimes = new Map() // 記錄每個帳戶的最後使用時間
    this.failureCounts = new Map() // 記錄每個帳戶的失敗次數
    this.maxFailures = 3 // 最大失敗次數
    this.cooldownPeriod = 5 * 60 * 1000 // 5分鐘冷卻期
  }

  /**
   * 設定帳戶列表
   * @param {Array} accounts - 帳戶列表
   */
  setAccounts(accounts) {
    if (!Array.isArray(accounts)) {
      logger.error('帳戶列表必須是陣列', 'ACCOUNT')
      throw new Error('帳戶列表必須是陣列')
    }
    
    this.accounts = [...accounts]
    this.currentIndex = 0
    
    // 清理不存在帳戶的記錄
    this._cleanupRecords()
  }

  /**
   * 獲取下一個可用的帳戶物件
   * @returns {Object|null} 帳戶物件或 null
   */
  getNextAccount() {
    if (this.accounts.length === 0) {
      logger.error('沒有可用的帳戶', 'ACCOUNT')
      return null
    }

    const availableAccounts = this._getAvailableAccounts()
    if (availableAccounts.length === 0) {
      logger.warn('所有帳戶都不可用，使用輪詢策略', 'ACCOUNT')
      return this._getAccountByRoundRobin()
    }

    // 從可用帳戶中選擇最少使用的
    const selectedAccount = this._selectLeastUsedAccount(availableAccounts)
    this._recordUsage(selectedAccount.email)

    return selectedAccount
  }

  /**
   * 獲取下一個可用的帳戶令牌（向後相容的便捷方法）
   * @returns {string|null} 帳戶令牌或null
   */
  getNextToken() {
    const account = this.getNextAccount()
    return account ? account.token : null
  }

  /**
   * 根據郵箱獲取帳戶物件
   * @param {string} email - 郵箱地址
   * @returns {Object|null} 帳戶物件或 null
   */
  getAccountByEmail(email) {
    const account = this.accounts.find(acc => acc.email === email)
    if (!account) {
      logger.error(`未找到郵箱為 ${email} 的帳戶`, 'ACCOUNT')
      return null
    }

    if (!this._isAccountAvailable(account)) {
      logger.warn(`帳戶 ${email} 當前不可用`, 'ACCOUNT')
      return null
    }

    this._recordUsage(email)
    return account
  }

  /**
   * 獲取指定郵箱的帳戶令牌（向後相容的便捷方法）
   * @param {string} email - 郵箱地址
   * @returns {string|null} 帳戶令牌或null
   */
  getTokenByEmail(email) {
    const account = this.getAccountByEmail(email)
    return account ? account.token : null
  }

  /**
   * 記錄帳戶使用失敗
   * @param {string} email - 郵箱地址
   */
  recordFailure(email) {
    const currentFailures = this.failureCounts.get(email) || 0
    this.failureCounts.set(email, currentFailures + 1)
    
    if (currentFailures + 1 >= this.maxFailures) {
      logger.warn(`帳戶 ${email} 失敗次數達到上限，將進入冷卻期`, 'ACCOUNT')
    }
  }

  /**
   * 重置帳戶失敗計數
   * @param {string} email - 郵箱地址
   */
  resetFailures(email) {
    this.failureCounts.delete(email)
  }

  /**
   * 獲取帳戶統計資訊
   * @returns {Object} 統計資訊
   */
  getStats() {
    const total = this.accounts.length
    const available = this._getAvailableAccounts().length
    const inCooldown = total - available
    
    const usageStats = {}
    this.accounts.forEach(account => {
      const email = account.email
      usageStats[email] = {
        failures: this.failureCounts.get(email) || 0,
        lastUsed: this.lastUsedTimes.get(email) || null,
        available: this._isAccountAvailable(account)
      }
    })

    return {
      total,
      available,
      inCooldown,
      currentIndex: this.currentIndex,
      usageStats
    }
  }

  /**
   * 獲取可用帳戶列表
   * @private
   */
  _getAvailableAccounts() {
    return this.accounts.filter(account => this._isAccountAvailable(account))
  }

  /**
   * 檢查帳戶是否可用
   * @param {Object} account - 帳戶物件
   * @returns {boolean} 是否可用
   * @private
   */
  _isAccountAvailable(account) {
    if (!account.token) {
      return false
    }

    const failures = this.failureCounts.get(account.email) || 0
    if (failures >= this.maxFailures) {
      const lastUsed = this.lastUsedTimes.get(account.email)
      if (lastUsed && Date.now() - lastUsed < this.cooldownPeriod) {
        return false // 仍在冷卻期
      } else {
        // 冷卻期結束，重置失敗計數
        this.failureCounts.delete(account.email)
      }
    }

    return true
  }

  /**
   * 選擇最少使用的帳戶
   * @param {Array} accounts - 可用帳戶列表
   * @returns {Object} 選中的帳戶
   * @private
   */
  _selectLeastUsedAccount(accounts) {
    if (accounts.length === 1) {
      return accounts[0]
    }

    // 按最後使用時間排序，選擇最久未使用的
    return accounts.reduce((least, current) => {
      const leastLastUsed = this.lastUsedTimes.get(least.email) || 0
      const currentLastUsed = this.lastUsedTimes.get(current.email) || 0
      
      return currentLastUsed < leastLastUsed ? current : least
    })
  }

  /**
   * 輪詢策略獲取帳戶物件
   * @returns {Object|null} 帳戶物件或null
   * @private
   */
  _getAccountByRoundRobin() {
    if (this.currentIndex >= this.accounts.length) {
      this.currentIndex = 0
    }

    const account = this.accounts[this.currentIndex]
    this.currentIndex++

    if (account && account.token) {
      this._recordUsage(account.email)
      return account
    }

    // 如果當前帳戶無效，嘗試下一個
    if (this.currentIndex < this.accounts.length) {
      return this._getAccountByRoundRobin()
    }

    return null
  }

  /**
   * 記錄帳戶使用
   * @param {string} email - 郵箱地址
   * @private
   */
  _recordUsage(email) {
    this.lastUsedTimes.set(email, Date.now())
  }

  /**
   * 清理不存在帳戶的記錄
   * @private
   */
  _cleanupRecords() {
    const currentEmails = new Set(this.accounts.map(acc => acc.email))
    
    // 清理失敗計數記錄
    for (const email of this.failureCounts.keys()) {
      if (!currentEmails.has(email)) {
        this.failureCounts.delete(email)
      }
    }
    
    // 清理使用時間記錄
    for (const email of this.lastUsedTimes.keys()) {
      if (!currentEmails.has(email)) {
        this.lastUsedTimes.delete(email)
      }
    }
  }

  /**
   * 重置所有統計資料
   */
  reset() {
    this.currentIndex = 0
    this.lastUsedTimes.clear()
    this.failureCounts.clear()
  }
}

module.exports = AccountRotator
