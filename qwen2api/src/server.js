const express = require('express')
const bodyParser = require('body-parser')
const config = require('./config/index.js')
const cors = require('cors')
const { logger } = require('./utils/logger')
const { initSsxmodManager } = require('./utils/ssxmod-manager')
const app = express()
const path = require('path')
const fs = require('fs')
const modelsRouter = require('./routes/models.js')
const chatRouter = require('./routes/chat.js')
const cliChatRouter = require('./routes/cli.chat.js')
const anthropicRouter = require('./routes/anthropic.js')
const verifyRouter = require('./routes/verify.js')
const accountsRouter = require('./routes/accounts.js')
const settingsRouter = require('./routes/settings.js')

if (config.dataSaveMode === 'file') {
  if (!fs.existsSync(path.join(__dirname, '../data/data.json'))) {
    fs.writeFileSync(path.join(__dirname, '../data/data.json'), JSON.stringify({"accounts": [] }, null, 2))
  }
}

// 初始化 SSXMOD Cookie 管理器
initSsxmodManager()

app.use(bodyParser.json({ limit: '128mb' }))
app.use(bodyParser.urlencoded({ limit: '128mb', extended: true }))
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3456',
    'http://127.0.0.1:3456',
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  ],
  maxAge: 86400,
}))

// ─── Rate Limiter（滑動視窗，無依賴） ───
const RL_MAX = parseInt(process.env.API_RATE_LIMIT || "600");   // 本機環境放寬至 600 req/min
const RL_WIN = parseInt(process.env.API_RATE_WINDOW || "60000");
const rlBuckets = new Map();

app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let b = rlBuckets.get(ip);
  if (!b || now > b.reset) {
    b = { count: 0, reset: now + RL_WIN };
    rlBuckets.set(ip, b);
  }
  b.count++;
  if (rlBuckets.size > 10000) {
    const cutoff = Date.now();
    for (const [k, v] of rlBuckets) {
      if (cutoff > v.reset) rlBuckets.delete(k);
    }
  }
  if (b.count > RL_MAX) {
    return res.status(429).json({ error: "Too Many Requests", retryAfter: Math.ceil(RL_WIN / 1000) });
  }
  next();
});

// API路由
app.use(modelsRouter)
app.use(chatRouter)
app.use(cliChatRouter)
app.use(anthropicRouter)
app.use(verifyRouter)
app.use('/api', accountsRouter)
app.use('/api', settingsRouter)
app.use('/', require('./routes/health'))

app.use(express.static(path.join(__dirname, '../public/dist')))

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dist/index.html'), (err) => {
    if (err) {
      logger.error('管理頁面載入失敗', 'SERVER', '', err)
      res.status(500).send('伺服器內部錯誤')
    }
  })
})

// 處理錯誤中介軟體（必須放在所有路由之後）
app.use((err, req, res, next) => {
  logger.error('伺服器內部錯誤', 'SERVER', '', err)
  res.status(500).send('伺服器內部錯誤')
})


// 伺服器啟動資訊
const serverInfo = {
  address: config.listenAddress || 'localhost',
  port: config.listenPort,
  outThink: config.outThink ? '開啟' : '關閉',
  searchInfoMode: config.searchInfoMode === 'table' ? '表格' : '文本',
  dataSaveMode: config.dataSaveMode,
  logLevel: config.logLevel,
  enableFileLog: config.enableFileLog
}

if (config.listenAddress) {
  app.listen(config.listenPort, config.listenAddress, () => {
    logger.server('伺服器啟動成功', 'SERVER', serverInfo)
    logger.info('開源地址: https://github.com/Rfym21/Qwen2API', 'INFO')
    logger.info('電報群聊: https://t.me/nodejs_project', 'INFO')
  })
} else {
  app.listen(config.listenPort, () => {
    logger.server('伺服器啟動成功', 'SERVER', serverInfo)
    logger.info('開源地址: https://github.com/Rfym21/Qwen2API', 'INFO')
    logger.info('電報群聊: https://t.me/nodejs_project', 'INFO')
  })
}