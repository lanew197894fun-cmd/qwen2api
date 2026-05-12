const axios = require('axios')
const accountManager = require('../utils/account.js')
const { getSsxmodItna, getSsxmodItna2 } = require('../utils/ssxmod-manager')
const { getProxyAgent, getChatBaseUrl, applyProxyToAxiosConfig } = require('../utils/proxy-helper')

let cachedModels = null
let fetchPromise = null

const getLatestModels = async (force = false) => {
    // 如果有快取且不強制重新整理，直接返回
    if (cachedModels && !force) {
        return cachedModels
    }

    // 如果正在獲取，返回當前的 Promise
    if (fetchPromise) {
        return fetchPromise
    }

    const chatBaseUrl = getChatBaseUrl()
    // 一次取出帳戶物件，token 與 proxy 走同一個帳號，避免 round-robin 錯位
    const account = accountManager.getAccount()
    const proxyAgent = getProxyAgent(account)

    const requestConfig = {
        headers: {
            'Authorization': `Bearer ${account ? account.token : ''}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ...(getSsxmodItna() && { 'Cookie': `ssxmod_itna=${getSsxmodItna()};ssxmod_itna2=${getSsxmodItna2()}` })
        }
    }

    // 新增代理配置
    if (proxyAgent) {
        requestConfig.httpsAgent = proxyAgent
        requestConfig.proxy = false
    }

    fetchPromise = axios.get(`${chatBaseUrl}/api/models`, requestConfig).then(response => {
        // console.log(response)
        cachedModels = response.data.data
        fetchPromise = null
        return cachedModels
    }).catch(error => {
        console.error('Error fetching latest models:', error)
        fetchPromise = null
        return []
    })

    return fetchPromise
}

/**
 * 根據聊天型別獲取預設模型
 * @param {string} chatType - 聊天型別
 * @returns {Promise<string|null>} 預設模型 ID
 */
const getDefaultModelByChatType = async (chatType) => {
    const models = await getLatestModels()

    const matchedModel = models.find(model => model?.info?.meta?.chat_type?.includes(chatType))
    return matchedModel?.id || null
}

module.exports = {
    getLatestModels,
    getDefaultModelByChatType
}
