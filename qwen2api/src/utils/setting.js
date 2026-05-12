const accountManager = require('./account')
const { logger } = require('./logger')

/**
 * 帳戶設定工具
 * 提供帳戶的儲存和刪除功能，使用統一的帳戶管理器
 */

/**
 * 儲存帳戶資訊
 * @param {string} email - 郵箱地址
 * @param {string} password - 密碼
 * @param {string} token - 訪問令牌
 * @param {number} expires - 過期時間戳
 * @param {string|null} [proxy] - 帳號專屬代理 URL
 * @returns {Promise<boolean>} 儲存是否成功
 */
const saveAccounts = async (email, password, token, expires, proxy = null) => {
  try {
    // 引數驗證
    if (!email || !password) {
      logger.error('儲存帳戶失敗: 郵箱和密碼不能為空', 'SETTING')
      return false
    }

    // 使用帳戶管理器的統一方法
    const success = await accountManager.addAccount(email, password, proxy)

    if (success) {
      logger.success(`帳戶 ${email} 儲存成功`, 'SETTING')
      return true
    } else {
      logger.error(`帳戶 ${email} 儲存失敗`, 'SETTING')
      return false
    }
  } catch (error) {
    logger.error(`儲存帳戶 ${email} 時發生錯誤`, 'SETTING', '', error)
    return false
  }
}

/**
 * 刪除帳戶
 * @param {string} email - 郵箱地址
 * @returns {Promise<boolean>} 刪除是否成功
 */
const deleteAccount = async (email) => {
  try {
    // 引數驗證
    if (!email) {
      logger.error('刪除帳戶失敗: 郵箱不能為空', 'SETTING')
      return false
    }

    // 使用帳戶管理器的統一方法
    const success = await accountManager.removeAccount(email)

    if (success) {
      logger.success(`帳戶 ${email} 刪除成功`, 'SETTING')
      return true
    } else {
      logger.error(`帳戶 ${email} 刪除失敗`, 'SETTING')
      return false
    }
  } catch (error) {
    logger.error(`刪除帳戶 ${email} 時發生錯誤`, 'SETTING', '', error)
    return false
  }
}

/**
 * 獲取所有帳戶資訊
 * @returns {Array} 帳戶列表
 */
const getAllAccounts = () => {
  try {
    return accountManager.getAllAccountKeys()
  } catch (error) {
    logger.error('獲取帳戶列表時發生錯誤', 'SETTING', '', error)
    return []
  }
}

/**
 * 獲取帳戶健康狀態
 * @returns {Object} 健康狀態統計
 */
const getAccountHealth = () => {
  try {
    return accountManager.getHealthStats()
  } catch (error) {
    logger.error('獲取帳戶健康狀態時發生錯誤', 'SETTING', '', error)
    return {
      accounts: { total: 0, valid: 0, expired: 0, expiringSoon: 0, invalid: 0 },
      rotation: { total: 0, available: 0, inCooldown: 0 },
      initialized: false
    }
  }
}

/**
 * 手動重新整理帳戶令牌
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
      logger.success(`帳戶 ${email} 令牌重新整理成功`, 'SETTING')
      return true
    } else {
      logger.error(`帳戶 ${email} 令牌重新整理失敗`, 'SETTING')
      return false
    }
  } catch (error) {
    logger.error(`重新整理帳戶 ${email} 令牌時發生錯誤`, 'SETTING', '', error)
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