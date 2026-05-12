const config = require('../config')

/**
 * 驗證API Key是否有效
 * @param {string} providedKey - 提供的API Key
 * @returns {Object} 驗證結果 { isValid: boolean, isAdmin: boolean }
 */
const validateApiKey = (providedKey) => {
  if (!providedKey) {
    return { isValid: false, isAdmin: false }
  }

  // 移除Bearer字首
  const cleanKey = providedKey.startsWith('Bearer ') ? providedKey.slice(7) : providedKey

  // 檢查是否在有效的API keys列表中
  const isValid = config.apiKeys.includes(cleanKey)
  const isAdmin = cleanKey === config.adminKey

  return { isValid, isAdmin }
}

/**
 * API Key驗證中介軟體 - 驗證任何有效的API Key
 */
const apiKeyVerify = (req, res, next) => {
  const apiKey = req.headers['authorization'] || req.headers['Authorization'] || req.headers['x-api-key']
  const { isValid, isAdmin } = validateApiKey(apiKey)

  if (!isValid) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // 將許可權資訊附加到請求物件
  req.isAdmin = isAdmin
  req.apiKey = apiKey
  next()
}

/**
 * 管理員許可權驗證中介軟體 - 只允許管理員API Key
 */
const adminKeyVerify = (req, res, next) => {
  const apiKey = req.headers['authorization'] || req.headers['Authorization'] || req.headers['x-api-key']
  const { isValid, isAdmin } = validateApiKey(apiKey)

  if (!isValid || !isAdmin) {
    return res.status(403).json({ error: 'Admin access required' })
  }

  req.isAdmin = isAdmin
  req.apiKey = apiKey
  next()
}

module.exports = {
  apiKeyVerify,
  adminKeyVerify,
  validateApiKey
}

