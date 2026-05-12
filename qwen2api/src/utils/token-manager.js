const axios = require('axios')
const { sha256Encrypt, JwtDecode } = require('./tools')
const { logger } = require('./logger')
const { getProxyAgent, getChatBaseUrl, applyProxyToAxiosConfig } = require('./proxy-helper')

/**
 * 令牌管理器
 * 負責令牌的獲取、驗證、重新整理等操作
 */
class TokenManager {
    constructor() {
        this.defaultHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0'
        }
    }

    /**
     * 獲取登入端點
     * @returns {string} 登入端點URL
     */
    get loginEndpoint() {
        return `${getChatBaseUrl()}/api/v1/auths/signin`
    }

    /**
     * 使用者登入獲取令牌
     * @param {string} email - 郵箱
     * @param {string} password - 密碼
     * @param {Object} [account] - 帳戶物件（用於解析帳號級代理；為空時回退到全域性 PROXY_URL）
     * @returns {Promise<string|null>} 令牌或null
     */
    async login(email, password, account) {
        try {
            const proxyAgent = getProxyAgent(account)
            const requestConfig = {
                headers: this.defaultHeaders,
                timeout: 10000 // 10秒超時
            }

            // 新增代理配置
            if (proxyAgent) {
                requestConfig.httpsAgent = proxyAgent
                requestConfig.proxy = false
            }

            const response = await axios.post(this.loginEndpoint, {
                email: email,
                password: sha256Encrypt(password)
            }, requestConfig)

            if (response.data && response.data.token) {
                logger.success(`${email} 登入成功：${response.data.token}`, 'AUTH')
                return response.data.token
            } else {
                logger.error(`${email} 登入響應缺少令牌`, 'AUTH')
                return null
            }
        } catch (error) {
            if (error.response) {
                logger.error(`${email} 登入失敗 (${error.response.status})`, 'AUTH', '', error)
            } else if (error.request) {
                logger.error(`${email} 登入失敗: 網路請求超時或無響應`, 'AUTH')
            } else {
                logger.error(`${email} 登入失敗`, 'AUTH', '', error)
            }
            return null
        }
    }

    /**
     * 驗證令牌是否有效
     * @param {string} token - JWT令牌
     * @returns {Object|null} 解碼後的令牌資訊或null
     */
    validateToken(token) {
        try {
            if (!token) return null

            const decoded = JwtDecode(token)
            if (!decoded || !decoded.exp) {
                return null
            }

            const now = Math.floor(Date.now() / 1000)
            if (decoded.exp <= now) {
                return null // 令牌已過期
            }

            return decoded
        } catch (error) {
            logger.error('令牌驗證失敗', 'TOKEN', '', error)
            return null
        }
    }

    /**
     * 檢查令牌是否即將過期
     * @param {string} token - JWT令牌
     * @param {number} thresholdHours - 過期閾值（小時）
     * @returns {boolean} 是否即將過期
     */
    isTokenExpiringSoon(token, thresholdHours = 6) {
        const decoded = this.validateToken(token)
        if (!decoded) return true // 無效令牌視為即將過期

        const now = Math.floor(Date.now() / 1000)
        const thresholdSeconds = thresholdHours * 60 * 60
        return decoded.exp - now < thresholdSeconds
    }

    /**
     * 獲取令牌剩餘有效時間（小時）
     * @param {string} token - JWT令牌
     * @returns {number} 剩餘小時數，-1表示無效令牌
     */
    getTokenRemainingHours(token) {
        const decoded = this.validateToken(token)
        if (!decoded) return -1

        const now = Math.floor(Date.now() / 1000)
        const remainingSeconds = decoded.exp - now
        return Math.max(0, Math.round(remainingSeconds / 3600))
    }

    /**
     * 重新整理單個帳戶的令牌
     * @param {Object} account - 帳戶物件 {email, password, token, expires}
     * @returns {Promise<Object|null>} 更新後的帳戶物件或null
     */
    async refreshToken(account) {
        try {
            const newToken = await this.login(account.email, account.password, account)
            if (!newToken) {
                return null
            }

            const decoded = this.validateToken(newToken)
            if (!decoded) {
                logger.error(`重新整理後的令牌無效: ${account.email}`, 'TOKEN')
                return null
            }

            const updatedAccount = {
                ...account,
                token: newToken,
                expires: decoded.exp
            }

            const remainingHours = this.getTokenRemainingHours(newToken)
            logger.success(`令牌重新整理成功: ${account.email} (有效期: ${remainingHours}小時)`, 'TOKEN')

            return updatedAccount
        } catch (error) {
            logger.error(`重新整理令牌失敗 (${account.email})`, 'TOKEN', '', error)
            return null
        }
    }

    /**
     * 批次重新整理即將過期的令牌
     * @param {Array} accounts - 帳戶列表
     * @param {number} thresholdHours - 過期閾值（小時）
     * @param {Function} onEachRefresh - 每次重新整理成功後的回撥函式 (updatedAccount, index, total) => void
     * @returns {Promise<Object>} 重新整理結果 {refreshed: Array, failed: Array}
     */
    async batchRefreshTokens(accounts, thresholdHours = 24, onEachRefresh = null) {
        const needsRefresh = accounts.filter(account =>
            this.isTokenExpiringSoon(account.token, thresholdHours)
        )

        if (needsRefresh.length === 0) {
            logger.info('沒有需要重新整理的令牌', 'TOKEN')
            return { refreshed: [], failed: [] }
        }

        logger.info(`發現 ${needsRefresh.length} 個令牌需要重新整理`, 'TOKEN')

        const refreshed = []
        const failed = []

        for (let i = 0; i < needsRefresh.length; i++) {
            const account = needsRefresh[i]
            const updatedAccount = await this.refreshToken(account)

            if (updatedAccount) {
                refreshed.push(updatedAccount)

                // 如果提供了回撥函式，立即呼叫
                if (onEachRefresh && typeof onEachRefresh === 'function') {
                    try {
                        await onEachRefresh(updatedAccount, i + 1, needsRefresh.length)
                    } catch (error) {
                        logger.error(`重新整理回撥函式執行失敗 (${account.email})`, 'TOKEN', '', error)
                    }
                }
            } else {
                failed.push(account)
            }

            // 新增延遲避免請求過於頻繁
            await this._delay(1000)
        }

        logger.success(`令牌重新整理完成: 成功 ${refreshed.length} 個，失敗 ${failed.length} 個`, 'TOKEN')
        return { refreshed, failed }
    }

    /**
     * 獲取健康的令牌統計資訊
     * @param {Array} accounts - 帳戶列表
     * @returns {Object} 統計資訊
     */
    getTokenHealthStats(accounts) {
        const stats = {
            total: accounts.length,
            valid: 0,
            expired: 0,
            expiringSoon: 0,
            invalid: 0
        }

        accounts.forEach(account => {
            if (!account.token) {
                stats.invalid++
                return
            }

            const decoded = this.validateToken(account.token)
            if (!decoded) {
                stats.invalid++
                return
            }

            const now = Math.floor(Date.now() / 1000)
            if (decoded.exp <= now) {
                stats.expired++
            } else if (this.isTokenExpiringSoon(account.token, 6)) {
                stats.expiringSoon++
            } else {
                stats.valid++
            }
        })

        return stats
    }

    /**
     * 延遲函式
     * @param {number} ms - 延遲毫秒數
     * @private
     */
    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}

module.exports = TokenManager
