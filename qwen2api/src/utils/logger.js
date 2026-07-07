const fs = require("fs");
const path = require("path");

/**
 * 日誌管理器 — 強化版
 * 核心改進：ERROR/WARN 級別不再輸出至 console，避免混入 SSE 串流
 */
class Logger {
  constructor(options = {}) {
    this.options = {
      level: options.level || "INFO",
      enableFileLog: options.enableFileLog || false,
      logDir: options.logDir || path.join(__dirname, "../../logs"),
      logFileName: options.logFileName || "app.log",
      showTimestamp: options.showTimestamp !== false,
      showLevel: options.showLevel !== false,
      showModule: options.showModule !== false,
      timeFormat: options.timeFormat || "YYYY-MM-DD HH:mm:ss",
      maxFileSize: options.maxFileSize || 10,
      maxFiles: options.maxFiles || 5,
      // ⚡ 新增：是否允許控制台輸出（預設關閉，避免混入 SSE）
      allowConsoleOutput: options.allowConsoleOutput === true,
    };

    this.levels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
    };

    this.emojis = {
      DEBUG: "🔍",
      INFO: "📝",
      WARN: "⚠️",
      ERROR: "❌",
      SUCCESS: "✅",
      NETWORK: "🌐",
      DATABASE: "🗄️",
      AUTH: "🔐",
      UPLOAD: "📤",
      DOWNLOAD: "📥",
      CACHE: "💾",
      CONFIG: "⚙️",
      SERVER: "🚀",
      CLIENT: "👤",
      REDIS: "🔴",
      TOKEN: "🎫",
      SEARCH: "🔍",
      CHAT: "💬",
      MODEL: "🤖",
      FILE: "📁",
      TIME: "⏰",
      MEMORY: "🧠",
      PROCESS: "⚡",
    };

    this.colors = {
      DEBUG: "\x1b[36m",
      INFO: "\x1b[32m",
      WARN: "\x1b[33m",
      ERROR: "\x1b[31m",
      RESET: "\x1b[0m",
      BRIGHT: "\x1b[1m",
      DIM: "\x1b[2m",
    };

    if (this.options.enableFileLog) {
      this.initLogDirectory();
    }
  }

  initLogDirectory() {
    try {
      if (!fs.existsSync(this.options.logDir)) {
        fs.mkdirSync(this.options.logDir, { recursive: true });
      }
    } catch (_) {}
  }

  shouldLog(level) {
    return this.levels[level] >= this.levels[this.options.level];
  }

  formatTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  formatMessage(level, message, module = "", emoji = "") {
    const timestamp = this.options.showTimestamp ? this.formatTimestamp() : "";
    const levelStr = this.options.showLevel ? `[${level}]` : "";
    const moduleStr = this.options.showModule && module ? `[${module}]` : "";
    const emojiStr = emoji || this.emojis[level] || "";

    const consoleMessage = [
      this.colors.DIM + timestamp + this.colors.RESET,
      this.colors[level] + levelStr + this.colors.RESET,
      this.colors.BRIGHT + moduleStr + this.colors.RESET,
      emojiStr,
      message,
    ]
      .filter(Boolean)
      .join(" ");

    const fileMessage = [timestamp, levelStr, moduleStr, emojiStr, message]
      .filter(Boolean)
      .join(" ");

    return { consoleMessage, fileMessage };
  }

  writeToFile(message) {
    if (!this.options.enableFileLog) return;

    try {
      const logFile = path.join(this.options.logDir, this.options.logFileName);
      const logEntry = `${message}\n`;

      this.rotateLogFile(logFile);

      fs.appendFileSync(logFile, logEntry, "utf8");
    } catch (_) {}
  }

  rotateLogFile(logFile) {
    try {
      if (!fs.existsSync(logFile)) return;

      const stats = fs.statSync(logFile);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB > this.options.maxFileSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupFile = logFile.replace(".log", `_${timestamp}.log`);

        fs.renameSync(logFile, backupFile);

        this.cleanOldLogFiles();
      }
    } catch (_) {}
  }

  cleanOldLogFiles() {
    try {
      const files = fs.readdirSync(this.options.logDir);
      const logFiles = files
        .filter(
          (file) => file.endsWith(".log") && file !== this.options.logFileName,
        )
        .map((file) => ({
          name: file,
          path: path.join(this.options.logDir, file),
          mtime: fs.statSync(path.join(this.options.logDir, file)).mtime,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (logFiles.length > this.options.maxFiles) {
        const filesToDelete = logFiles.slice(this.options.maxFiles);
        filesToDelete.forEach((file) => {
          fs.unlinkSync(file.path);
        });
      }
    } catch (_) {}
  }

  /**
   * ⚡ 核心修復：ERROR/WARN 不再輸出至 console
   * 僅在 allowConsoleOutput=true 時才輸出（供手調用）
   */
  log(level, message, module = "", emoji = "", data = null) {
    if (!this.shouldLog(level)) return;

    const { consoleMessage, fileMessage } = this.formatMessage(
      level,
      message,
      module,
      emoji,
    );

    // ⚡ ERROR 永遠輸出至 stderr（不依賴 allowConsoleOutput）
    // 原因：stderr 與 SSE 串流（stdout）完全隔離，無混入風險
    // 且錯誤日誌對除錯至關重要，不應被靜默吞掉
    if (level === "ERROR") {
      process.stderr.write(consoleMessage + "\n");
      if (data !== null) {
        process.stderr.write(JSON.stringify(data) + "\n");
      }
    } else if (this.options.allowConsoleOutput) {
      if (level === "WARN") {
        process.stderr.write(consoleMessage + "\n");
      } else {
        process.stdout.write(consoleMessage + "\n");
      }

      if (data !== null) {
        process.stdout.write(JSON.stringify(data) + "\n");
      }
    }

    // 檔案輸出（始終啟用，若 enableFileLog=true）
    this.writeToFile(
      fileMessage + (data ? `\n${JSON.stringify(data, null, 2)}` : ""),
    );
  }

  debug(message, module = "", emoji = "", data = null) {
    this.log("DEBUG", message, module, emoji || this.emojis.DEBUG, data);
  }

  info(message, module = "", emoji = "", data = null) {
    this.log("INFO", message, module, emoji || this.emojis.INFO, data);
  }

  warn(message, module = "", emoji = "", data = null) {
    this.log("WARN", message, module, emoji || this.emojis.WARN, data);
  }

  error(message, module = "", emoji = "", data = null) {
    this.log("ERROR", message, module, emoji || this.emojis.ERROR, data);
  }

  success(message, module = "", data = null) {
    this.info(message, module, this.emojis.SUCCESS, data);
  }

  network(message, module = "", data = null) {
    this.info(message, module, this.emojis.NETWORK, data);
  }

  database(message, module = "", data = null) {
    this.info(message, module, this.emojis.DATABASE, data);
  }

  auth(message, module = "", data = null) {
    this.info(message, module, this.emojis.AUTH, data);
  }

  redis(message, module = "", data = null) {
    this.info(message, module, this.emojis.REDIS, data);
  }

  chat(message, module = "", data = null) {
    this.info(message, module, this.emojis.CHAT, data);
  }

  server(message, module = "", data = null) {
    this.info(message, module, this.emojis.SERVER, data);
  }

  // ═══ 啟動專用方法：繞過 allowConsoleOutput，確保使用者看到啟動過程 ═══
  startup(message, module = "") {
    const level = "INFO";
    if (!this.shouldLog(level)) return;
    const { consoleMessage, fileMessage } = this.formatMessage(
      level,
      message,
      module,
      "📝",
    );
    process.stdout.write(consoleMessage + "\n");
    this.writeToFile(fileMessage);
  }

  // 階段分隔線
  phase(title) {
    this.startup(`══════ ${title} ══════`, "PHASE");
  }

  // 計算終端機可視寬度（CJK/emoji 佔 2）
  #visualLen(s) {
    let len = 0;
    for (let i = 0; i < s.length; i++) {
      const cp = s.codePointAt(i);
      if (cp > 0xffff) i++; // 跳過 surrogate pair 後半
      len +=
        (cp >= 0x1100 && cp <= 0x115f) ||
        (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7af) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe10 && cp <= 0xfe19) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff01 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1b000 && cp <= 0x1b0ff) ||
        (cp >= 0x1f000 && cp <= 0x1f9ff) ||
        (cp >= 0x20000 && cp <= 0x2ffff) ||
        (cp >= 0x30000 && cp <= 0x3ffff)
          ? 2
          : 1;
    }
    return len;
  }

  // 以可視寬度填補空白
  #padVisual(s, target) {
    const cur = this.#visualLen(s);
    return cur >= target ? s : s + " ".repeat(target - cur);
  }

  // 印出格式化的 key-value 表格（用於最終配置摘要）
  infoTable(title, data) {
    const entries = Object.entries(data);
    const keyW = Math.max(...entries.map((e) => this.#visualLen(e[0]))) + 2;
    const valW =
      Math.max(...entries.map((e) => this.#visualLen(String(e[1])))) + 2;
    const total = keyW + valW + 5;
    const line = "─".repeat(total);

    // 標題行（以可視寬度置中）
    process.stdout.write(`┌${line}┐\n`);
    const tLen = this.#visualLen(title);
    const tPad = Math.max(0, total - tLen - 2);
    const tL = Math.floor(tPad / 2);
    const tR = tPad - tL;
    process.stdout.write(`│${" ".repeat(tL)} ${title} ${" ".repeat(tR)}│\n`);
    process.stdout.write(`├${"─".repeat(keyW + 2)}┼${"─".repeat(valW + 2)}┤\n`);

    // 資料行（以可視寬度對齊）
    for (const [k, v] of entries) {
      process.stdout.write(
        `│ ${this.#padVisual(k, keyW)} │ ${this.#padVisual(String(v), valW)} │\n`,
      );
    }
    process.stdout.write(`└${line}┘\n`);
  }
}

const defaultLogger = new Logger({
  level: process.env.LOG_LEVEL || "INFO",
  enableFileLog: process.env.ENABLE_FILE_LOG === "true",
  showModule: true,
  showTimestamp: true,
  showLevel: true,
  // ⚡ 預設關閉 console 輸出，避免混入 SSE 串流
  allowConsoleOutput: process.env.ALLOW_CONSOLE_OUTPUT === "true",
});

module.exports = {
  Logger,
  logger: defaultLogger,
};
