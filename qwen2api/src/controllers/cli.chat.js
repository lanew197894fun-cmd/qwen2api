const axios = require('axios')
const { logger } = require('../utils/logger')
const { getProxyAgent, getCliBaseUrl, applyProxyToAxiosConfig } = require('../utils/proxy-helper')

const MODEL_REDIRECT = {
    'qwen3.5-plus': 'coder-model',
}

const CLI_UNSUPPORTED_FIELDS = new Set([
    'frequency_penalty',
    'presence_penalty',
    'logit_bias',
    'logprobs',
    'top_logprobs',
    'n',
    'seed',
    'service_tier',
    'user'
])
const CLI_DEFAULT_SYSTEM_PART = {
    type: 'text',
    text: '',
    cache_control: {
        type: 'ephemeral'
    }
}

function pruneCliPayload(value) {
    if (Array.isArray(value)) {
        return value
            .map(item => pruneCliPayload(item))
            .filter(item => item !== undefined)
    }

    if (value && typeof value === 'object') {
        const nextObject = {}

        for (const [key, item] of Object.entries(value)) {
            if (CLI_UNSUPPORTED_FIELDS.has(key)) {
                continue
            }

            const nextValue = pruneCliPayload(item)
            if (nextValue === undefined) {
                continue
            }

            if (Array.isArray(nextValue) && nextValue.length === 0 && key !== 'messages') {
                continue
            }

            if (
                nextValue &&
                typeof nextValue === 'object' &&
                !Array.isArray(nextValue) &&
                Object.keys(nextValue).length === 0
            ) {
                continue
            }

            nextObject[key] = nextValue
        }

        return nextObject
    }

    if (value === null || value === undefined) {
        return undefined
    }

    return value
}

function isInjectedSystemPart(part) {
    return Boolean(
        part &&
        typeof part === 'object' &&
        part.type === 'text' &&
        part.cache_control &&
        part.cache_control.type === 'ephemeral' &&
        typeof part.text === 'string'
    )
}

function makeCliTextPart(text) {
    return {
        type: 'text',
        text: typeof text === 'string' ? text : String(text ?? '')
    }
}

function appendCliSystemContent(systemParts, content) {
    if (content === undefined || content === null) {
        return
    }

    if (Array.isArray(content)) {
        for (const item of content) {
            appendCliSystemContent(systemParts, item)
        }
        return
    }

    if (typeof content === 'string') {
        systemParts.push(makeCliTextPart(content))
        return
    }

    if (typeof content === 'object') {
        if (isInjectedSystemPart(content)) {
            return
        }

        if (typeof content.text === 'string' && content.type === 'text') {
            systemParts.push(content)
            return
        }

        systemParts.push(content)
        return
    }

    systemParts.push(makeCliTextPart(content))
}

function ensureCliSystemMessage(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return messages
    }

    const systemParts = [JSON.parse(JSON.stringify(CLI_DEFAULT_SYSTEM_PART))]
    const nonSystemMessages = []

    for (const message of messages) {
        if (!message || typeof message !== 'object') {
            continue
        }

        const role = typeof message.role === 'string' ? message.role.toLowerCase() : ''
        if (role === 'system') {
            appendCliSystemContent(systemParts, message.content)
            continue
        }

        nonSystemMessages.push(message)
    }

    return [
        {
            role: 'system',
            content: systemParts
        },
        ...nonSystemMessages
    ]
}

/**
 * 讀取流響應體為文本
 * @param {*} stream - 響應流
 * @returns {Promise<string>} 文本結果
 */
function readStreamBody(stream) {
    return new Promise((resolve, reject) => {
        if (!stream || typeof stream.on !== 'function') {
            resolve('')
            return
        }

        const chunks = []
        stream.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        })
        stream.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'))
        })
        stream.on('error', reject)
    })
}

/**
 * 嘗試解析 CLI 錯誤詳情
 * @param {*} data - 原始響應體
 * @returns {Promise<*>} 可序列化的詳情
 */
async function normalizeCliErrorDetails(data) {
    if (data && typeof data.on === 'function') {
        const rawText = await readStreamBody(data)
        if (!rawText) {
            return ''
        }

        try {
            return JSON.parse(rawText)
        } catch (error) {
            return rawText
        }
    }

    if (Buffer.isBuffer(data)) {
        const rawText = data.toString('utf8')
        try {
            return JSON.parse(rawText)
        } catch (error) {
            return rawText
        }
    }

    return data
}

/**
 * 構造 CLI 錯誤日誌上下文
 * @param {Error} error - 錯誤物件
 * @returns {Promise<object>} 日誌上下文
 */
async function buildCliAxiosErrorLog(error) {
    return {
        message: error?.message,
        code: error?.code,
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        details: await normalizeCliErrorDetails(error?.response?.data)
    }
}

function preprocessCliRequestBody(rawBody) {
    const clonedBody = rawBody && typeof rawBody === 'object' ? JSON.parse(JSON.stringify(rawBody)) : {}
    const body = pruneCliPayload(clonedBody) || {}

    if (body.model && MODEL_REDIRECT[body.model]) {
        body.model = MODEL_REDIRECT[body.model]
    }
    if (Array.isArray(body.messages) && body.messages.length > 0) {
        body.messages = ensureCliSystemMessage(body.messages)
    }
    if (body.stream_options && typeof body.stream_options === 'object' && Object.keys(body.stream_options).length === 0) {
        delete body.stream_options
    }

    return body
}

function formatCliJsonResponse(data, fallbackModel) {
    if (!data || typeof data !== 'object') {
        return data
    }
    if (!data.object) {
        data.object = 'chat.completion'
    }
    if (!data.model && fallbackModel) {
        data.model = fallbackModel
    }
    if (!Array.isArray(data.choices)) {
        data.choices = []
    }
    return data
}

/**
 * 處理CLI聊天完成請求（支援OpenAI格式的流式和JSON響應）
 * @param {Object} req - Express請求物件
 * @param {Object} res - Express響應物件
 */
const handleCliChatCompletion = async (req, res) => {
    try {
        const access_token = req.account.cli_info.access_token
        const body = preprocessCliRequestBody(req.body)
        const isStream = body.stream === true

        // 列印當前使用的帳號郵箱
        logger.info(`CLI請求使用帳號[${req.account.email}]開始處理`, 'CLI', '🚀')

        // 無論成功失敗都增加請求計數
        req.account.cli_info.request_number++

        const cliBaseUrl = getCliBaseUrl()
        const proxyAgent = getProxyAgent(req.account)

        // 設定請求配置
        const axiosConfig = {
            method: 'POST',
            url: `${cliBaseUrl}/v1/chat/completions`,
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json',
                'Accept': isStream ? 'text/event-stream' : 'application/json',
                'User-Agent': 'QwenCode/0.10.3 (darwin; arm64)',
                'X-Dashscope-Useragent': 'QwenCode/0.10.3 (darwin; arm64)',
                'X-Stainless-Runtime-Version': 'v22.17.0',
                'Sec-Fetch-Mode': 'cors',
                'X-Stainless-Lang': 'js',
                'X-Stainless-Arch': 'arm64',
                'X-Stainless-Package-Version': '5.11.0',
                'X-Dashscope-Cachecontrol': 'enable',
                'X-Stainless-Retry-Count': '0',
                'X-Stainless-Os': 'MacOS',
                'X-Dashscope-Authtype': 'qwen-oauth',
                'X-Stainless-Runtime': 'node'
            },
            data: body,
            timeout: 5 * 60 * 1000,
            validateStatus: function () {
                return true
            }
        }

        // 新增代理配置
        if (proxyAgent) {
            axiosConfig.httpsAgent = proxyAgent
            axiosConfig.proxy = false
        }

        // 如果是流式請求，設定響應型別為流
        if (isStream) {
            axiosConfig.responseType = 'stream'

            // 設定響應頭為流式
            res.setHeader('Content-Type', 'text/event-stream')
            res.setHeader('Cache-Control', 'no-cache')
            res.setHeader('Connection', 'keep-alive')
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Headers', '*')
        }

        const response = await axios(axiosConfig)

        // 檢查響應狀態
        if (response.status !== 200) {
            const errorDetails = await normalizeCliErrorDetails(response.data)
            logger.error(`CLI請求使用帳號[${req.account.email}]轉發失敗 - 狀態碼: ${response.status} - 當前請求數: ${req.account.cli_info.request_number}`, 'CLI', '❌', {
                status: response.status,
                statusText: response.statusText,
                requestBody: body,
                details: errorDetails
            })
            return res.status(response.status).json({
                error: {
                    message: `api_error`,
                    type: 'api_error',
                    code: response.status,
                    details: errorDetails
                }
            })
        }

        // 處理流式響應
        if (isStream) {
            // 逐行轉發，確保始終輸出標準 SSE 片段
            response.data.on('data', (chunk) => {
                const text = chunk.toString('utf8')
                const lines = text.split('\n')
                for (const line of lines) {
                    if (!line || !line.startsWith('data:')) continue
                    res.write(`${line}\n\n`)
                }
            })

            // 處理流錯誤
            response.data.on('error', (streamError) => {
                logger.error(`CLI請求使用帳號[${req.account.email}]流式傳輸失敗 - 當前請求數: ${req.account.cli_info.request_number}`, 'CLI', '❌')
                if (!res.headersSent) {
                    res.status(500).json({
                        error: {
                            message: 'stream_error',
                            type: 'stream_error',
                            code: 500
                        }
                    })
                }
            })

            // 處理流結束
            response.data.on('end', () => {
                logger.success(`CLI請求使用帳號[${req.account.email}]轉發成功 (流式) - 當前請求數: ${req.account.cli_info.request_number}`, 'CLI')
                res.end()
            })
        } else {
            // 處理JSON響應
            res.json(formatCliJsonResponse(response.data, body.model))
            logger.success(`CLI請求使用帳號[${req.account.email}]轉發成功 (JSON) - 當前請求數: ${req.account.cli_info.request_number}`, 'CLI')
        }
    } catch (error) {
        logger.error(`CLI請求使用帳號[${req.account.email}]處理異常 - 當前請求數: ${req.account.cli_info.request_number}`, 'CLI', '💥', {
            requestBody: body,
            ...(await buildCliAxiosErrorLog(error))
        })

        // 如果是axios錯誤，提供更詳細的錯誤資訊
        if (error.response) {
            const errorDetails = await normalizeCliErrorDetails(error.response.data)
            return res.status(error.response.status).json({
                error: {
                    message: "api_error",
                    type: 'api_error',
                    code: error.response.status,
                    details: errorDetails
                }
            })
        } else if (error.request) {
            return res.status(503).json({
                error: {
                    message: 'connection_error',
                    type: 'connection_error',
                    code: 503
                }
            })
        } else {
            return res.status(500).json({
                error: {
                    message: 'internal_error',
                    type: 'internal_error',
                    code: 500
                }
            })
        }
    }
}

module.exports = {
    handleCliChatCompletion
}
