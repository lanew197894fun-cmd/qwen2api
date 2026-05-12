const axios = require('axios')
const { logger } = require('../utils/logger.js')
const { setResponseHeaders } = require('./chat.js')
const accountManager = require('../utils/account.js')
const { sleep } = require('../utils/tools.js')
const { generateChatID } = require('../utils/request.js')
const { uploadFileToQwenOss } = require('../utils/upload.js')
const { parserModel } = require('../utils/chat-helpers.js')
const { getDefaultModelByChatType } = require('../models/models-map.js')
const { getSsxmodItna, getSsxmodItna2 } = require('../utils/ssxmod-manager')
const { getProxyAgent, getChatBaseUrl, applyProxyToAxiosConfig } = require('../utils/proxy-helper')

const DATA_URI_REGEX = /^data:(.+);base64,(.*)$/i
const HTTP_URL_REGEX = /^https?:\/\//i

/**
 * 構造與當前帳號一致的上游 Cookie 頭
 * @param {string} token - 當前帳號令牌
 * @returns {string} Cookie 頭
 */
const buildUpstreamCookieHeader = (token) => {
    const cookieParts = []

    if (token) {
        cookieParts.push(`token=${token}`)
    }

    const ssxmodItna = getSsxmodItna()
    const ssxmodItna2 = getSsxmodItna2()

    if (ssxmodItna) {
        cookieParts.push(`ssxmod_itna=${ssxmodItna}`)
    }

    if (ssxmodItna2) {
        cookieParts.push(`ssxmod_itna2=${ssxmodItna2}`)
    }

    return cookieParts.join('; ')
}

/**
 * 將上游響應體格式化為便於日誌輸出的物件
 * @param {*} payload - 原始響應體
 * @returns {*} 可序列化的日誌物件
 */
const formatPayloadForLog = (payload) => {
    if (payload === undefined) {
        return null
    }

    if (Buffer.isBuffer(payload)) {
        return payload.toString('utf-8')
    }

    if (typeof payload === 'string') {
        const trimmedPayload = payload.trim()
        if (!trimmedPayload) {
            return ''
        }

        try {
            return JSON.parse(trimmedPayload)
        } catch (e) {
            return trimmedPayload.slice(0, 4000)
        }
    }

    if (typeof payload === 'object' && payload !== null) {
        if (typeof payload.on === 'function') {
            return '[stream]'
        }
        return payload
    }

    return payload
}

/**
 * 提取 Axios 錯誤的完整日誌上下文
 * @param {Error} error - Axios 錯誤物件
 * @returns {object} 日誌上下文
 */
const buildAxiosErrorLog = (error) => ({
    message: error?.message,
    code: error?.code,
    status: error?.response?.status,
    statusText: error?.response?.statusText,
    headers: error?.response?.headers,
    data: formatPayloadForLog(error?.response?.data)
})

const parseUpstreamImageError = (data) => {
    try {
        const rawPayload = formatPayloadForLog(data)
        let payload = data

        if (Array.isArray(payload) && payload.length > 0) {
            payload = payload[0]
        }

        if (typeof payload === 'string') {
            payload = JSON.parse(payload)
        }

        // 只有明確 success=false 且帶錯誤碼時，才按上游錯誤包處理，避免誤傷正常業務響應
        if (!payload || payload.success !== false || !payload.data?.code) {
            return null
        }

        const errorData = payload.data
        if (errorData.code === 'RateLimited') {
            const waitHours = errorData.num
            logger.error(`圖片/影片生成額度已用盡，需等待約 ${waitHours || '未知'} 小時`, 'CHAT', '', {
                parsed_error: errorData,
                raw_response_body: rawPayload
            })
            return {
                error: `當前帳號的該功能使用次數已達上限，${waitHours ? `請等待約 ${waitHours} 小時後再試` : '請稍後再試'}`,
                code: errorData.code,
                wait_hours: waitHours,
                status: 429
            }
        }

        logger.error('請求上游服務時出現錯誤', 'CHAT', '', {
            parsed_error: errorData,
            raw_response_body: rawPayload
        })
        return {
            error: errorData.details || errorData.code || '服務錯誤，請稍後再試',
            code: errorData.code,
            request_id: payload.request_id,
            status: errorData.code === 'Bad_Request' && /internal error/i.test(errorData.details || '') ? 502 : 500
        }
    } catch (e) {
        return null
    }
}

const parseUpstreamImageErrorFromText = (text) => {
    try {
        if (!text || typeof text !== 'string') {
            return null
        }

        // 圖片介面在額度耗盡時可能返回普通 JSON 文本而不是 SSE，需要在流結束後補做一次識別
        return parseUpstreamImageError(JSON.parse(text))
    } catch (e) {
        return null
    }
}

/**
 * 收集物件中的所有值
 * @param {*} payload - 任意負載
 * @param {Set<object>} visited - 已訪問物件集合
 * @returns {Array<*>} 所有巢狀值
 */
const collectNestedValues = (payload, visited = new Set()) => {
    if (!payload || typeof payload !== 'object') {
        return []
    }

    if (visited.has(payload)) {
        return []
    }
    visited.add(payload)

    if (Array.isArray(payload)) {
        return payload.flatMap(item => [item, ...collectNestedValues(item, visited)])
    }

    return Object.values(payload).flatMap(item => [item, ...collectNestedValues(item, visited)])
}

/**
 * 解析 SSE 緩衝區中的 `data:` 負載
 * @param {string} buffer - SSE 緩衝區
 * @param {boolean} flush - 是否強制解析剩餘內容
 * @returns {{ payloads: string[], buffer: string }} 解析結果
 */
const parseSsePayloads = (buffer, flush = false) => {
    const input = flush ? `${buffer}\n\n` : buffer
    const events = input.split(/\r?\n\r?\n/)
    const payloads = []
    const remainBuffer = flush ? '' : (events.pop() || '')

    for (const event of events) {
        const dataLines = event
            .split(/\r?\n/)
            .filter(item => item.trim().startsWith('data:'))
            .map(item => item.replace(/^data:\s*/, '').trim())
            .filter(Boolean)

        if (dataLines.length === 0) {
            continue
        }

        const payload = dataLines.join('\n').trim()
        if (payload && payload !== '[DONE]') {
            payloads.push(payload)
        }
    }

    return {
        payloads,
        buffer: remainBuffer
    }
}

/**
 * 從文本中提取首個資源連結
 * @param {string} text - 文本內容
 * @returns {string|null} 資源連結
 */
const extractResourceUrlFromText = (text) => {
    if (!text || typeof text !== 'string') {
        return null
    }

    const markdownUrl = text.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i)?.[1]
    if (markdownUrl) {
        return markdownUrl
    }

    const downloadUrl = text.match(/\[Download [^\]]+\]\((https?:\/\/[^\s)]+)\)/i)?.[1]
    if (downloadUrl) {
        return downloadUrl
    }

    const plainUrl = text.match(/https?:\/\/[^\s<>"')\]]+/i)?.[0]
    return plainUrl || null
}

/**
 * 從文本中提取影片任務 ID
 * @param {string} text - 文本內容
 * @returns {string|null} 影片任務 ID
 */
const extractVideoTaskIDFromText = (text) => {
    if (!text || typeof text !== 'string') {
        return null
    }

    const patterns = [
        /"task_id"\s*:\s*"([^"]+)"/i,
        /"taskId"\s*:\s*"([^"]+)"/i,
        /task_id\s*[:=]\s*["']?([a-zA-Z0-9._-]+)["']?/i,
        /taskId\s*[:=]\s*["']?([a-zA-Z0-9._-]+)["']?/i,
        /"id"\s*:\s*"([^"]+)"[\s\S]{0,120}"task_status"/i
    ]

    for (const pattern of patterns) {
        const matchedTaskID = text.match(pattern)?.[1]
        if (matchedTaskID && matchedTaskID.trim() !== '') {
            return matchedTaskID.trim()
        }
    }

    return null
}

/**
 * 從文本中提取響應 ID
 * @param {string} text - 文本內容
 * @returns {string[]} 響應 ID 列表
 */
const extractResponseIDsFromText = (text) => {
    if (!text || typeof text !== 'string') {
        return []
    }

    const responseIDs = []
    const patterns = [
        /"response_id"\s*:\s*"([^"]+)"/ig,
        /"responseId"\s*:\s*"([^"]+)"/ig
    ]

    for (const pattern of patterns) {
        let matched = null
        while ((matched = pattern.exec(text)) !== null) {
            const responseID = matched[1]?.trim()
            if (responseID && !responseIDs.includes(responseID)) {
                responseIDs.push(responseID)
            }
        }
    }

    return responseIDs
}

/**
 * 從上游響應中提取資源連結
 * @param {*} payload - 上游響應負載
 * @returns {string|null} 資源連結
 */
const extractResourceUrlFromPayload = (payload) => {
    if (!payload) {
        return null
    }

    if (Array.isArray(payload)) {
        for (const item of payload) {
            const matchedUrl = extractResourceUrlFromPayload(item)
            if (matchedUrl) {
                return matchedUrl
            }
        }
        return null
    }

    if (typeof payload === 'string') {
        const trimmedPayload = payload.trim()

        if ((trimmedPayload.startsWith('{') || trimmedPayload.startsWith('['))) {
            try {
                const parsedPayload = JSON.parse(trimmedPayload)
                const matchedUrl = extractResourceUrlFromPayload(parsedPayload)
                if (matchedUrl) {
                    return matchedUrl
                }
            } catch (e) {
            }
        }

        return extractResourceUrlFromText(trimmedPayload)
    }

    if (typeof payload !== 'object') {
        return null
    }

    const directCandidates = [
        payload.content,
        payload.url,
        payload.image,
        payload.video,
        payload.video_url,
        payload.videoUrl,
        payload.download_url,
        payload.downloadUrl,
        payload.file_url,
        payload.resource_url,
        payload.resourceUrl,
        payload.output_url,
        payload.result_url,
        payload.final_url,
        payload.finalUrl,
        payload.uri
    ]

    for (const candidate of directCandidates) {
        const matchedUrl = extractResourceUrlFromPayload(candidate)
        if (matchedUrl) {
            return matchedUrl
        }
    }

    const nestedCandidates = [
        payload.data,
        payload.message,
        payload.delta,
        payload.extra,
        payload.choices,
        payload.messages,
        payload.output,
        payload.result,
        payload.results,
        payload.urls,
        payload.files,
        payload.image_list,
        payload.video_list
    ]

    for (const candidate of nestedCandidates) {
        const matchedUrl = extractResourceUrlFromPayload(candidate)
        if (matchedUrl) {
            return matchedUrl
        }
    }

    for (const candidate of collectNestedValues(payload)) {
        const matchedUrl = extractResourceUrlFromPayload(candidate)
        if (matchedUrl) {
            return matchedUrl
        }
    }

    return null
}

/**
 * 從上游響應中提取響應 ID
 * @param {*} payload - 上游響應負載
 * @returns {string[]} 響應 ID 列表
 */
const extractResponseIDsFromPayload = (payload) => {
    if (!payload) {
        return []
    }

    if (Array.isArray(payload)) {
        return payload.flatMap(item => extractResponseIDsFromPayload(item))
    }

    if (typeof payload === 'string') {
        const trimmedPayload = payload.trim()
        if (!trimmedPayload) {
            return []
        }

        try {
            return extractResponseIDsFromPayload(JSON.parse(trimmedPayload))
        } catch (e) {
            return extractResponseIDsFromText(trimmedPayload)
        }
    }

    if (typeof payload !== 'object') {
        return []
    }

    const responseIDs = []
    const pushResponseID = (responseID) => {
        if ((typeof responseID === 'string' || typeof responseID === 'number') && String(responseID).trim() !== '') {
            const normalizedResponseID = String(responseID).trim()
            if (!responseIDs.includes(normalizedResponseID)) {
                responseIDs.push(normalizedResponseID)
            }
        }
    }

    pushResponseID(payload.response_id)
    pushResponseID(payload.responseId)
    pushResponseID(payload?.response?.created?.response_id)
    pushResponseID(payload?.response?.created?.responseId)

    for (const candidate of collectNestedValues(payload)) {
        for (const nestedID of extractResponseIDsFromPayload(candidate)) {
            pushResponseID(nestedID)
        }
    }

    return responseIDs
}

/**
 * 從上游響應中提取影片任務 ID
 * @param {*} payload - 上游響應負載
 * @returns {string|null} 影片任務 ID
 */
const extractVideoTaskIdentifiersFromPayload = (payload) => {
    if (!payload) {
        return []
    }

    if (Array.isArray(payload)) {
        const taskIDs = []
        for (const item of payload) {
            for (const taskID of extractVideoTaskIdentifiersFromPayload(item)) {
                if (!taskIDs.includes(taskID)) {
                    taskIDs.push(taskID)
                }
            }
        }
        return taskIDs
    }

    if (typeof payload === 'string') {
        const trimmedPayload = payload.trim()
        if (!trimmedPayload) {
            return []
        }

        try {
            return extractVideoTaskIdentifiersFromPayload(JSON.parse(trimmedPayload))
        } catch (e) {
            const taskID = extractVideoTaskIDFromText(trimmedPayload)
            return taskID ? [taskID] : []
        }
    }

    if (typeof payload !== 'object') {
        return []
    }

    const taskIDs = []
    const pushTaskID = (taskID) => {
        if ((typeof taskID === 'string' || typeof taskID === 'number') && String(taskID).trim() !== '') {
            const normalizedTaskID = String(taskID).trim()
            if (!taskIDs.includes(normalizedTaskID)) {
                taskIDs.push(normalizedTaskID)
            }
        }
    }

    pushTaskID(payload.task_id)
    pushTaskID(payload.taskId)
    pushTaskID(payload?.wanx?.task_id)
    pushTaskID(payload?.output?.task_id)
    pushTaskID(payload?.result?.task_id)
    pushTaskID(payload?.results?.task_id)
    pushTaskID(payload.response_id)
    pushTaskID(payload.responseId)

    const nestedCandidates = [
        payload.wanx,
        payload.data,
        payload.message,
        payload.delta,
        payload.extra,
        payload.choices,
        payload.messages,
        payload.output,
        payload.result,
        payload.results
    ]

    for (const candidate of nestedCandidates) {
        for (const taskID of extractVideoTaskIdentifiersFromPayload(candidate)) {
            pushTaskID(taskID)
        }
    }

    const isTaskPayload = payload.task_status || payload.status === 'pending' || payload.status === 'running' || payload.type === 'task' || /task/i.test(payload.object || '')
    if (isTaskPayload && (typeof payload.id === 'string' || typeof payload.id === 'number') && String(payload.id).trim() !== '') {
        pushTaskID(payload.id)
    }

    for (const candidate of collectNestedValues(payload)) {
        for (const taskID of extractVideoTaskIdentifiersFromPayload(candidate)) {
            pushTaskID(taskID)
        }
    }

    return taskIDs
}

/**
 * 從上游響應中提取首個影片任務 ID
 * @param {*} payload - 上游響應負載
 * @returns {string|null} 影片任務 ID
 */
const extractVideoTaskIDFromPayload = (payload) => extractVideoTaskIdentifiersFromPayload(payload)[0] || null

/**
 * 判斷是否屬於可重試的上游生成錯誤
 * @param {object|null} upstreamError - 上游錯誤
 * @returns {boolean} 是否可重試
 */
const isRetryableUpstreamError = (upstreamError) => {
    if (!upstreamError) {
        return false
    }

    return upstreamError.code === 'Bad_Request' && /internal error/i.test(upstreamError.error || '')
}

/**
 * 向下遊傳送上游錯誤
 * @param {object} res - Express 響應物件
 * @param {object} upstreamError - 上游錯誤
 * @returns {*} 響應結果
 */
const sendUpstreamError = (res, upstreamError) => {
    const { status, ...payload } = upstreamError
    return res.status(status || 500).json(payload)
}

/**
 * 構造圖片訊息內容
 * @param {string} contentUrl - 圖片連結
 * @returns {string} 圖片訊息內容
 */
const buildImageContent = (contentUrl) => `![image](${contentUrl})`

/**
 * 構造影片訊息內容
 * @param {string} contentUrl - 影片連結
 * @returns {string} 影片訊息內容
 */
const buildVideoContent = (contentUrl) => `\n<video controls="controls">\n${contentUrl}\n</video>\n\n[Download Video](${contentUrl})\n`

/**
 * 解析可能為 JSON 字串的請求欄位
 * @param {*} value - 原始值
 * @returns {*} 解析後的值
 */
const parseMaybeJSON = (value) => {
    if (typeof value !== 'string') {
        return value
    }

    const trimmedValue = value.trim()
    if (!trimmedValue) {
        return value
    }

    try {
        return JSON.parse(trimmedValue)
    } catch (e) {
        return value
    }
}

/**
 * 統一轉為陣列
 * @param {*} value - 原始值
 * @returns {Array<*>} 陣列結果
 */
const ensureArray = (value) => {
    const parsedValue = parseMaybeJSON(value)

    if (parsedValue === undefined || parsedValue === null || parsedValue === '') {
        return []
    }

    return Array.isArray(parsedValue) ? parsedValue : [parsedValue]
}

/**
 * 規範化 OpenAI 風格尺寸引數
 * @param {string} size - 原始尺寸
 * @returns {string|undefined} 規範化後的尺寸
 */
const normalizeOpenAIImageVideoSize = (size) => {
    if (!size) {
        return undefined
    }

    const normalizedSizeMap = {
        '1024x1024': '1:1',
        '1536x1024': '4:3',
        '1024x1536': '3:4',
        '1792x1024': '16:9',
        '1024x1792': '9:16'
    }

    return normalizedSizeMap[size] || size
}

/**
 * 統一構造 OpenAI 風格錯誤響應
 * @param {object} res - Express 響應物件
 * @param {*} error - 錯誤物件
 * @returns {*} 響應結果
 */
const sendOpenAIErrorResponse = (res, error) => {
    const status = error?.status || 500
    const message = error?.error || error?.message || '服務錯誤，請稍後再試'

    return res.status(status).json({
        error: {
            message,
            type: status >= 500 ? 'server_error' : 'invalid_request_error'
        }
    })
}

/**
 * 下載資源並轉換為 Base64
 * @param {string} contentUrl - 資源連結
 * @returns {Promise<string>} Base64 內容
 */
const downloadAssetAsBase64 = async (contentUrl, account) => {
    const proxyAgent = getProxyAgent(account)
    const requestConfig = {
        responseType: 'arraybuffer',
        timeout: 1000 * 60 * 2
    }

    if (proxyAgent) {
        requestConfig.httpsAgent = proxyAgent
        requestConfig.proxy = false
    }

    const responseData = await axios.get(contentUrl, requestConfig)
    return Buffer.from(responseData.data).toString('base64')
}

/**
 * 構造 OpenAI 影像響應項
 * @param {string} contentUrl - 圖片連結
 * @param {string} responseFormat - 輸出格式
 * @returns {Promise<object>} 影像響應項
 */
const buildOpenAIImageResultItem = async (contentUrl, responseFormat) => {
    if (responseFormat === 'b64_json') {
        return {
            b64_json: await downloadAssetAsBase64(contentUrl)
        }
    }

    return {
        url: contentUrl
    }
}

/**
 * 從請求物件中提取內聯媒體連結
 * @param {*} value - 原始媒體值
 * @param {string} mediaType - 媒體型別
 * @returns {string|null} 媒體連結
 */
const extractInlineMediaURL = (value, mediaType) => {
    const parsedValue = parseMaybeJSON(value)

    if (typeof parsedValue === 'string') {
        return parsedValue
    }

    if (!parsedValue || typeof parsedValue !== 'object') {
        return null
    }

    if (mediaType === 'video') {
        return parsedValue.url || parsedValue.video || parsedValue.video_url?.url || parsedValue.input_video?.url || parsedValue.input_video?.video_url || null
    }

    return parsedValue.url || parsedValue.image || parsedValue.image_url?.url || null
}

/**
 * 構造內部媒體內容項
 * @param {string} mediaType - 媒體型別
 * @param {string} mediaURL - 媒體連結
 * @returns {object} 內部媒體內容項
 */
const buildInternalMediaItem = (mediaType, mediaURL) => {
    if (mediaType === 'video') {
        return {
            type: 'video',
            video: mediaURL
        }
    }

    return {
        type: 'image',
        image: mediaURL
    }
}

/**
 * 上傳 multipart 檔案並構造內部媒體內容項
 * @param {object} file - multer 檔案物件
 * @param {string} mediaType - 媒體型別
 * @returns {Promise<object>} 內部媒體內容項
 */
const uploadMultipartMediaFile = async (file, mediaType) => {
    if (!file?.buffer) {
        throw new Error('上傳檔案內容為空')
    }

    const fallbackExtension = mediaType === 'video' ? 'mp4' : 'png'
    const originalFilename = file.originalname || `upload.${fallbackExtension}`
    const uploadAccount = accountManager.getAccount()
    const uploadResult = await uploadFileToQwenOss(file.buffer, originalFilename, uploadAccount ? uploadAccount.token : null, uploadAccount)

    if (!uploadResult || uploadResult.status !== 200) {
        throw new Error('檔案上傳失敗')
    }

    return buildInternalMediaItem(mediaType, uploadResult.file_url)
}

/**
 * 將內聯媒體引數轉換為內部媒體內容項
 * @param {*} value - 原始媒體值
 * @param {string} mediaType - 媒體型別
 * @returns {Promise<object|null>} 內部媒體內容項
 */
const normalizeInlineMediaItem = async (value, mediaType) => {
    const mediaURL = extractInlineMediaURL(value, mediaType)
    if (!mediaURL) {
        return null
    }

    if (HTTP_URL_REGEX.test(mediaURL)) {
        return buildInternalMediaItem(mediaType, mediaURL)
    }

    const matchedDataURI = mediaURL.match(DATA_URI_REGEX)
    if (!matchedDataURI) {
        return buildInternalMediaItem(mediaType, mediaURL)
    }

    const mimeType = matchedDataURI[1]
    const base64Content = matchedDataURI[2]
    const fileExtension = mimeType?.split('/')[1] || (mediaType === 'video' ? 'mp4' : 'png')
    const uploadAccount = accountManager.getAccount()
    const uploadResult = await uploadFileToQwenOss(Buffer.from(base64Content, 'base64'), `upload.${fileExtension}`, uploadAccount ? uploadAccount.token : null, uploadAccount)

    if (!uploadResult || uploadResult.status !== 200) {
        throw new Error('檔案上傳失敗')
    }

    return buildInternalMediaItem(mediaType, uploadResult.file_url)
}

/**
 * 收集請求中的媒體內容項
 * @param {object} req - Express 請求物件
 * @param {string} fieldName - 欄位名
 * @param {string} mediaType - 媒體型別
 * @returns {Promise<Array<object>>} 媒體內容項列表
 */
const collectRequestMediaItems = async (req, fieldName, mediaType) => {
    const mediaItems = []
    const matchedFiles = (req.files || []).filter(file => file.fieldname === fieldName)

    for (const file of matchedFiles) {
        mediaItems.push(await uploadMultipartMediaFile(file, mediaType))
    }

    for (const value of ensureArray(req.body?.[fieldName])) {
        const normalizedMediaItem = await normalizeInlineMediaItem(value, mediaType)
        if (normalizedMediaItem) {
            mediaItems.push(normalizedMediaItem)
        }
    }

    return mediaItems
}

/**
 * 解析請求模型，未顯式傳入時按能力選擇預設模型
 * @param {string} model - 請求模型
 * @param {string} chatType - 聊天型別
 * @returns {Promise<string>} 可直接傳送到上游的模型 ID
 */
const resolveRequestedModel = async (model, chatType) => {
    if (model) {
        return parserModel(model)
    }

    const defaultModel = await getDefaultModelByChatType(chatType)
    return defaultModel || parserModel(model)
}

/**
 * 讀取影片上游流並提取任務資訊
 * @param {*} responseStream - 上游響應流
 * @returns {Promise<{ upstreamError: object|null, contentUrl: string|null, videoTaskID: string|null, videoTaskCandidates: string[], responseIDs: string[], rawPreview: string }>} 解析結果
 */
const readVideoUpstreamResult = async (responseStream) => {
    if (!responseStream || typeof responseStream.on !== 'function') {
        const videoTaskCandidates = extractVideoTaskIdentifiersFromPayload(responseStream)
        const responseIDs = extractResponseIDsFromPayload(responseStream)
        return {
            upstreamError: parseUpstreamImageError(responseStream),
            contentUrl: extractResourceUrlFromPayload(responseStream),
            videoTaskID: videoTaskCandidates[0] || null,
            videoTaskCandidates,
            responseIDs,
            rawPreview: typeof responseStream === 'string' ? responseStream.slice(0, 400) : ''
        }
    }

    const decoder = new TextDecoder('utf-8')
    let rawText = ''
    let buffer = ''
    let upstreamError = null
    let contentUrl = null
    const videoTaskCandidates = []
    const responseIDs = []
    const pushVideoTaskCandidate = (taskID) => {
        if (taskID && !videoTaskCandidates.includes(taskID)) {
            videoTaskCandidates.push(taskID)
        }
    }
    const pushResponseID = (responseID) => {
        if (responseID && !responseIDs.includes(responseID)) {
            responseIDs.push(responseID)
        }
    }

    const applyPayload = (payload) => {
        if (!upstreamError) {
            upstreamError = parseUpstreamImageError(payload)
        }

        if (!contentUrl) {
            contentUrl = extractResourceUrlFromPayload(payload)
        }

        for (const taskID of extractVideoTaskIdentifiersFromPayload(payload)) {
            pushVideoTaskCandidate(taskID)
        }

        for (const responseID of extractResponseIDsFromPayload(payload)) {
            pushResponseID(responseID)
        }
    }

    await new Promise((resolve, reject) => {
        responseStream.on('data', (chunk) => {
            const decoded = decoder.decode(chunk, { stream: true })
            rawText += decoded
            buffer += decoded

            const parsedResult = parseSsePayloads(buffer)
            buffer = parsedResult.buffer

            for (const payload of parsedResult.payloads) {
                applyPayload(payload)
            }
        })

        responseStream.on('end', resolve)
        responseStream.on('error', reject)
    })

    const flushedResult = parseSsePayloads(buffer, true)
    for (const payload of flushedResult.payloads) {
        applyPayload(payload)
    }

    const trimmedRawText = rawText.trim()
    if (!upstreamError) {
        upstreamError = parseUpstreamImageErrorFromText(trimmedRawText) || parseUpstreamImageError(trimmedRawText)
    }

    if (!contentUrl) {
        contentUrl = extractResourceUrlFromPayload(trimmedRawText)
    }

    for (const taskID of extractVideoTaskIdentifiersFromPayload(trimmedRawText)) {
        pushVideoTaskCandidate(taskID)
    }

    return {
        upstreamError,
        contentUrl,
        videoTaskID: videoTaskCandidates[0] || null,
        videoTaskCandidates,
        responseIDs,
        rawPreview: trimmedRawText.slice(0, 400)
    }
}

/**
 * 讀取圖片上游流並提取響應資訊
 * @param {*} responseStream - 上游響應流
 * @returns {Promise<{ upstreamError: object|null, contentUrl: string|null, responseIDs: string[], rawPreview: string }>} 解析結果
 */
const readImageUpstreamResult = async (responseStream) => {
    if (!responseStream || typeof responseStream.on !== 'function') {
        return {
            upstreamError: parseUpstreamImageError(responseStream),
            contentUrl: extractResourceUrlFromPayload(responseStream),
            responseIDs: extractResponseIDsFromPayload(responseStream),
            rawPreview: typeof responseStream === 'string' ? responseStream.slice(0, 400) : ''
        }
    }

    const decoder = new TextDecoder('utf-8')
    let rawText = ''
    let buffer = ''
    let upstreamError = null
    let contentUrl = null
    const responseIDs = []
    const pushResponseID = (responseID) => {
        if (responseID && !responseIDs.includes(responseID)) {
            responseIDs.push(responseID)
        }
    }

    const applyPayload = (payload) => {
        if (!upstreamError) {
            upstreamError = parseUpstreamImageError(payload)
        }

        if (!contentUrl) {
            contentUrl = extractResourceUrlFromPayload(payload)
        }

        for (const responseID of extractResponseIDsFromPayload(payload)) {
            pushResponseID(responseID)
        }
    }

    await new Promise((resolve, reject) => {
        responseStream.on('data', (chunk) => {
            const decoded = decoder.decode(chunk, { stream: true })
            rawText += decoded
            buffer += decoded

            const parsedResult = parseSsePayloads(buffer)
            buffer = parsedResult.buffer

            for (const payload of parsedResult.payloads) {
                applyPayload(payload)
            }
        })

        responseStream.on('end', resolve)
        responseStream.on('error', reject)
    })

    const flushedResult = parseSsePayloads(buffer, true)
    for (const payload of flushedResult.payloads) {
        applyPayload(payload)
    }

    const trimmedRawText = rawText.trim()
    if (!upstreamError) {
        upstreamError = parseUpstreamImageErrorFromText(trimmedRawText) || parseUpstreamImageError(trimmedRawText)
    }

    if (!contentUrl) {
        contentUrl = extractResourceUrlFromPayload(trimmedRawText)
    }

    for (const responseID of extractResponseIDsFromPayload(trimmedRawText)) {
        pushResponseID(responseID)
    }

    return {
        upstreamError,
        contentUrl,
        responseIDs,
        rawPreview: trimmedRawText.slice(0, 400)
    }
}

/**
 * 拉取聊天詳情
 * @param {string} chatID - 對話 ID
 * @param {string} token - 訪問令牌
 * @returns {Promise<object|null>} 聊天詳情
 */
const getChatDetail = async (chatID, token) => {
    try {
        const chatBaseUrl = getChatBaseUrl()
        // 通過 token 反查 account 解析帳號級代理（找不到則回退到全域性 PROXY_URL）
        const account = accountManager.getAccountByToken(token)
        const proxyAgent = getProxyAgent(account)
        const cookieHeader = buildUpstreamCookieHeader(token)

        const requestConfig = {
            headers: {
                "Authorization": `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...(cookieHeader && { 'Cookie': cookieHeader })
            }
        }

        if (proxyAgent) {
            requestConfig.httpsAgent = proxyAgent
            requestConfig.proxy = false
        }

        const responseData = await axios.get(`${chatBaseUrl}/api/v2/chats/${chatID}`, requestConfig)
        return responseData.data || null
    } catch (error) {
        logger.error(`獲取聊天詳情失敗 (${chatID})`, 'CHAT', '', buildAxiosErrorLog(error))
        return null
    }
}

/**
 * 從聊天詳情中提取資源與任務資訊
 * @param {*} chatDetail - 聊天詳情
 * @param {string[]} responseIDs - 響應 ID 列表
 * @returns {{ contentUrl: string|null, videoTaskCandidates: string[] }} 提取結果
 */
const extractVideoInfoFromChatDetail = (chatDetail, responseIDs = []) => {
    const responseIDSet = new Set(responseIDs.filter(Boolean))
    const allMessages = []

    const messageMap = chatDetail?.data?.chat?.history?.messages
    if (messageMap && typeof messageMap === 'object') {
        allMessages.push(...Object.values(messageMap))
    }

    const messages = chatDetail?.data?.chat?.messages
    if (Array.isArray(messages)) {
        allMessages.push(...messages)
    }

    const pushUnique = (list, value) => {
        if (value && !list.includes(value)) {
            list.push(value)
        }
    }

    let contentUrl = null
    const videoTaskCandidates = []

    const candidateMessages = allMessages.filter(message => {
        if (!message || typeof message !== 'object') {
            return false
        }

        const responseID = message.response_id || message.responseId || message.id
        if (responseIDSet.size === 0) {
            return true
        }

        return responseID && responseIDSet.has(String(responseID))
    })

    for (const message of candidateMessages) {
        if (!contentUrl) {
            contentUrl = extractResourceUrlFromPayload(message)
        }

        for (const taskID of extractVideoTaskIdentifiersFromPayload(message)) {
            pushUnique(videoTaskCandidates, taskID)
        }
    }

    return {
        contentUrl,
        videoTaskCandidates
    }
}

/**
 * 解析圖片生成結果連結
 * @param {*} responseData - 上游響應
 * @param {string} chatID - 會話 ID
 * @param {string} token - 當前帳號令牌
 * @returns {Promise<string>} 圖片連結
 */
const resolveImageResultContentUrl = async (responseData, chatID, token) => {
    const { upstreamError, contentUrl: upstreamContentUrl, responseIDs, rawPreview } = await readImageUpstreamResult(responseData)
    if (upstreamError) {
        throw upstreamError
    }

    let contentUrl = upstreamContentUrl

    if (!contentUrl && chatID) {
        logger.info(`圖片上游未直接返回連結，嘗試從聊天詳情補取，chat_id=${chatID} responseIDs=${JSON.stringify(responseIDs)}`, 'CHAT')

        for (let attempt = 1; attempt <= 5; attempt++) {
            const chatDetail = await getChatDetail(chatID, token)
            const extractedInfo = extractVideoInfoFromChatDetail(chatDetail, responseIDs)
            if (extractedInfo.contentUrl) {
                contentUrl = extractedInfo.contentUrl
                break
            }

            await sleep(800)
        }
    }

    if (!contentUrl) {
        logger.warn(`圖片上游響應未解析出圖片連結，responseIDs=${JSON.stringify(responseIDs)} preview=${rawPreview}`, 'CHAT')
        throw new Error('上游未返回圖片連結')
    }

    return contentUrl
}

/**
 * 解析影片生成結果連結
 * @param {*} responseStream - 上游響應流
 * @param {string} token - 當前帳號令牌
 * @param {string} chatID - 會話 ID
 * @returns {Promise<string>} 影片連結
 */
const resolveVideoResultContentUrl = async (responseStream, token, chatID) => {
    const { upstreamError, contentUrl: upstreamContentUrl, videoTaskCandidates, responseIDs, rawPreview } = await readVideoUpstreamResult(responseStream)
    if (upstreamError) {
        throw upstreamError
    }

    if (upstreamContentUrl) {
        return upstreamContentUrl
    }

    let resolvedContentUrl = upstreamContentUrl
    let resolvedTaskCandidates = [...videoTaskCandidates]

    if (!resolvedContentUrl && resolvedTaskCandidates.length === 0 && chatID) {
        logger.info(`影片上游未直接返回任務資訊，嘗試從聊天詳情補取，chat_id=${chatID} responseIDs=${JSON.stringify(responseIDs)}`, 'CHAT')

        for (let attempt = 1; attempt <= 5; attempt++) {
            const chatDetail = await getChatDetail(chatID, token)
            const extractedInfo = extractVideoInfoFromChatDetail(chatDetail, responseIDs)

            if (!resolvedContentUrl && extractedInfo.contentUrl) {
                resolvedContentUrl = extractedInfo.contentUrl
            }

            for (const taskID of extractedInfo.videoTaskCandidates) {
                if (!resolvedTaskCandidates.includes(taskID)) {
                    resolvedTaskCandidates.push(taskID)
                }
            }

            if (resolvedContentUrl || resolvedTaskCandidates.length > 0) {
                break
            }

            await sleep(1200)
        }
    }

    if (resolvedContentUrl) {
        return resolvedContentUrl
    }

    if (resolvedTaskCandidates.length === 0) {
        logger.warn(`影片上游響應未解析出任務資訊，contentUrl=${resolvedContentUrl || '空'} candidates=${JSON.stringify(resolvedTaskCandidates)} responseIDs=${JSON.stringify(responseIDs)} preview=${rawPreview}`, 'CHAT')
        throw new Error('上游未返回影片任務 ID 或影片連結')
    }

    logger.info(`影片任務候選ID: ${JSON.stringify(resolvedTaskCandidates)}`, 'CHAT')

    const maxAttempts = 60
    const delay = 20 * 1000

    for (const taskCandidate of resolvedTaskCandidates) {
        logger.info(`開始輪詢影片任務ID: ${taskCandidate}`, 'CHAT')

        for (let i = 0; i < maxAttempts; i++) {
            const content = await getVideoTaskStatus(taskCandidate, token)
            if (content) {
                return content
            }

            await sleep(delay)
        }
    }

    logger.error(`影片任務 ${JSON.stringify(resolvedTaskCandidates)} 輪詢超時`, 'CHAT')
    throw {
        status: 504,
        error: '影片生成超時，請稍後再試'
    }
}

/**
 * 統一執行圖片/影片請求
 * @param {object} payload - 內部請求體
 * @returns {Promise<{ model: string, chatType: string, contentUrl: string, content: string }>} 執行結果
 */
const generateImageVideoResult = async (payload) => {
    const { model, messages, size, chat_type } = payload
    // 一次取出帳戶物件，確保 token 與 proxy 走同一個帳號
    const account = accountManager.getAccount()
    const token = account ? account.token : null

    try {
        const reqBody = {
            "stream": false,
            "version": "2.1",
            "incremental_output": true,
            "chat_id": null,
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": "",
                    "files": [],
                    "chat_type": chat_type,
                    "feature_config": {
                        "output_schema": "phase"
                    }
                }
            ]
        }

        const chatID = await generateChatID(token, model)

        if (!chatID) {
            throw new Error('生成 chat_id 失敗')
        }

        reqBody.chat_id = chatID

        const userPrompt = messages?.[messages.length - 1]?.content
        if (!userPrompt) {
            throw {
                status: 400,
                error: '缺少有效的提示詞'
            }
        }

        const messagesHistory = messages.filter(item => item.role === 'user' || item.role === 'assistant')
        const selectedImageList = []

        if (chat_type === 'image_edit') {
            for (const item of messagesHistory) {
                if (item.role === 'assistant') {
                    const matches = [...String(item.content || '').matchAll(/!\[image\]\((.*?)\)/g)]
                    for (const match of matches) {
                        selectedImageList.push(match[1])
                    }
                } else if (Array.isArray(item.content) && item.content.length > 0) {
                    for (const content of item.content) {
                        if (content.type === 'image') {
                            selectedImageList.push(content.image)
                        }
                    }
                }
            }
        }

        if (chat_type === 't2i' || chat_type === 't2v') {
            if (Array.isArray(userPrompt)) {
                reqBody.messages[0].content = userPrompt.map(item => item.type === 'text' ? item.text : '').join('\n\n')
            } else {
                reqBody.messages[0].content = userPrompt
            }
        } else if (chat_type === 'image_edit') {
            if (!Array.isArray(userPrompt)) {
                if (messagesHistory.length === 1) {
                    reqBody.messages[0].chat_type = 't2i'
                } else if (selectedImageList.length >= 1) {
                    reqBody.messages[0].files.push({
                        "type": "image",
                        "url": selectedImageList[selectedImageList.length - 1]
                    })
                }
                reqBody.messages[0].content += userPrompt
            } else {
                const texts = userPrompt.filter(item => item.type === 'text')
                if (texts.length === 0) {
                    throw {
                        status: 400,
                        error: '圖片編輯請求缺少文本提示詞'
                    }
                }

                for (const item of texts) {
                    reqBody.messages[0].content += item.text
                }

                const files = userPrompt.filter(item => item.type === 'image')
                if (files.length === 0) {
                    reqBody.messages[0].chat_type = 't2i'
                }

                for (const item of files) {
                    reqBody.messages[0].files.push({
                        "type": "image",
                        "url": item.image
                    })
                }
            }
        }

        if (chat_type === 't2i' || chat_type === 't2v') {
            if (size !== undefined && size !== null) {
                reqBody.size = size
            } else if (typeof userPrompt === 'string' && userPrompt.indexOf('@4:3') !== -1) {
                reqBody.size = '4:3'
            } else if (typeof userPrompt === 'string' && userPrompt.indexOf('@3:4') !== -1) {
                reqBody.size = '3:4'
            } else if (typeof userPrompt === 'string' && userPrompt.indexOf('@16:9') !== -1) {
                reqBody.size = '16:9'
            } else if (typeof userPrompt === 'string' && userPrompt.indexOf('@9:16') !== -1) {
                reqBody.size = '9:16'
            }
        }

        const chatBaseUrl = getChatBaseUrl()
        const proxyAgent = getProxyAgent(account)
        const cookieHeader = buildUpstreamCookieHeader(token)

        logger.info('傳送圖片影片請求', 'CHAT')
        logger.info(`選擇圖片: ${selectedImageList[selectedImageList.length - 1] || '未選擇圖片，切換生成圖/影片模式'}`, 'CHAT')
        logger.info(`使用提示: ${reqBody.messages[0].content}`, 'CHAT')

        const newChatType = reqBody.messages[0].chat_type
        const upstreamStream = newChatType === 't2i' || newChatType === 'image_edit'
        reqBody.stream = upstreamStream

        logger.info(`圖片影片流策略: upstream=${upstreamStream} downstream=${payload.stream === true}`, 'CHAT')

        const requestConfig = {
            headers: {
                'Authorization': `Bearer ${token}`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
                "Connection": "keep-alive",
                "Accept": upstreamStream ? "text/event-stream" : "application/json",
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
                ...(cookieHeader && { "Cookie": cookieHeader }),
            },
            responseType: newChatType === 't2v' ? 'json' : (upstreamStream ? 'stream' : 'text'),
            timeout: 1000 * 60 * 5
        }

        if (proxyAgent) {
            requestConfig.httpsAgent = proxyAgent
            requestConfig.proxy = false
        }

        let responseData = null
        const maxUpstreamAttempts = 2

        for (let attempt = 1; attempt <= maxUpstreamAttempts; attempt++) {
            try {
                responseData = await axios.post(`${chatBaseUrl}/api/v2/chat/completions?chat_id=${chatID}`, reqBody, requestConfig)

                const inlineUpstreamError = parseUpstreamImageError(responseData.data)
                if (attempt < maxUpstreamAttempts && isRetryableUpstreamError(inlineUpstreamError)) {
                    logger.warn(`圖片/影片請求上游返回業務錯誤包，準備第 ${attempt + 1} 次重試，請求ID: ${inlineUpstreamError.request_id || '未知'}`, 'CHAT')
                    await sleep(800)
                    continue
                }

                break
            } catch (error) {
                logger.error('圖片/影片請求失敗', 'CHAT', '', buildAxiosErrorLog(error))
                const upstreamError = parseUpstreamImageError(error.response?.data)
                if (attempt < maxUpstreamAttempts && isRetryableUpstreamError(upstreamError)) {
                    logger.warn(`圖片/影片請求上游返回瞬時內部錯誤，準備第 ${attempt + 1} 次重試`, 'CHAT')
                    await sleep(800)
                    continue
                }

                throw error
            }
        }

        if (newChatType === 't2i' || newChatType === 'image_edit') {
            const contentUrl = await resolveImageResultContentUrl(responseData.data, chatID, token)
            return {
                model,
                chatType: newChatType,
                contentUrl,
                content: buildImageContent(contentUrl)
            }
        }

        if (newChatType === 't2v') {
            const contentUrl = await resolveVideoResultContentUrl(responseData.data, token, chatID)
            return {
                model,
                chatType: newChatType,
                contentUrl,
                content: buildVideoContent(contentUrl)
            }
        }

        throw new Error('不支援的圖片/影片型別')
    } catch (error) {
        logger.error('圖片/影片主流程異常', 'CHAT', '', buildAxiosErrorLog(error))

        if (error?.error) {
            throw error
        }

        const upstreamError = parseUpstreamImageError(error.response?.data)
        if (upstreamError) {
            throw upstreamError
        }

        throw {
            status: 500,
            error: error?.message || '服務錯誤，請稍後再試'
        }
    }
}

/**
 * 主要的聊天完成處理函式
 * @param {object} req - Express 請求物件
 * @param {object} res - Express 響應物件
 */
const handleImageVideoCompletion = async (req, res) => {
    const downstreamStream = req.body.stream === true
    let keepAliveTimer = null

    try {
        if (downstreamStream && req.body.chat_type === 't2v') {
            setResponseHeaders(res, true)
            keepAliveTimer = setInterval(() => {
                if (!res.writableEnded) {
                    res.write(`: keep-alive\n\n`)
                }
            }, 15000)
        }

        const result = await generateImageVideoResult(req.body)

        if (keepAliveTimer) {
            clearInterval(keepAliveTimer)
        }

        return returnResponse(res, result.model, result.content, downstreamStream)
    } catch (error) {
        if (keepAliveTimer) {
            clearInterval(keepAliveTimer)
        }

        logger.error('圖片影片資源處理錯誤', 'CHAT', '', error)

        if (downstreamStream) {
            return returnResponse(res, req.body.model, error?.error || error?.message || '服務錯誤，請稍後再試', true)
        }

        return sendUpstreamError(res, error?.error ? error : {
            status: 500,
            error: error?.message || '服務錯誤，請稍後再試'
        })
    }
}

/**
 * 返回響應
 * @param {*} res
 * @param {string} model
 * @param {string} content
 * @param {boolean} stream
 */
const returnResponse = (res, model, content, stream) => {
    if (!res.headersSent) {
        setResponseHeaders(res, stream)
    }

    logger.info(`返回響應: ${content}`, 'CHAT')

    if (stream) {
        const responseID = `chatcmpl-${new Date().getTime()}`
        const streamBody = {
            "id": responseID,
            "object": "chat.completion.chunk",
            "created": new Date().getTime(),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "content": content
                    },
                    "finish_reason": null
                }
            ]
        }

        const finishBody = {
            "id": responseID,
            "object": "chat.completion.chunk",
            "created": new Date().getTime(),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop"
                }
            ]
        }

        res.write(`data: ${JSON.stringify(streamBody)}\n\n`)
        res.write(`data: ${JSON.stringify(finishBody)}\n\n`)
        res.write(`data: [DONE]\n\n`)
        res.end()
    } else {
        res.json({
            "id": `chatcmpl-${new Date().getTime()}`,
            "object": "chat.completion",
            "created": new Date().getTime(),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": content
                    },
                    "finish_reason": "stop"
                }
            ]
        })
    }
}

/**
 * 處理 OpenAI 風格的圖片生成端點
 * @param {object} req - Express 請求物件
 * @param {object} res - Express 響應物件
 * @returns {Promise<void>}
 */
const handleOpenAIImagesGeneration = async (req, res) => {
    try {
        if (!req.body?.prompt) {
            return sendOpenAIErrorResponse(res, {
                status: 400,
                error: 'prompt 是必填引數'
            })
        }

        const model = await resolveRequestedModel(req.body.model, 't2i')
        const result = await generateImageVideoResult({
            model,
            messages: [
                {
                    role: 'user',
                    content: req.body.prompt
                }
            ],
            size: normalizeOpenAIImageVideoSize(req.body.size),
            chat_type: 't2i',
            stream: false
        })

        const imageData = await buildOpenAIImageResultItem(result.contentUrl, req.body.response_format)

        res.json({
            created: Math.floor(Date.now() / 1000),
            data: [imageData]
        })
    } catch (error) {
        logger.error('OpenAI 圖片生成端點處理失敗', 'CHAT', '', error)
        return sendOpenAIErrorResponse(res, error)
    }
}

/**
 * 處理 OpenAI 風格的圖片編輯端點
 * @param {object} req - Express 請求物件
 * @param {object} res - Express 響應物件
 * @returns {Promise<void>}
 */
const handleOpenAIImagesEdit = async (req, res) => {
    try {
        const imageItems = await collectRequestMediaItems(req, 'image', 'image')
        if (imageItems.length === 0) {
            return sendOpenAIErrorResponse(res, {
                status: 400,
                error: 'image 是必填引數'
            })
        }

        const model = await resolveRequestedModel(req.body.model, 'image_edit')
        const prompt = req.body.prompt || '請基於上傳圖片完成編輯'
        const result = await generateImageVideoResult({
            model,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: prompt
                        },
                        ...imageItems
                    ]
                }
            ],
            size: normalizeOpenAIImageVideoSize(req.body.size),
            chat_type: 'image_edit',
            stream: false
        })

        const imageData = await buildOpenAIImageResultItem(result.contentUrl, req.body.response_format)

        res.json({
            created: Math.floor(Date.now() / 1000),
            data: [imageData]
        })
    } catch (error) {
        logger.error('OpenAI 圖片編輯端點處理失敗', 'CHAT', '', error)
        return sendOpenAIErrorResponse(res, error)
    }
}

/**
 * 處理 OpenAI 風格的影片生成端點
 * @param {object} req - Express 請求物件
 * @param {object} res - Express 響應物件
 * @returns {Promise<void>}
 */
const handleOpenAIVideoGeneration = async (req, res) => {
    try {
        if (!req.body?.prompt) {
            return sendOpenAIErrorResponse(res, {
                status: 400,
                error: 'prompt 是必填引數'
            })
        }

        const model = await resolveRequestedModel(req.body.model, 't2v')
        const result = await generateImageVideoResult({
            model,
            messages: [
                {
                    role: 'user',
                    content: req.body.prompt
                }
            ],
            size: normalizeOpenAIImageVideoSize(req.body.size),
            chat_type: 't2v',
            stream: false
        })

        res.json({
            id: `video_${new Date().getTime()}`,
            object: 'video',
            created: Math.floor(Date.now() / 1000),
            model,
            status: 'completed',
            data: [
                {
                    url: result.contentUrl
                }
            ]
        })
    } catch (error) {
        logger.error('OpenAI 影片生成端點處理失敗', 'CHAT', '', error)
        return sendOpenAIErrorResponse(res, error)
    }
}

const handleVideoCompletion = async (res, responseStream, token, model, downstreamStream, chatID) => {
    let keepAliveTimer = null

    try {
        if (downstreamStream) {
            setResponseHeaders(res, true)
            keepAliveTimer = setInterval(() => {
                if (!res.writableEnded) {
                    res.write(`: keep-alive\n\n`)
                }
            }, 15000)
        }

        const { upstreamError, contentUrl: upstreamContentUrl, videoTaskID, videoTaskCandidates, responseIDs, rawPreview } = await readVideoUpstreamResult(responseStream)
        if (upstreamError) {
            if (keepAliveTimer) {
                clearInterval(keepAliveTimer)
            }

            if (downstreamStream) {
                res.status(upstreamError.status || 500)
                return returnResponse(res, model, upstreamError.error || '影片生成失敗', true)
            }

            return sendUpstreamError(res, upstreamError)
        }

        if (upstreamContentUrl) {
            if (keepAliveTimer) {
                clearInterval(keepAliveTimer)
            }

            return returnResponse(res, model, buildVideoContent(upstreamContentUrl), downstreamStream)
        }

        let resolvedContentUrl = upstreamContentUrl
        let resolvedTaskCandidates = [...videoTaskCandidates]

        if (!resolvedContentUrl && resolvedTaskCandidates.length === 0 && chatID) {
            logger.info(`影片上游未直接返回任務資訊，嘗試從聊天詳情補取，chat_id=${chatID} responseIDs=${JSON.stringify(responseIDs)}`, 'CHAT')

            for (let attempt = 1; attempt <= 5; attempt++) {
                const chatDetail = await getChatDetail(chatID, token)
                const extractedInfo = extractVideoInfoFromChatDetail(chatDetail, responseIDs)

                if (!resolvedContentUrl && extractedInfo.contentUrl) {
                    resolvedContentUrl = extractedInfo.contentUrl
                }

                for (const taskID of extractedInfo.videoTaskCandidates) {
                    if (!resolvedTaskCandidates.includes(taskID)) {
                        resolvedTaskCandidates.push(taskID)
                    }
                }

                if (resolvedContentUrl || resolvedTaskCandidates.length > 0) {
                    break
                }

                await sleep(1200)
            }
        }

        if (resolvedContentUrl) {
            if (keepAliveTimer) {
                clearInterval(keepAliveTimer)
            }

            return returnResponse(res, model, buildVideoContent(resolvedContentUrl), downstreamStream)
        }

        if (resolvedTaskCandidates.length === 0) {
            logger.warn(`影片上游響應未解析出任務資訊，contentUrl=${resolvedContentUrl || '空'} candidates=${JSON.stringify(resolvedTaskCandidates)} responseIDs=${JSON.stringify(responseIDs)} preview=${rawPreview}`, 'CHAT')
            throw new Error('上游未返回影片任務 ID 或影片連結')
        }

        logger.info(`影片任務候選ID: ${JSON.stringify(resolvedTaskCandidates)}`, 'CHAT')

        const maxAttempts = 60
        const delay = 20 * 1000

        for (const taskCandidate of resolvedTaskCandidates) {
            logger.info(`開始輪詢影片任務ID: ${taskCandidate}`, 'CHAT')

            for (let i = 0; i < maxAttempts; i++) {
                const content = await getVideoTaskStatus(taskCandidate, token)
                if (content) {
                    if (keepAliveTimer) {
                        clearInterval(keepAliveTimer)
                    }

                    return returnResponse(res, model, buildVideoContent(content), downstreamStream)
                }

                await sleep(delay)
            }
        }

        logger.error(`影片任務 ${JSON.stringify(resolvedTaskCandidates)} 輪詢超時`, 'CHAT')
        if (keepAliveTimer) {
            clearInterval(keepAliveTimer)
        }

        if (downstreamStream) {
            return returnResponse(res, model, '影片生成超時，請稍後再試', true)
        }

        return res.status(504).json({ error: '影片生成超時，請稍後再試' })
    } catch (error) {
        if (keepAliveTimer) {
            clearInterval(keepAliveTimer)
        }

        logger.error('獲取影片任務狀態失敗', 'CHAT', '', error)

        const errorMessage = error.response?.data?.data?.code || error.message || '可能該帳號今日生成次數已用完'

        if (downstreamStream) {
            return returnResponse(res, model, `影片生成失敗: ${errorMessage}`, true)
        }

        res.status(500).json({ error: errorMessage })
    }
}

const getVideoTaskStatus = async (videoTaskID, token) => {
    try {
        const chatBaseUrl = getChatBaseUrl()
        const account = accountManager.getAccountByToken(token)
        const proxyAgent = getProxyAgent(account)
        const cookieHeader = buildUpstreamCookieHeader(token)

        const requestConfig = {
            headers: {
                "Authorization": `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...(cookieHeader && { 'Cookie': cookieHeader })
            }
        }

        // 新增代理配置
        if (proxyAgent) {
            requestConfig.httpsAgent = proxyAgent
            requestConfig.proxy = false
        }

        const response_data = await axios.get(`${chatBaseUrl}/api/v1/tasks/status/${videoTaskID}`, requestConfig)

        if (response_data.data?.task_status == "success") {
            const contentUrl = extractResourceUrlFromPayload(response_data.data)
            logger.info('獲取影片任務狀態成功', 'CHAT', contentUrl || response_data.data?.content)
            return contentUrl
        }
        logger.info(`獲取影片任務 ${videoTaskID} 狀態: ${response_data.data?.task_status}`, 'CHAT')
        return null
    } catch (error) {
        logger.error(`查詢影片任務狀態失敗 (${videoTaskID})`, 'CHAT', '', buildAxiosErrorLog(error))
        return null
    }
}

module.exports = {
    handleImageVideoCompletion,
    handleOpenAIImagesGeneration,
    handleOpenAIImagesEdit,
    handleOpenAIVideoGeneration
}
