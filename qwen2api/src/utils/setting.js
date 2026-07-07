const accountManager = require('./account')
const { logger } = require('./logger')

/**
 * 賬戶設定工具
 * 提供賬戶的保存和刪除功能，使用統一的賬戶管理器
 */

/**
 * 保存賬戶資訊
 * @param {string} email - 郵箱地址
 * @param {string} password - 密碼
 * @param {string} token - 訪問令牌
 * @param {number} expires - 過期時間戳
 * @param {string|null} [proxy] - 帳號專屬代理 URL
 * @returns {Promise<boolean>} 保存是否成功
 */
const saveAccounts = async (email, password, token, expires, proxy = null) => {
  try {
    // 參數驗證
    if (!email || !password) {
      logger.error('保存賬戶失敗: 郵箱和密碼不能為空', 'SETTING')
      return false
    }

    // 使用賬戶管理器的統一方法
    const success = await accountManager.addAccount(email, password, proxy)

    if (success) {
      logger.success(`賬戶 ${email} 保存成功`, 'SETTING')
      return true
    } else {
      logger.error(`賬戶 ${email} 保存失敗`, 'SETTING')
      return false
    }
  } catch (error) {
    logger.error(`保存賬戶 ${email} 時發生錯誤`, 'SETTING', '', error)
    return false
  }
}

/**
 * 刪除賬戶
 * @param {string} email - 郵箱地址
 * @returns {Promise<boolean>} 刪除是否成功
 */
const deleteAccount = async (email) => {
  try {
    // 參數驗證
    if (!email) {
      logger.error('刪除賬戶失敗: 郵箱不能為空', 'SETTING')
      return false
    }

    // 使用賬戶管理器的統一方法
    const success = await accountManager.removeAccount(email)

    if (success) {
      logger.success(`賬戶 ${email} 刪除成功`, 'SETTING')
      return true
    } else {
      logger.error(`賬戶 ${email} 刪除失敗`, 'SETTING')
      return false
    }
  } catch (error) {
    logger.error(`刪除賬戶 ${email} 時發生錯誤`, 'SETTING', '', error)
    return false
  }
}

/**
 * 取得所有賬戶資訊
 * @returns {Array} 賬戶列表
 */
const getAllAccounts = () => {
  try {
    return accountManager.getAllAccountKeys()
  } catch (error) {
    logger.error('取得賬戶列表時發生錯誤', 'SETTING', '', error)
    return []
  }
}

/**
 * 取得賬戶健康狀態
 * @returns {Object} 健康狀態統計
 */
const getAccountHealth = () => {
  try {
    return accountManager.getHealthStats()
  } catch (error) {
    logger.error('取得賬戶健康狀態時發生錯誤', 'SETTING', '', error)
    return {
      accounts: { total: 0, valid: 0, expired: 0, expiringSoon: 0, invalid: 0 },
      rotation: { total: 0, available: 0, inCooldown: 0 },
      initialized: false
    }
  }
}

/**
 * 手動重新整理賬戶令牌
 * @param {string} email - 郵箱地址
 * @returns {Promise<boolean>} 重新整理是否成功
 */
const refreshAccountToken = async (email) => {
  try {
    if (!email) {
      logger.error('重新整理令牌失敗: 郵箱不能為空', 'SETTING')
      return false
    }

    const success = await accountManager.refreshAccountToken(email)

    if (success) {
      logger.success(`賬戶 ${email} 令牌重新整理成功`, 'SETTING')
      return true
    } else {
      logger.error(`賬戶 ${email} 令牌重新整理失敗`, 'SETTING')
      return false
    }
  } catch (error) {
    logger.error(`重新整理賬戶 ${email} 令牌時發生錯誤`, 'SETTING', '', error)
    return false
  }
}

module.exports = {
  saveAccounts,
  deleteAccount,
  getAllAccounts,
  getAccountHealth,
  refreshAccountToken
}