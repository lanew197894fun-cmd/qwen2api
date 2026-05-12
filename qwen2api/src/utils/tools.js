const crypto = require('crypto')
const { jwtDecode } = require('jwt-decode')
const { logger } = require('./logger')


const isJson = (str) => {
  try {
    JSON.parse(str)
    return true
  } catch (error) {
    return false
  }
}

const sleep = async (ms) => {
  return await new Promise(resolve => setTimeout(resolve, ms))
}

const sha256Encrypt = (text) => {
  if (typeof text !== 'string') {
    logger.error('輸入必須是字串型別', 'TOOLS')
    throw new Error('輸入必須是字串型別')
  }
  const hash = crypto.createHash('sha256')
  hash.update(text, 'utf-8')
  return hash.digest('hex')
}

const JwtDecode = (token) => {
  try {
    const decoded = jwtDecode(token, { complete: true })
    return decoded
  } catch (error) {
    logger.error('解析JWT失敗', 'JWT', '', error)
    return null
  }
}

/**
 * 生成UUID v4
 * 使用Node.js內建的crypto.randomUUID()
 * @returns {string} UUID v4字串
 */
const generateUUID = () => {
  return crypto.randomUUID()
}

module.exports = {
  isJson,
  sleep,
  sha256Encrypt,
  JwtDecode,
  generateUUID
}
