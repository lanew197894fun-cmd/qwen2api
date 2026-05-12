const Redis = require('ioredis')
const config = require('../config/index.js')
const { logger } = require('./logger')

/**
 * Redis 連線管理器
 * 實現按需連線機制，僅在讀寫操作時建立連線
 */

// 連線配置
const REDIS_CONFIG = {
  maxRetries: 3,
  connectTimeout: 10000,
  commandTimeout: 15000,
  retryDelayOnFailover: 200,
  maxRetriesPerRequest: 3,
  enableOfflineQueue: false,
  enableReadyCheck: false,
  lazyConnect: true,
  keepAlive: 30000,
  connectionName: 'qwen2api_on_demand'
}

// 連線狀態
let redis = null
let isConnecting = false
let connectionPromise = null
let lastActivity = 0
let idleTimer = null

// 空閒超時時間 (5分鐘)
const IDLE_TIMEOUT = 5 * 60 * 1000
// 長時間空閒後在下一次使用前主動重建連線，避免複用已被服務端回收的空閒連線
const STALE_CONNECTION_THRESHOLD = 45 * 1000
const REDIS_VERIFY_RETRIES = 3
const REDIS_VERIFY_RETRY_DELAY = 500

/**
 * 判斷是否需要TLS
 */
const isTLS = config.redisURL && (config.redisURL.startsWith('rediss://') || config.redisURL.includes('--tls'))

/**
 * 建立Redis連線配置
 */
const createRedisConfig = () => ({
  ...REDIS_CONFIG,
  // TLS配置
  ...(isTLS ? {
    tls: {
      rejectUnauthorized: true
    }
  } : {}),

  // 重試策略
  retryStrategy(times) {
    if (times > REDIS_CONFIG.maxRetries) {
      logger.error(`Redis連線重試次數超限: ${times}`, 'REDIS')
      return null
    }

    const delay = Math.min(100 * Math.pow(2, times), 3000)
    logger.info(`Redis重試連線: ${times}, 延遲: ${delay}ms`, 'REDIS', '🔄')
    return delay
  },

  // 錯誤重連策略
  reconnectOnError(err) {
    const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE']
    return targetErrors.some(e => err.message.includes(e))
  }
})

/**
 * 驗證 Redis 命令通道是否可用
 * @param {object} client - Redis 客戶端例項
 * @returns {Promise<void>} 驗證結果
 */
const verifyRedisCommandChannel = async (client) => {
  let lastError = null

  for (let attempt = 1; attempt <= REDIS_VERIFY_RETRIES; attempt++) {
    try {
      const pong = await client.ping()
      if (pong !== 'PONG') {
        throw new Error(`PING 返回異常: ${pong}`)
      }

      if (attempt > 1) {
        logger.info(`Redis命令通道在第 ${attempt} 次校驗時恢復正常`, 'REDIS', '✅')
      }

      return
    } catch (error) {
      lastError = error

      if (attempt >= REDIS_VERIFY_RETRIES) {
        break
      }

      logger.warn(`Redis命令通道校驗失敗，第 ${attempt} 次後準備重試: ${error.message}`, 'REDIS')
      await new Promise(resolve => setTimeout(resolve, REDIS_VERIFY_RETRY_DELAY))
    }
  }

  throw new Error(`Redis命令通道不可用: ${lastError ? lastError.message : '未知錯誤'}`)
}

/**
 * 清理空閒定時器
 */
const clearIdleTimer = () => {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

/**
 * 等待現有 Redis 客戶端恢復為可用狀態
 * @param {object} client - Redis 客戶端例項
 * @returns {Promise<object>} 可用的 Redis 客戶端
 */
const waitForRedisReady = (client) => new Promise((resolve, reject) => {
  if (!client) {
    reject(new Error('Redis客戶端不存在'))
    return
  }

  if (client.status === 'ready') {
    resolve(client)
    return
  }

  const timeout = setTimeout(() => {
    cleanup()
    reject(new Error('等待Redis連線恢復超時'))
  }, REDIS_CONFIG.connectTimeout + REDIS_CONFIG.commandTimeout)

  const cleanup = () => {
    clearTimeout(timeout)
    client.off('ready', handleReady)
    client.off('close', handleClose)
    client.off('end', handleEnd)
  }

  const handleReady = () => {
    cleanup()
    resolve(client)
  }

  const handleClose = () => {
    cleanup()
    reject(new Error('Redis連線已關閉'))
  }

  const handleEnd = () => {
    cleanup()
    reject(new Error('Redis連線已結束'))
  }

  client.once('ready', handleReady)
  client.once('close', handleClose)
  client.once('end', handleEnd)
})

/**
 * 更新活動時間並重置空閒定時器
 */
const updateActivity = () => {
  lastActivity = Date.now()

  clearIdleTimer()

  // 設定新的空閒定時器
  idleTimer = setTimeout(() => {
    if (redis && Date.now() - lastActivity > IDLE_TIMEOUT) {
      logger.info('Redis連線空閒超時，斷開連線', 'REDIS', '🔌')
      disconnectRedis()
    }
  }, IDLE_TIMEOUT)
}

/**
 * 繫結 Redis 事件
 * @param {object} client - Redis 客戶端例項
 */
const bindRedisEvents = (client) => {
  client.on('connect', () => {
    logger.success('Redis連線建立', 'REDIS')
  })

  client.on('ready', () => {
    logger.success('Redis準備就緒', 'REDIS')
    if (redis === client) {
      updateActivity()
    }
  })

  client.on('error', (err) => {
    logger.error('Redis連線錯誤', 'REDIS', '', err)
  })

  client.on('close', () => {
    logger.info('Redis連線關閉', 'REDIS', '🔌')
    if (redis === client) {
      redis = null
      clearIdleTimer()
    }
  })

  client.on('end', () => {
    logger.info('Redis連線結束', 'REDIS', '🔌')
    if (redis === client) {
      redis = null
      clearIdleTimer()
    }
  })

  client.on('reconnecting', (delay) => {
    logger.info(`Redis重新連線中...延遲: ${delay}ms`, 'REDIS', '🔄')
  })
}

/**
 * 建立Redis連線
 */
const connectRedis = async () => {
  if (redis && redis.status === 'ready') {
    updateActivity()
    return redis
  }

  if (redis && ['connect', 'connecting', 'reconnecting'].includes(redis.status)) {
    if (!connectionPromise) {
      isConnecting = true
      connectionPromise = waitForRedisReady(redis)
        .then(client => {
          updateActivity()
          return client
        })
        .finally(() => {
          isConnecting = false
          connectionPromise = null
        })
    }

    return connectionPromise
  }

  if (connectionPromise) {
    return connectionPromise
  }

  isConnecting = true
  connectionPromise = (async () => {
    let newRedis = null

    try {
      logger.info('建立Redis連線...', 'REDIS', '🔌')

      newRedis = new Redis(config.redisURL, createRedisConfig())
      redis = newRedis
      bindRedisEvents(newRedis)

      await newRedis.connect()
      await verifyRedisCommandChannel(newRedis)
      updateActivity()
      return newRedis
    } catch (error) {
      if (redis === newRedis) {
        redis = null
      }

      if (newRedis) {
        try {
          newRedis.disconnect()
        } catch (disconnectError) {
        }
      }

      logger.error('Redis連線失敗', 'REDIS', '', error)
      throw error
    } finally {
      isConnecting = false
      connectionPromise = null
    }
  })()

  return connectionPromise
}

/**
 * 斷開Redis連線
 */
const disconnectRedis = async () => {
  clearIdleTimer()

  if (redis) {
    const currentRedis = redis

    try {
      currentRedis.disconnect()
      logger.info('Redis連線已斷開', 'REDIS', '🔌')
    } catch (error) {
      logger.error('斷開Redis連線時出錯', 'REDIS', '', error)
    } finally {
      if (redis === currentRedis) {
        redis = null
      }

      isConnecting = false
      connectionPromise = null
    }
  }
}

/**
 * 確保Redis連線可用
 */
const ensureConnection = async () => {
  if (config.dataSaveMode !== 'redis') {
    logger.error('當前資料儲存模式不是Redis', 'REDIS')
    throw new Error('當前資料儲存模式不是Redis')
  }

  if (!redis || redis.status !== 'ready') {
    return await connectRedis()
  }

  if (Date.now() - lastActivity > STALE_CONNECTION_THRESHOLD) {
    logger.info('Redis連線空閒時間過長，主動重建連線', 'REDIS', '🔄')
    await disconnectRedis()
    return await connectRedis()
  }

  updateActivity()
  return redis
}

/**
 * 獲取所有帳戶
 * @returns {Promise<Array>} 所有帳戶資訊陣列
 */
const getAllAccounts = async () => {
  try {
    const client = await ensureConnection()

    // 使用SCAN命令替代KEYS命令，避免阻塞Redis伺服器
    const keys = []
    let cursor = '0'

    do {
      const result = await client.scan(cursor, 'MATCH', 'user:*', 'COUNT', 100)
      cursor = result[0]
      keys.push(...result[1])
    } while (cursor !== '0')

    if (!keys.length) {
      logger.info('沒有找到任何帳戶', 'REDIS', '✅')
      return []
    }

    // 使用pipeline一次性獲取所有帳戶資料
    const pipeline = client.pipeline()
    keys.forEach(key => {
      pipeline.hgetall(key)
    })

    const results = await pipeline.exec()
    if (!results) {
      logger.error('獲取帳戶資料失敗', 'REDIS')
      return []
    }

    const accounts = results.map((result, index) => {
      // result格式為[err, value]
      const [err, accountData] = result
      if (err) {
        logger.error(`獲取帳戶 ${keys[index]} 資料失敗`, 'REDIS', '', err)
        return null
      }
      if (!accountData || Object.keys(accountData).length === 0) {
        logger.error(`帳戶 ${keys[index]} 資料為空`, 'REDIS')
        return null
      }
      return {
        email: keys[index].replace('user:', ''),
        password: accountData.password || '',
        token: accountData.token || '',
        expires: accountData.expires || '',
        proxy: accountData.proxy || null
      }
    }).filter(Boolean) // 過濾掉null值

    logger.success(`獲取所有帳戶成功，共 ${accounts.length} 個帳戶`, 'REDIS')
    return accounts
  } catch (err) {
    logger.error('獲取帳戶時出錯', 'REDIS', '', err)
    throw err
  }
}

/**
 * 設定帳戶
 * @param {string} key - 鍵名（郵箱）
 * @param {Object} value - 帳戶資訊
 * @returns {Promise<boolean>} 設定是否成功
 */
const setAccount = async (key, value) => {
  try {
    const client = await ensureConnection()

    const { password, token, expires, proxy } = value
    await client.hset(`user:${key}`, {
      password: password || '',
      token: token || '',
      expires: expires || '',
      proxy: proxy || ''
    })

    logger.success(`帳戶 ${key} 設定成功`, 'REDIS')
    return true
  } catch (err) {
    logger.error(`設定帳戶 ${key} 失敗`, 'REDIS', '', err)
    return false
  }
}

/**
 * 刪除帳戶
 * @param {string} key - 鍵名（郵箱）
 * @returns {Promise<boolean>} 刪除是否成功
 */
const deleteAccount = async (key) => {
  try {
    const client = await ensureConnection()

    const result = await client.del(`user:${key}`)
    if (result > 0) {
      logger.success(`帳戶 ${key} 刪除成功`, 'REDIS')
      return true
    } else {
      logger.warn(`帳戶 ${key} 不存在`, 'REDIS')
      return false
    }
  } catch (err) {
    logger.error(`刪除帳戶 ${key} 失敗`, 'REDIS', '', err)
    return false
  }
}

/**
 * 檢查鍵是否存在
 * @param {string} key - 鍵名
 * @returns {Promise<boolean>} 鍵是否存在
 */
const checkKeyExists = async (key = 'headers') => {
  try {
    const client = await ensureConnection()

    const exists = await client.exists(key)
    const result = exists === 1

    logger.info(`鍵 "${key}" ${result ? '存在' : '不存在'}`, 'REDIS', result ? '✅' : '❌')
    return result
  } catch (err) {
    logger.error(`檢查鍵 "${key}" 時出錯`, 'REDIS', '', err)
    return false
  }
}

/**
 * 獲取連線狀態
 * @returns {Object} 連線狀態資訊
 */
const getConnectionStatus = () => {
  return {
    connected: redis && redis.status === 'ready',
    status: redis ? redis.status : 'disconnected',
    lastActivity: lastActivity,
    idleTimeout: IDLE_TIMEOUT,
    config: REDIS_CONFIG
  }
}

/**
 * 手動斷開連線（用於應用關閉時清理）
 */
const cleanup = async () => {
  logger.info('清理Redis連線...', 'REDIS', '🧹')
  await disconnectRedis()
}

// 建立相容的Redis客戶端物件
const redisClient = {
  getAllAccounts,
  setAccount,
  deleteAccount,
  checkKeyExists,
  getConnectionStatus,
  cleanup,

  // 直接Redis命令的代理方法（按需連線）
  async hset(key, ...args) {
    const client = await ensureConnection()
    return client.hset(key, ...args)
  },

  async hget(key, field) {
    const client = await ensureConnection()
    return client.hget(key, field)
  },

  async hgetall(key) {
    const client = await ensureConnection()
    return client.hgetall(key)
  },

  async exists(key) {
    const client = await ensureConnection()
    return client.exists(key)
  },

  async keys(pattern) {
    const client = await ensureConnection()
    // 使用SCAN命令替代KEYS命令，避免阻塞Redis伺服器
    const keys = []
    let cursor = '0'

    do {
      const result = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = result[0]
      keys.push(...result[1])
    } while (cursor !== '0')

    return keys
  },

  async del(key) {
    const client = await ensureConnection()
    return client.del(key)
  }
}

// 程式退出時清理連線
process.on('exit', cleanup)
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

// 根據配置決定是否匯出Redis客戶端
module.exports = config.dataSaveMode === 'redis' ? redisClient : null
