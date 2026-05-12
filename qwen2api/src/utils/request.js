const axios = require('axios')
const accountManager = require('./account.js')
const { logger } = require('./logger')
const { getSsxmodItna, getSsxmodItna2 } = require('./ssxmod-manager')
const { getProxyAgent, getChatBaseUrl, applyProxyToAxiosConfig } = require('./proxy-helper')

// ─── 重試輔助：指數退避，最多 retries 次 ───
async function withRetry(fn, retries = 2, baseDelay = 1000) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        const delay = Math.min(baseDelay * Math.pow(2, i), 5000);
        logger.warn(`請求重試 ${i + 1}/${retries}: ${err.message}，等待 ${delay}ms`, 'RETRY');
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

/**
 * 傳送聊天請求
 * @param {Object} body - 請求體
 * @param {number} retryCount - 當前重試次數
 * @param {string} lastUsedEmail - 上次使用的郵箱（用於錯誤記錄）
 * @returns {Promise<Object>} 響應結果
 */
const sendChatRequest = async (body) => {
    try {
        // 獲取可用的帳戶（包含 proxy 等完整欄位）
        const currentAccount = accountManager.getAccount()
        const currentToken = currentAccount ? currentAccount.token : null

        if (!currentToken) {
            logger.error('無法獲取有效的訪問令牌', 'TOKEN')
            return {
                status: false,
                response: null
            }
        }

        const chatBaseUrl = getChatBaseUrl()
        const proxyAgent = getProxyAgent(currentAccount)

        // 構建請求配置
        const requestConfig = {
            headers: {
                'Authorization': `Bearer ${currentToken}`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
                "Connection": "keep-alive",
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Content-Type": "application/json",
                "Timezone": "Mon Dec 08 2025 17:28:55 GMT+0800",
                "sec-ch-ua": "\"Microsoft Edge\";v=\"143\", \"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"",
                "source": "web",
                "Version": "0.1.13",
                "bx-v": "2.5.31",
                "Origin": chatBaseUrl,
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
                "Referer": `${chatBaseUrl}/c/guest`,
                "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
                "Cookie": `ssxmod_itna=${getSsxmodItna()};ssxmod_itna2=${getSsxmodItna2()}`,
            },
            responseType: 'stream', // Always use streaming (upstream doesn't support stream=false)
            timeout: 60 * 1000,
        }

        // 新增代理配置
        if (proxyAgent) {
            requestConfig.httpsAgent = proxyAgent
            requestConfig.proxy = false // 停用axios預設代理，使用httpsAgent
        }

        // console.log(body)
        // console.log(requestConfig)

        const chat_id = await generateChatID(currentToken, body.model, currentAccount)

        logger.network(`傳送聊天請求`, 'REQUEST')
        const response = await withRetry(() => axios.post(`${chatBaseUrl}/api/v2/chat/completions?chat_id=` + chat_id, {
            ...body,
            stream: true,
            chat_id: chat_id
        }, requestConfig), 2, 1000)

        // 請求成功
        if (response.status === 200) {
            // console.log(response.data)
            return {
                currentToken: currentToken,
                status: true,
                response: response.data
            }
        }

    } catch (error) {
        console.log(error)
        logger.error('傳送聊天請求失敗', 'REQUEST', '', error.message)
        return {
            status: false,
            response: null
        }
    }
}

/**
 * 生成chat_id
 * @param {string} currentToken
 * @param {string} model
 * @param {Object} [account] - 當前帳戶物件（用於解析帳號級代理）
 * @returns {Promise<string|null>} 返回生成的chat_id，如果失敗則返回null
 */
const generateChatID = async (currentToken, model, account) => {
    try {
        const chatBaseUrl = getChatBaseUrl()
        const proxyAgent = getProxyAgent(account)

        const requestConfig = {
            headers: {
                'Authorization': `Bearer ${currentToken}`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
                "Connection": "keep-alive",
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Content-Type": "application/json",
                "Timezone": "Mon Dec 08 2025 17:28:55 GMT+0800",
                "sec-ch-ua": "\"Microsoft Edge\";v=\"143\", \"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"",
                "source": "web",
                "Version": "0.1.13",
                "bx-v": "2.5.31",
                "Origin": chatBaseUrl,
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
                "Referer": `${chatBaseUrl}/c/guest`,
                "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
                "Cookie": `ssxmod_itna=${getSsxmodItna()};ssxmod_itna2=${getSsxmodItna2()}`,
            }
        }

        // 新增代理配置
        if (proxyAgent) {
            requestConfig.httpsAgent = proxyAgent
            requestConfig.proxy = false
        }

        const response_data = await withRetry(() => axios.post(`${chatBaseUrl}/api/v2/chats/new`, {
            "title": "New Chat",
            "models": [
                model
            ],
            "chat_mode": "local",
            "chat_type": "t2i",
            "timestamp": new Date().getTime()
        }, requestConfig), 1, 500)

        return response_data.data?.data?.id || null

    } catch (error) {
        logger.error('生成chat_id失敗', 'CHAT', '', error.message)
        return null
    }
}

module.exports = {
    sendChatRequest,
    generateChatID
}