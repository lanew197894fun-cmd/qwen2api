const cluster = require('cluster')
const os = require('os')
const { logger } = require('./utils/logger')

// 載入環境變數
require('dotenv').config()

// 獲取CPU核心數
const cpuCores = os.cpus().length

// 獲取環境變數配置
const PM2_INSTANCES = process.env.PM2_INSTANCES || '1'
const SERVICE_PORT = process.env.SERVICE_PORT || 3000
const NODE_ENV = process.env.NODE_ENV || 'production'

// 解析程式數
let instances
if (PM2_INSTANCES === 'max') {
  instances = cpuCores
} else if (!isNaN(PM2_INSTANCES)) {
  instances = parseInt(PM2_INSTANCES)
} else {
  instances = 1
}

// 限制程式數不能超過CPU核心數
if (instances > cpuCores) {
  logger.warn(`配置的程式數(${instances})超過CPU核心數(${cpuCores})，自動調整為${cpuCores}`, 'AUTO')
  instances = cpuCores
}

logger.info('🚀 Qwen2API 智慧啟動', 'AUTO')
logger.info(`CPU核心數: ${cpuCores}`, 'AUTO')
logger.info(`配置的程式數: ${PM2_INSTANCES}`, 'AUTO')
logger.info(`實際啟動程式數: ${instances}`, 'AUTO')
logger.info(`服務埠: ${SERVICE_PORT}`, 'AUTO')

// 智慧判斷啟動方式
if (instances === 1) {
  logger.info('📦 使用單程式模式啟動', 'AUTO')
  // 直接啟動伺服器
  require('./server.js')
} else {
  // 檢查是否通過PM2啟動
  if (process.env.PM2_USAGE || process.env.pm_id !== undefined) {
    logger.info(`PM2程式啟動 - 程式ID: ${process.pid}, 工作程式ID: ${process.env.pm_id || 'unknown'}`, 'PM2')
    require('./server.js')
  } else if (cluster.isMaster) {
    logger.info(`🔥 使用Node.js叢集模式啟動 (${instances}個程式)`, 'AUTO')

    logger.info(`啟動主程式 - PID: ${process.pid}`, 'CLUSTER')
    logger.info(`執行環境: ${NODE_ENV}`, 'CLUSTER')

    // 建立工作程式
    for (let i = 0; i < instances; i++) {
      const worker = cluster.fork()
      logger.info(`啟動工作程式 ${i + 1}/${instances} - PID: ${worker.process.pid}`, 'CLUSTER')
    }

    // 監聽工作程式退出
    cluster.on('exit', (worker, code, signal) => {
      logger.error(`工作程式 ${worker.process.pid} 已退出 - 退出碼: ${code}, 訊號: ${signal}`, 'CLUSTER')

      // 自動重啟工作程式
      if (!worker.exitedAfterDisconnect) {
        logger.info('正在重啟工作程式...', 'CLUSTER')
        const newWorker = cluster.fork()
        logger.info(`新工作程式已啟動 - PID: ${newWorker.process.pid}`, 'CLUSTER')
      }
    })

    // 監聽工作程式線上
    cluster.on('online', (worker) => {
      logger.info(`工作程式 ${worker.process.pid} 已上線`, 'CLUSTER')
    })

    // 監聽工作程式斷開連線
    cluster.on('disconnect', (worker) => {
      logger.warn(`工作程式 ${worker.process.pid} 已斷開連線`, 'CLUSTER')
    })

    // 優雅關閉處理
    process.on('SIGTERM', () => {
      logger.info('收到SIGTERM訊號，正在優雅關閉...', 'CLUSTER')
      cluster.disconnect(() => {
        process.exit(0)
      })
    })

    process.on('SIGINT', () => {
      logger.info('收到SIGINT訊號，正在優雅關閉...', 'CLUSTER')
      cluster.disconnect(() => {
        process.exit(0)
      })
    })

  } else {
    // 工作程式邏輯
    logger.info(`工作程式啟動 - PID: ${process.pid}`, 'WORKER')
    require('./server.js')

    // 工作程式優雅關閉處理
    process.on('SIGTERM', () => {
      logger.info(`工作程式 ${process.pid} 收到SIGTERM訊號，正在關閉...`, 'WORKER')
      process.exit(0)
    })

    process.on('SIGINT', () => {
      logger.info(`工作程式 ${process.pid} 收到SIGINT訊號，正在關閉...`, 'WORKER')
      process.exit(0)
    })
  }
}
