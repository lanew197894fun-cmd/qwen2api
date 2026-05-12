const axios = require('axios')
const OSS = require('ali-oss')
const mimetypes = require('mime-types')
const { logger } = require('./logger')
const { generateUUID } = require('./tools.js')
const { getProxyAgent, getChatBaseUrl, applyProxyToAxiosConfig } = require('./proxy-helper')

// 配置常量
const UPLOAD_CONFIG = {
    get stsTokenUrl() {
        return `${getChatBaseUrl()}/api/v1/files/getstsToken`
    },
    maxRetries: 3,
    timeout: 30000,
    maxFileSize: 100 * 1024 * 1024, // 100MB
    retryDelay: 1000
}

// 支援的檔案型別
const SUPPORTED_TYPES = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
    video: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv'],
    audio: ['audio/mp3', 'audio/wav', 'audio/aac', 'audio/ogg'],
    document: ['application/pdf', 'text/plain', 'application/msword']
}

/**
 * 驗證檔案大小
 * @param {number} fileSize - 檔案大小（位元組）
 * @returns {boolean} 是否符合大小限制
 */
const validateFileSize = (fileSize) => {
    return fileSize > 0 && fileSize <= UPLOAD_CONFIG.maxFileSize
}



/**
 * 從完整MIME型別獲取簡化的檔案型別
 * @param {string} mimeType - 完整的MIME型別
 * @returns {string} 簡化檔案型別
 */
const getSimpleFileType = (mimeType) => {
    if (!mimeType) return 'file'

    const mainType = mimeType.split('/')[0].toLowerCase()

    // 檢查是否為支援的主要型別
    if (Object.keys(SUPPORTED_TYPES).includes(mainType)) {
        return mainType
    }

    return 'file'
}

/**
 * 延遲函式
 * @param {number} ms - 延遲毫秒數
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 請求STS Token（帶重試機制）
 * @param {string} filename - 檔名
 * @param {number} filesize - 檔案大小（位元組）
 * @param {string} filetypeSimple - 簡化檔案型別
 * @param {string} authToken - 認證Token
 * @param {number} retryCount - 重試次數
 * @param {Object} [account] - 帳戶物件（用於解析帳號級代理）
 * @returns {Promise<Object>} STS Token響應資料
 */
const requestStsToken = async (filename, filesize, filetypeSimple, authToken, retryCount = 0, account) => {
    try {
        // 引數驗證
        if (!filename || !authToken) {
            logger.error('檔名和認證Token不能為空', 'UPLOAD')
            throw new Error('檔名和認證Token不能為空')
        }

        if (!validateFileSize(filesize)) {
            logger.error(`檔案大小超出限制，最大允許 ${UPLOAD_CONFIG.maxFileSize / 1024 / 1024}MB`, 'UPLOAD')
            throw new Error(`檔案大小超出限制，最大允許 ${UPLOAD_CONFIG.maxFileSize / 1024 / 1024}MB`)
        }

        const requestId = generateUUID()
        const bearerToken = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`
        const proxyAgent = getProxyAgent(account)

        const headers = {
            'Authorization': bearerToken,
            'Content-Type': 'application/json',
            'x-request-id': requestId,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        const payload = {
            filename,
            filesize,
            filetype: filetypeSimple
        }

        const requestConfig = {
            headers,
            timeout: UPLOAD_CONFIG.timeout
        }

        // 新增代理配置
        if (proxyAgent) {
            requestConfig.httpsAgent = proxyAgent
            requestConfig.proxy = false
        }

        logger.info(`請求STS Token: ${filename} (${filesize} bytes, ${filetypeSimple})`, 'UPLOAD', '🎫')

        const response = await axios.post(UPLOAD_CONFIG.stsTokenUrl, payload, requestConfig)

        if (response.status === 200 && response.data) {
            const stsData = response.data

            // 驗證響應資料完整性
            const credentials = {
                access_key_id: stsData.access_key_id,
                access_key_secret: stsData.access_key_secret,
                security_token: stsData.security_token
            }

            const fileInfo = {
                url: stsData.file_url,
                path: stsData.file_path,
                bucket: stsData.bucketname,
                endpoint: stsData.region + '.aliyuncs.com',
                id: stsData.file_id
            }

            // 檢查必要欄位
            const requiredCredentials = ['access_key_id', 'access_key_secret', 'security_token']
            const requiredFileInfo = ['url', 'path', 'bucket', 'endpoint', 'id']

            const missingCredentials = requiredCredentials.filter(key => !credentials[key])
            const missingFileInfo = requiredFileInfo.filter(key => !fileInfo[key])

            if (missingCredentials.length > 0 || missingFileInfo.length > 0) {
                logger.error(`STS響應資料不完整: 缺少 ${[...missingCredentials, ...missingFileInfo].join(', ')}`, 'UPLOAD')
                throw new Error(`STS響應資料不完整: 缺少 ${[...missingCredentials, ...missingFileInfo].join(', ')}`)
            }

            logger.success('STS Token獲取成功', 'UPLOAD')
            return { credentials, file_info: fileInfo }
        } else {
            logger.error(`獲取STS Token失敗，狀態碼: ${response.status}`, 'UPLOAD')
            throw new Error(`獲取STS Token失敗，狀態碼: ${response.status}`)
        }
    } catch (error) {
        logger.error(`請求STS Token失敗 (重試: ${retryCount})`, 'UPLOAD', '', error)

        // 403錯誤特殊處理
        if (error.response?.status === 403) {
            logger.error('403 Forbidden錯誤，可能是Token許可權問題', 'UPLOAD')
            logger.error('認證失敗，請檢查Token許可權', 'UPLOAD')
            throw new Error('認證失敗，請檢查Token許可權')
        }

        // 重試邏輯
        if (retryCount < UPLOAD_CONFIG.maxRetries &&
            (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' ||
                error.response?.status >= 500)) {

            const delayMs = UPLOAD_CONFIG.retryDelay * Math.pow(2, retryCount)
            logger.warn(`等待 ${delayMs}ms 後重試...`, 'UPLOAD', '⏳')
            await delay(delayMs)

            return requestStsToken(filename, filesize, filetypeSimple, authToken, retryCount + 1, account)
        }

        throw error
    }
}

/**
 * 使用STS憑證將檔案Buffer上傳到阿里雲OSS（帶重試機制）
 * @param {Buffer} fileBuffer - 檔案內容的Buffer
 * @param {Object} stsCredentials - STS憑證
 * @param {Object} ossInfo - OSS資訊
 * @param {string} fileContentTypeFull - 檔案的完整MIME型別
 * @param {number} retryCount - 重試次數
 * @returns {Promise<Object>} 上傳結果
 */
const uploadToOssWithSts = async (fileBuffer, stsCredentials, ossInfo, fileContentTypeFull, retryCount = 0) => {
    try {
        // 引數驗證
        if (!fileBuffer || !stsCredentials || !ossInfo) {
            logger.error('缺少必要的上傳引數', 'UPLOAD')
            throw new Error('缺少必要的上傳引數')
        }

        const client = new OSS({
            accessKeyId: stsCredentials.access_key_id,
            accessKeySecret: stsCredentials.access_key_secret,
            stsToken: stsCredentials.security_token,
            bucket: ossInfo.bucket,
            endpoint: ossInfo.endpoint,
            secure: true,
            timeout: UPLOAD_CONFIG.timeout
        })

        logger.info(`上傳檔案到OSS: ${ossInfo.path} (${fileBuffer.length} bytes)`, 'UPLOAD', '📤')

        const result = await client.put(ossInfo.path, fileBuffer, {
            headers: {
                'Content-Type': fileContentTypeFull || 'application/octet-stream'
            }
        })

        if (result.res && result.res.status === 200) {
            logger.success('檔案上傳到OSS成功', 'UPLOAD')
            return { success: true, result }
        } else {
            logger.error(`OSS上傳失敗，狀態碼: ${result.res?.status || 'unknown'}`, 'UPLOAD')
            throw new Error(`OSS上傳失敗，狀態碼: ${result.res?.status || 'unknown'}`)
        }
    } catch (error) {
        logger.error(`OSS上傳失敗 (重試: ${retryCount})`, 'UPLOAD', '', error)

        // 重試邏輯
        if (retryCount < UPLOAD_CONFIG.maxRetries) {
            const delayMs = UPLOAD_CONFIG.retryDelay * Math.pow(2, retryCount)
            logger.warn(`等待 ${delayMs}ms 後重試OSS上傳...`, 'UPLOAD', '⏳')
            await delay(delayMs)

            return uploadToOssWithSts(fileBuffer, stsCredentials, ossInfo, fileContentTypeFull, retryCount + 1)
        }

        throw error
    }
}

/**
 * 完整的檔案上傳流程：獲取STS Token -> 上傳到OSS。
 * @param {Buffer} fileBuffer - 圖片檔案的Buffer。
 * @param {string} originalFilename - 原始檔名 (例如 "image.png")。
 * @param {string} authToken - 通義千問認證Token (純token，不含Bearer)。
 * @param {Object} [account] - 帳戶物件（用於解析帳號級代理）
 * @returns {Promise<{file_url: string, file_id: string, message: string}>} 包含上傳後的URL、檔案ID和成功訊息。
 * @throws {Error} 如果任何步驟失敗。
 */
const uploadFileToQwenOss = async (fileBuffer, originalFilename, authToken, account) => {
    try {
        // 引數驗證
        if (!fileBuffer || !originalFilename || !authToken) {
            logger.error('缺少必要的上傳引數', 'UPLOAD')
            throw new Error('缺少必要的上傳引數')
        }

        const filesize = fileBuffer.length
        const mimeType = mimetypes.lookup(originalFilename) || 'application/octet-stream'
        const filetypeSimple = getSimpleFileType(mimeType)

        // 檔案大小驗證
        if (!validateFileSize(filesize)) {
            logger.error(`檔案大小超出限制，最大允許 ${UPLOAD_CONFIG.maxFileSize / 1024 / 1024}MB`, 'UPLOAD')
            throw new Error(`檔案大小超出限制，最大允許 ${UPLOAD_CONFIG.maxFileSize / 1024 / 1024}MB`)
        }

        logger.info(`開始上傳檔案: ${originalFilename} (${filesize} bytes, ${mimeType})`, 'UPLOAD', '📤')

        // 第一步：獲取STS Token
        const { credentials, file_info } = await requestStsToken(
            originalFilename,
            filesize,
            filetypeSimple,
            authToken,
            0,
            account
        )

        // 第二步：上傳到OSS
        await uploadToOssWithSts(fileBuffer, credentials, file_info, mimeType)

        logger.success('檔案上傳流程完成', 'UPLOAD')

        return {
            status: 200,
            file_url: file_info.url,
            file_id: file_info.id,
            message: '檔案上傳成功'
        }
    } catch (error) {
        logger.error('檔案上傳流程失敗', 'UPLOAD', '', error)
        throw error
    }
}



module.exports = {
    uploadFileToQwenOss
}
