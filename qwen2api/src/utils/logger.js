const fs = require('fs')
const path = require('path')

/**
 * 日誌管理器
 * 統一管理專案中的日誌輸出，支援分級列印、時間戳、Emoji標籤等功能
 */
class Logger {
  constructor(options = {}) {
    this.options = {
      // 日誌級別: DEBUG < INFO < WARN < ERROR
      level: options.level || 'INFO',
      // 是否啟用檔案日誌
      enableFileLog: options.enableFileLog || false,
      // 日誌檔案路徑
      logDir: options.logDir || path.join(__dirname, '../../logs'),
      // 日誌檔名格式
      logFileName: options.logFileName || 'app.log',
      // 是否顯示時間戳
      showTimestamp: options.showTimestamp !== false,
      // 是否顯示日誌級別
      showLevel: options.showLevel !== false,
      // 是否顯示模組名
      showModule: options.showModule !== false,
      // 時間格式
      timeFormat: options.timeFormat || 'YYYY-MM-DD HH:mm:ss',
      // 最大日誌檔案大小 (MB)
      maxFileSize: options.maxFileSize || 10,
      // 保留的日誌檔案數量
      maxFiles: options.maxFiles || 5
    }

    // 日誌級別對映
    this.levels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3
    }

    // Emoji 標籤對映
    this.emojis = {
      DEBUG: '🔍',
      INFO: '📝',
      WARN: '⚠️',
      ERROR: '❌',
      SUCCESS: '✅',
      NETWORK: '🌐',
      DATABASE: '🗄️',
      AUTH: '🔐',
      UPLOAD: '📤',
      DOWNLOAD: '📥',
      CACHE: '💾',
      CONFIG: '⚙️',
      SERVER: '🚀',
      CLIENT: '👤',
      REDIS: '🔴',
      TOKEN: '🎫',
      SEARCH: '🔍',
      CHAT: '💬',
      MODEL: '🤖',
      FILE: '📁',
      TIME: '⏰',
      MEMORY: '🧠',
      PROCESS: '⚡'
    }

    // 顏色程式碼
    this.colors = {
      DEBUG: '\x1b[36m',    // 青色
      INFO: '\x1b[32m',     // 綠色
      WARN: '\x1b[33m',     // 黃色
      ERROR: '\x1b[31m',    // 紅色
      RESET: '\x1b[0m',     // 重置
      BRIGHT: '\x1b[1m',    // 加粗
      DIM: '\x1b[2m'        // 暗淡
    }

    // 初始化日誌目錄
    if (this.options.enableFileLog) {
      this.initLogDirectory()
    }
  }

  /**
   * 初始化日誌目錄
   */
  initLogDirectory() {
    try {
      if (!fs.existsSync(this.options.logDir)) {
        fs.mkdirSync(this.options.logDir, { recursive: true })
      }
    } catch (error) {
      console.error('建立日誌目錄失敗:', error.message)
    }
  }

  /**
   * 檢查日誌級別是否應該輸出
   * @param {string} level - 日誌級別
   * @returns {boolean}
   */
  shouldLog(level) {
    return this.levels[level] >= this.levels[this.options.level]
  }

  /**
   * 格式化時間戳
   * @returns {string}
   */
  formatTimestamp() {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }

  /**
   * 格式化日誌訊息
   * @param {string} level - 日誌級別
   * @param {string} message - 日誌訊息
   * @param {string} module - 模組名
   * @param {string} emoji - Emoji標籤
   * @returns {Object} 格式化後的訊息物件
   */
  formatMessage(level, message, module = '', emoji = '') {
    const timestamp = this.options.showTimestamp ? this.formatTimestamp() : ''
    const levelStr = this.options.showLevel ? `[${level}]` : ''
    const moduleStr = this.options.showModule && module ? `[${module}]` : ''
    const emojiStr = emoji || this.emojis[level] || ''
    
    // 控制台輸出格式（帶顏色）
    const consoleMessage = [
      this.colors.DIM + timestamp + this.colors.RESET,
      this.colors[level] + levelStr + this.colors.RESET,
      this.colors.BRIGHT + moduleStr + this.colors.RESET,
      emojiStr,
      message
    ].filter(Boolean).join(' ')

    // 檔案輸出格式（無顏色）
    const fileMessage = [
      timestamp,
      levelStr,
      moduleStr,
      emojiStr,
      message
    ].filter(Boolean).join(' ')

    return { consoleMessage, fileMessage }
  }

  /**
   * 寫入日誌檔案
   * @param {string} message - 日誌訊息
   */
  writeToFile(message) {
    if (!this.options.enableFileLog) return

    try {
      const logFile = path.join(this.options.logDir, this.options.logFileName)
      const logEntry = `${message}\n`
      
      // 檢查檔案大小並輪轉
      this.rotateLogFile(logFile)
      
      fs.appendFileSync(logFile, logEntry, 'utf8')
    } catch (error) {
      console.error('寫入日誌檔案失敗:', error.message)
    }
  }

  /**
   * 日誌檔案輪轉
   * @param {string} logFile - 日誌檔案路徑
   */
  rotateLogFile(logFile) {
    try {
      if (!fs.existsSync(logFile)) return

      const stats = fs.statSync(logFile)
      const fileSizeMB = stats.size / (1024 * 1024)

      if (fileSizeMB > this.options.maxFileSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const backupFile = logFile.replace('.log', `_${timestamp}.log`)
        
        fs.renameSync(logFile, backupFile)
        
        // 清理舊的日誌檔案
        this.cleanOldLogFiles()
      }
    } catch (error) {
      console.error('日誌檔案輪轉失敗:', error.message)
    }
  }

  /**
   * 清理舊的日誌檔案
   */
  cleanOldLogFiles() {
    try {
      const files = fs.readdirSync(this.options.logDir)
      const logFiles = files
        .filter(file => file.endsWith('.log') && file !== this.options.logFileName)
        .map(file => ({
          name: file,
          path: path.join(this.options.logDir, file),
          mtime: fs.statSync(path.join(this.options.logDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime)

      // 保留最新的幾個檔案，刪除其餘的
      if (logFiles.length > this.options.maxFiles) {
        const filesToDelete = logFiles.slice(this.options.maxFiles)
        filesToDelete.forEach(file => {
          fs.unlinkSync(file.path)
        })
      }
    } catch (error) {
      console.error('清理舊日誌檔案失敗:', error.message)
    }
  }

  /**
   * 通用日誌方法
   * @param {string} level - 日誌級別
   * @param {string} message - 日誌訊息
   * @param {string} module - 模組名
   * @param {string} emoji - Emoji標籤
   * @param {any} data - 附加資料
   */
  log(level, message, module = '', emoji = '', data = null) {
    if (!this.shouldLog(level)) return

    const { consoleMessage, fileMessage } = this.formatMessage(level, message, module, emoji)
    
    // 控制台輸出
    if (level === 'ERROR') {
      console.error(consoleMessage)
    } else if (level === 'WARN') {
      console.warn(consoleMessage)
    } else {
      console.log(consoleMessage)
    }

    // 輸出附加資料
    if (data !== null) {
      console.log(data)
    }

    // 檔案輸出
    this.writeToFile(fileMessage + (data ? `\n${JSON.stringify(data, null, 2)}` : ''))
  }

  // 便捷方法
  debug(message, module = '', emoji = '', data = null) {
    this.log('DEBUG', message, module, emoji || this.emojis.DEBUG, data)
  }

  info(message, module = '', emoji = '', data = null) {
    this.log('INFO', message, module, emoji || this.emojis.INFO, data)
  }

  warn(message, module = '', emoji = '', data = null) {
    this.log('WARN', message, module, emoji || this.emojis.WARN, data)
  }

  error(message, module = '', emoji = '', data = null) {
    this.log('ERROR', message, module, emoji || this.emojis.ERROR, data)
  }

  // 特定場景的便捷方法
  success(message, module = '', data = null) {
    this.info(message, module, this.emojis.SUCCESS, data)
  }

  network(message, module = '', data = null) {
    this.info(message, module, this.emojis.NETWORK, data)
  }

  database(message, module = '', data = null) {
    this.info(message, module, this.emojis.DATABASE, data)
  }

  auth(message, module = '', data = null) {
    this.info(message, module, this.emojis.AUTH, data)
  }

  redis(message, module = '', data = null) {
    this.info(message, module, this.emojis.REDIS, data)
  }

  chat(message, module = '', data = null) {
    this.info(message, module, this.emojis.CHAT, data)
  }

  server(message, module = '', data = null) {
    this.info(message, module, this.emojis.SERVER, data)
  }
}

// 建立預設例項
const defaultLogger = new Logger({
  level: process.env.LOG_LEVEL || 'INFO',
  enableFileLog: process.env.ENABLE_FILE_LOG === 'true',
  showModule: true,
  showTimestamp: true,
  showLevel: true
})

module.exports = {
  Logger,
  logger: defaultLogger
}
