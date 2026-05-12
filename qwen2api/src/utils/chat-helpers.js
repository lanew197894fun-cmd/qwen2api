const { logger } = require('./logger')
const { sha256Encrypt, generateUUID } = require('./tools.js')
const { uploadFileToQwenOss } = require('./upload.js')
const { getLatestModels } = require('../models/models-map.js')
const accountManager = require('./account.js')
const CacheManager = require('./img-caches.js')

const MODEL_SUFFIXES = [
    '-thinking-search',
    '-image-edit',
    '-deep-research',
    '-thinking',
    '-search',
    '-video',
    '-image'
]

const DATA_URI_REGEX = /^data:(.+);base64,(.*)$/i
const HTTP_URL_REGEX = /^https?:\/\//i

/**
 * 拆分模型字尾
 * @param {string} model - 原始模型名稱
 * @returns {{ baseModel: string, suffix: string }} 拆分結果
 */
const splitModelSuffix = (model) => {
    const modelName = String(model || '')

    for (const suffix of MODEL_SUFFIXES) {
        if (modelName.endsWith(suffix)) {
            return {
                baseModel: modelName.slice(0, -suffix.length),
                suffix
            }
        }
    }

    return {
        baseModel: modelName,
        suffix: ''
    }
}

/**
 * 根據模型別名匹配原始模型
 * @param {Array<object>} models - 原始模型列表
 * @param {string} modelName - 輸入模型名稱
 * @returns {object|undefined} 命中的模型
 */
const findMatchedModel = (models, modelName) => {
    const normalizedModelName = String(modelName || '').trim().toLowerCase()
    if (!normalizedModelName) {
        return undefined
    }

    return models.find(model => {
        const aliases = [
            model?.id,
            model?.name,
            model?.display_name,
            model?.upstream_id
        ]

        return aliases
            .filter(Boolean)
            .some(alias => String(alias).trim().toLowerCase() === normalizedModelName)
    })
}

/**
 * 判斷是否為媒體內容項
 * @param {object} item - 內容項
 * @returns {boolean} 是否為媒體內容項
 */
const isMediaContentItem = (item) => ['image', 'image_url', 'video', 'video_url', 'input_video'].includes(item?.type)

/**
 * 提取媒體資訊
 * @param {object} item - 內容項
 * @returns {{ mediaType: string, url: string|null }|null} 媒體資訊
 */
const getMediaDescriptor = (item) => {
    if (!item) {
        return null
    }

    if (item.type === 'image' || item.type === 'image_url') {
        return {
            mediaType: 'image',
            url: item.image || item.url || item.image_url?.url || null
        }
    }

    if (item.type === 'video' || item.type === 'video_url') {
        return {
            mediaType: 'video',
            url: item.video || item.url || item.video_url?.url || null
        }
    }

    if (item.type === 'input_video') {
        return {
            mediaType: 'video',
            url: item.input_video?.url || item.input_video?.video_url || item.video_url?.url || null
        }
    }

    return null
}

/**
 * 構造規範化媒體內容項
 * @param {string} mediaType - 媒體型別
 * @param {string} url - 媒體連結
 * @returns {object} 規範化後的內容項
 */
const buildNormalizedMediaItem = (mediaType, url) => {
    if (mediaType === 'video') {
        return {
            type: 'video',
            video: url
        }
    }

    return {
        type: 'image',
        image: url
    }
}

/**
 * 解析並上傳媒體內容項
 * @param {object} item - 原始內容項
 * @param {object} imgCacheManager - 圖片快取管理器
 * @returns {Promise<object|null>} 規範化後的媒體內容項
 */
const normalizeMediaContentItem = async (item, imgCacheManager) => {
    const mediaDescriptor = getMediaDescriptor(item)
    if (!mediaDescriptor?.url) {
        return null
    }

    const { mediaType, url } = mediaDescriptor
    if (HTTP_URL_REGEX.test(url)) {
        return buildNormalizedMediaItem(mediaType, url)
    }

    const matchedDataURI = url.match(DATA_URI_REGEX)
    if (!matchedDataURI) {
        return buildNormalizedMediaItem(mediaType, url)
    }

    const mimeType = matchedDataURI[1]
    const base64Content = matchedDataURI[2]
    const fileExtension = mimeType?.split('/')[1] || (mediaType === 'video' ? 'mp4' : 'png')
    const filename = `${generateUUID()}.${fileExtension}`
    const signature = sha256Encrypt(base64Content)

    try {
        if (mediaType === 'image' && imgCacheManager.cacheIsExist(signature)) {
            return buildNormalizedMediaItem(mediaType, imgCacheManager.getCache(signature).url)
        }

        const buffer = Buffer.from(base64Content, 'base64')
        const uploadAccount = accountManager.getAccount()
        const uploadResult = await uploadFileToQwenOss(buffer, filename, uploadAccount ? uploadAccount.token : null, uploadAccount)

        if (!uploadResult || uploadResult.status !== 200) {
            return null
        }

        if (mediaType === 'image') {
            imgCacheManager.addCache(signature, uploadResult.file_url)
        }

        return buildNormalizedMediaItem(mediaType, uploadResult.file_url)
    } catch (error) {
        logger.error(`${mediaType === 'video' ? '影片' : '圖片'}上傳失敗`, 'UPLOAD', '', error)
        return null
    }
}

/**
 * 判斷聊天型別
 * @param {string} model - 模型名稱
 * @param {boolean} search - 是否搜尋模式
 * @returns {string} 聊天型別 ('search' 或 't2t')
 */
const isChatType = (model) => {
    if (!model) return 't2t'
    if (model.includes('-search')) {
        return 'search'
    } else if (model.includes('-image-edit')) {
        return 'image_edit'
    } else if (model.includes('-image')) {
        return 't2i'
    } else if (model.includes('-video')) {
        return 't2v'
    } else if (model.includes('-deep-research')) {
        return 'deep_research'
    } else {
        return 't2t'
    }
}

/**
 * 判斷是否啟用思考模式
 * @param {string} model - 模型名稱
 * @param {boolean} enable_thinking - 是否啟用思考
 * @param {number} thinking_budget - 思考預算
 * @returns {object} 思考配置物件
 */
const isThinkingEnabled = (model, enable_thinking, thinking_budget) => {
    const thinking_config = {
        "output_schema": "phase",
        "thinking_enabled": false,
        "thinking_budget": 81920
    }

    if (!model) return thinking_config

    if (model.includes('-thinking') || enable_thinking) {
        thinking_config.thinking_enabled = true
    }

    if (thinking_budget && Number(thinking_budget) !== Number.NaN && Number(thinking_budget) > 0 && Number(thinking_budget) < 38912) {
        thinking_config.budget = Number(thinking_budget)
    }

    return thinking_config
}

/**
 * 解析模型名稱,移除特殊字尾
 * @param {string} model - 原始模型名稱
 * @returns {string} 解析後的模型名稱
 */
const parserModel = async (model) => {
    if (!model) return 'qwen3-coder-plus'

    try {
        const { baseModel } = splitModelSuffix(model)
        const latestModels = await getLatestModels()
        const matchedModel = findMatchedModel(latestModels, baseModel)

        return matchedModel?.id || baseModel
    } catch (e) {
        const { baseModel } = splitModelSuffix(model)
        return baseModel || 'qwen3-coder-plus'
    }
}

/**
 * 從訊息中提取文本內容
 * @param {string|Array} content - 訊息內容
 * @returns {string} 提取的文本
 */
const extractTextFromContent = (content) => {
    if (typeof content === 'string') {
        return content
    } else if (Array.isArray(content)) {
        const textParts = content
            .filter(item => item.type === 'text')
            .map(item => item.text || '')
        return textParts.join(' ')
    }
    return ''
}

/**
 * 格式化訊息為文本（包含角色標註）
 * @param {object} message - 單條訊息
 * @returns {string} 格式化後的訊息文本
 */
const formatSingleMessage = (message) => {
    const role = message.role
    const content = extractTextFromContent(message.content)
    return content.trim() ? `${role}:${content}` : ''
}

/**
 * 格式化歷史訊息為文本字首
 * @param {Array} messages - 訊息陣列(不包含最後一條)
 * @returns {string} 格式化後的歷史訊息
 */
const formatHistoryMessages = (messages) => {
    const formattedParts = []
    
    for (let message of messages) {
        const formatted = formatSingleMessage(message)
        if (formatted) {
            formattedParts.push(formatted)
        }
    }
    
    return formattedParts.length > 0 ? formattedParts.join(';') : ''
}

/**
 * 解析訊息格式,處理圖片上傳和訊息結構
 * @param {Array} messages - 原始訊息陣列
 * @param {object} thinking_config - 思考配置
 * @param {string} chat_type - 聊天型別
 * @returns {Promise<Array>} 解析後的訊息陣列
 */
const parserMessages = async (messages, thinking_config, chat_type) => {
    try {
        const feature_config = thinking_config
        const imgCacheManager = new CacheManager()

        // 如果只有一條訊息,使用原有邏輯處理（不標註角色）
        if (messages.length <= 1) {
            logger.network('單條訊息，使用原格式處理', 'PARSER')
            return await processOriginalLogic(messages, thinking_config, chat_type, imgCacheManager)
        }

        // 多條訊息的情況:分離歷史訊息和最後一條訊息
        logger.network('多條訊息，格式化處理並標註角色', 'PARSER')
        const historyMessages = messages.slice(0, -1)
        const lastMessage = messages[messages.length - 1]

        // 格式化歷史訊息為文本字首
        const historyText = formatHistoryMessages(historyMessages)

        // 處理最後一條訊息
        let finalContent = []
        let lastMessageText = ''
        const lastMessageRole = lastMessage.role

        if (typeof lastMessage.content === 'string') {
            lastMessageText = lastMessage.content
        } else if (Array.isArray(lastMessage.content)) {
            // 處理最後一條訊息中的內容
            for (let item of lastMessage.content) {
                if (item.type === 'text') {
                    lastMessageText += item.text || ''
                } else if (isMediaContentItem(item)) {
                    const normalizedMediaItem = await normalizeMediaContentItem(item, imgCacheManager)
                    if (normalizedMediaItem) {
                        finalContent.push(normalizedMediaItem)
                    }
                }
            }
        }

        // 組合最終內容:歷史文本 + 當前訊息（帶角色標註）
        let combinedText = ''
        if (historyText) {
            combinedText = historyText + ';'
        }
        // 新增最後一條訊息，帶角色標註
        if (lastMessageText.trim()) {
            combinedText += `${lastMessageRole}:${lastMessageText}`
        }

        // 如果有圖片,建立包含文本和圖片的content陣列
        if (finalContent.length > 0) {
            finalContent.unshift({
                type: 'text',
                text: combinedText,
                chat_type: 't2t',
                feature_config: {
                    "output_schema": "phase",
                    "thinking_enabled": false,
                }
            });

            return [
                {
                    "role": "user",
                    "content": finalContent,
                    "chat_type": chat_type,
                    "extra": {},
                    "feature_config": feature_config
                }
            ]
        } else {
            // 純文本情況
            return [
                {
                    "role": "user",
                    "content": combinedText,
                    "chat_type": chat_type,
                    "extra": {},
                    "feature_config": feature_config
                }
            ]
        }

    } catch (e) {
        logger.error('訊息解析失敗', 'PARSER', '', e)
        return [
            {
                "role": "user",
                "content": "直接返回字串: '聊天曆史處理有誤...'",
                "chat_type": "t2t",
                "extra": {},
                "feature_config": {
                    "output_schema": "phase",
                    "enabled": false,
                }
            }
        ]
    }
}

/**
 * 原有的單條訊息處理邏輯
 * @param {Array} messages - 訊息陣列
 * @param {object} thinking_config - 思考配置
 * @param {string} chat_type - 聊天型別
 * @param {object} imgCacheManager - 圖片快取管理器
 * @returns {Promise<Array>} 處理後的訊息陣列
 */
const processOriginalLogic = async (messages, thinking_config, chat_type, imgCacheManager) => {
    const feature_config = thinking_config

    for (let message of messages) {
        if (message.role === 'user' || message.role === 'assistant') {
            message.chat_type = "t2t"
            message.extra = {}
            message.feature_config = {
                "output_schema": "phase",
                "thinking_enabled": false,
            }

            if (!Array.isArray(message.content)) continue

            const newContent = []

            for (let item of message.content) {
                if (isMediaContentItem(item)) {
                    const normalizedMediaItem = await normalizeMediaContentItem(item, imgCacheManager)
                    if (normalizedMediaItem) {
                        newContent.push(normalizedMediaItem)
                    }
                } else if (item.type === 'text') {
                    item.chat_type = 't2t'
                    item.feature_config = {
                        "output_schema": "phase",
                        "thinking_enabled": false,
                    }

                    if (newContent.length >= 2) {
                        messages.push({
                            "role": "user",
                            "content": item.text,
                            "chat_type": "t2t",
                            "extra": {},
                            "feature_config": {
                                "output_schema": "phase",
                                "thinking_enabled": false,
                            }
                        })
                    } else {
                        newContent.push(item)
                    }
                }
            }

            message.content = newContent
        } else {
            if (Array.isArray(message.content)) {
                let system_prompt = ''
                for (let item of message.content) {
                    if (item.type === 'text') {
                        system_prompt += item.text
                    }
                }
                if (system_prompt) {
                    message.content = system_prompt
                }
            }
        }
    }

    messages[messages.length - 1].feature_config = feature_config
    messages[messages.length - 1].chat_type = chat_type

    return messages
}

module.exports = {
    isChatType,
    isThinkingEnabled,
    parserModel,
    parserMessages
}
