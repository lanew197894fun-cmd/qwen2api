const config = require('../config/index.js')
const { HttpsProxyAgent } = require('https-proxy-agent')

// 按代理 URL 快取 agent 例項（多帳號共享同一代理時複用同一個 agent）
const proxyAgents = new Map()

// 接受 http/https/socks5 協議；正則故意寬鬆，僅攔截最常見的拼寫錯誤
// （缺少協議、錯誤協議如 'htp://'），不強制 host 形態以免拒絕合法的
// 含使用者名稱/密碼、IPv6、自定義路徑的代理 URL
const PROXY_URL_REGEX = /^(https?|socks5):\/\/[^\s]+$/i

/**
 * 校驗代理 URL 格式
 * 空值（null/undefined/空字串）視為合法（表示"無帳號級代理"）
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
const isValidProxyUrl = (url) => {
    if (url === null || url === undefined || url === '') return true
    if (typeof url !== 'string') return false
    const trimmed = url.trim()
    if (!trimmed) return true
    return PROXY_URL_REGEX.test(trimmed)
}

/**
 * 解析帳號實際使用的代理 URL
 * 優先順序: account.proxy > 全域性 PROXY_URL > 不使用代理
 * @param {Object} [account] - 帳號物件（可選）
 * @returns {string|null}
 */
const resolveProxyUrl = (account) => {
    if (account && typeof account.proxy === 'string' && account.proxy.trim()) {
        return account.proxy.trim()
    }
    return config.proxyUrl || null
}

/**
 * 根據 URL 獲取或建立代理 agent
 * @param {string|null} url
 * @returns {HttpsProxyAgent|undefined}
 */
const getOrCreateAgent = (url) => {
    if (!url) return undefined
    let agent = proxyAgents.get(url)
    if (!agent) {
        agent = new HttpsProxyAgent(url)
        proxyAgents.set(url, agent)
    }
    return agent
}

/**
 * 獲取代理 Agent
 * @param {Object} [account] - 帳號物件（可選）。未傳則回退到全域性 PROXY_URL
 * @returns {HttpsProxyAgent|undefined}
 */
const getProxyAgent = (account) => {
    return getOrCreateAgent(resolveProxyUrl(account))
}

/**
 * 顯式失效快取中的某個代理 agent
 * 當帳號代理 URL 被修改或刪除時呼叫，釋放底層 socket
 * @param {string|null} url
 */
const invalidateProxyAgent = (url) => {
    if (!url) return
    const agent = proxyAgents.get(url)
    if (!agent) return
    try {
        if (typeof agent.destroy === 'function') {
            agent.destroy()
        }
    } catch (_) {
        // destroy 失敗不影響後續邏輯
    }
    proxyAgents.delete(url)
}

/**
 * 獲取 Chat API 基礎 URL
 * @returns {string}
 */
const getChatBaseUrl = () => config.qwenChatProxyUrl

/**
 * 獲取 CLI API 基礎 URL
 * @returns {string}
 */
const getCliBaseUrl = () => config.qwenCliProxyUrl

/**
 * 為 axios 請求配置新增代理設定
 * 注意：account 作為第二個可選引數以保持向後相容（舊呼叫點只傳 requestConfig）
 * @param {Object} [requestConfig] - axios 請求配置物件
 * @param {Object} [account] - 帳號物件（可選）
 * @returns {Object}
 */
const applyProxyToAxiosConfig = (requestConfig = {}, account) => {
    const proxyAgent = getProxyAgent(account)
    if (proxyAgent) {
        requestConfig.httpsAgent = proxyAgent
        requestConfig.proxy = false
    }
    return requestConfig
}

/**
 * 為 fetch 請求配置新增代理設定
 * @param {Object} [fetchOptions] - fetch 請求配置物件
 * @param {Object} [account] - 帳號物件（可選）
 * @returns {Object}
 */
const applyProxyToFetchOptions = (fetchOptions = {}, account) => {
    const proxyAgent = getProxyAgent(account)
    if (proxyAgent) {
        fetchOptions.agent = proxyAgent
    }
    return fetchOptions
}

module.exports = {
    resolveProxyUrl,
    getProxyAgent,
    invalidateProxyAgent,
    getChatBaseUrl,
    getCliBaseUrl,
    applyProxyToAxiosConfig,
    applyProxyToFetchOptions,
    isValidProxyUrl
}
