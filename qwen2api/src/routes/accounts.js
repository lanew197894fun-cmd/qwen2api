const express = require('express')
const router = express.Router()
const config = require('../config')
const accountManager = require('../utils/account')
const { logger } = require('../utils/logger')
const { JwtDecode } = require('../utils/tools')
const { adminKeyVerify } = require('../middlewares/authorization')
const { deleteAccount, saveAccounts, refreshAccountToken } = require('../utils/setting')
const { parseAccountLine } = require('../utils/account-parser')
const { isValidProxyUrl } = require('../utils/proxy-helper')

// 僅在 proxy 欄位存在時觸發；空字串/null 一律視為"清除代理"，無需校驗
const PROXY_FORMAT_ERROR = '代理 URL 格式無效，應以 http://、https:// 或 socks5:// 開頭'

const batchAccountTasks = new Map()
const BATCH_TASK_RETENTION_MS = 1000 * 60 * 30
const BATCH_TASK_RESULT_LIMIT = 12

/**
 * 生成批次任務 ID
 * @returns {string} 任務 ID
 */
const generateBatchTaskId = () => `batch_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

/**
 * 計劃清理已完成的批次任務
 * @param {string} taskId - 任務 ID
 */
const scheduleBatchTaskCleanup = (taskId) => {
  setTimeout(() => {
    batchAccountTasks.delete(taskId)
  }, BATCH_TASK_RETENTION_MS)
}

/**
 * 解析批次帳號文本
 * 行格式（與 ENV ACCOUNTS 一致）：
 *   email:password                  — 老格式
 *   email:password|proxy_url        — 新格式，附帶帳號級代理
 * @param {string} accountsText - 原始帳號文本
 * @returns {{ accountLines: string[], parsedAccounts: Array<{ email: string, password: string, proxy: string|null }>, invalidCount: number }} 解析結果
 */
const parseBatchAccountsText = (accountsText) => {
  const normalizedText = String(accountsText).replace(/[\r]/g, '\n')
  const accountLines = normalizedText
    .split('\n')
    .map(item => item.trim())
    .filter(item => item !== '')

  const parsedAccounts = []
  let invalidCount = 0

  for (const accountLine of accountLines) {
    const parsed = parseAccountLine(accountLine)
    if (!parsed) {
      invalidCount++
      continue
    }
    // 行格式合法但 proxy 欄位格式錯誤，整行視為無效，避免後續登入後才暴露失敗
    if (parsed.proxy && !isValidProxyUrl(parsed.proxy)) {
      invalidCount++
      continue
    }
    parsedAccounts.push(parsed)
  }

  return {
    accountLines,
    parsedAccounts,
    invalidCount
  }
}

/**
 * 構造新的批次任務
 * @param {number} total - 總條目數
 * @param {number} valid - 有效條目數
 * @param {number} skipped - 跳過條目數
 * @param {number} invalid - 無效條目數
 * @returns {object} 任務物件
 */
const createBatchAccountTask = (total, valid, skipped, invalid) => {
  const concurrency = Math.max(1, parseInt(config.batchLoginConcurrency) || 5)
  const task = {
    id: generateBatchTaskId(),
    status: 'pending',
    message: '任務已建立，等待執行',
    concurrency,
    total,
    valid,
    skipped,
    invalid,
    processed: 0,
    completed: skipped + invalid,
    success: 0,
    failed: 0,
    activeEmails: [],
    failedEmails: [],
    recentResults: [],
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null
  }

  batchAccountTasks.set(task.id, task)
  return task
}

/**
 * 記錄批次任務最近結果
 * @param {object} task - 任務物件
 * @param {object} result - 單條結果
 */
const pushBatchTaskResult = (task, result) => {
  task.recentResults.unshift(result)
  if (task.recentResults.length > BATCH_TASK_RESULT_LIMIT) {
    task.recentResults.length = BATCH_TASK_RESULT_LIMIT
  }
}

/**
 * 獲取批次任務快照
 * @param {object} task - 任務物件
 * @returns {object} 可序列化的任務狀態
 */
const getBatchTaskSnapshot = (task) => {
  const total = task.total || 0
  const progress = total > 0 ? Number(((task.completed / total) * 100).toFixed(2)) : 100

  return {
    taskId: task.id,
    status: task.status,
    message: task.message,
    total: task.total,
    valid: task.valid,
    skipped: task.skipped,
    invalid: task.invalid,
    processed: task.processed,
    completed: task.completed,
    pending: Math.max(0, task.total - task.completed),
    success: task.success,
    failed: task.failed,
    progress,
    concurrency: task.concurrency,
    activeEmails: task.activeEmails,
    failedEmails: task.failedEmails,
    recentResults: task.recentResults,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt
  }
}

/**
 * 更新批次任務文案
 * @param {object} task - 任務物件
 */
const updateBatchTaskMessage = (task) => {
  if (task.status === 'completed') {
    task.message = `批次新增完成，成功 ${task.success} 個，失敗 ${task.failed} 個`
    return
  }

  if (task.status === 'failed') {
    if (!task.message) {
      task.message = '批次新增執行失敗'
    }
    return
  }

  const activeCount = task.activeEmails.length
  if (activeCount > 0) {
    task.message = `正在處理 ${task.completed}/${task.total}，併發中 ${activeCount} 個`
  } else {
    task.message = `正在處理 ${task.completed}/${task.total}`
  }
}

/**
 * 執行單個帳號的批次登入任務
 * @param {object} task - 任務物件
 * @param {{ email: string, password: string, proxy: string|null }} account - 帳號資訊
 */
const processBatchAccountItem = async (task, account) => {
  const { email, password, proxy } = account
  task.activeEmails.push(email)
  updateBatchTaskMessage(task)

  try {
    const authToken = await accountManager.login(email, password)
    if (!authToken) {
      throw new Error('登入失敗')
    }

    const decoded = JwtDecode(authToken)
    const saved = await accountManager.addAccountWithToken(email, password, authToken, decoded.exp, proxy)
    if (!saved) {
      throw new Error('儲存失敗')
    }

    task.success++
    pushBatchTaskResult(task, {
      email,
      status: 'success',
      message: '登入成功'
    })
  } catch (error) {
    task.failed++
    if (!task.failedEmails.includes(email)) {
      task.failedEmails.push(email)
    }

    pushBatchTaskResult(task, {
      email,
      status: 'failed',
      message: error.message || '登入失敗'
    })

    logger.error(`批次登入帳號失敗: ${email}`, 'ACCOUNT', '', error)
  } finally {
    task.processed++
    task.completed++
    task.activeEmails = task.activeEmails.filter(item => item !== email)
    updateBatchTaskMessage(task)
  }
}

/**
 * 執行批次帳號新增任務
 * @param {object} task - 任務物件
 * @param {Array<{ email: string, password: string }>} newAccounts - 待處理帳號
 * @returns {Promise<object>} 最終任務物件
 */
const runBatchAccountTask = async (task, newAccounts) => {
  try {
    task.status = 'running'
    task.startedAt = Date.now()
    updateBatchTaskMessage(task)

    if (newAccounts.length === 0) {
      task.status = 'completed'
      task.finishedAt = Date.now()
      updateBatchTaskMessage(task)
      scheduleBatchTaskCleanup(task.id)
      return task
    }

    for (let i = 0; i < newAccounts.length; i += task.concurrency) {
      const batch = newAccounts.slice(i, i + task.concurrency)
      await Promise.allSettled(batch.map(account => processBatchAccountItem(task, account)))
    }

    task.status = 'completed'
    task.finishedAt = Date.now()
    updateBatchTaskMessage(task)
    scheduleBatchTaskCleanup(task.id)
    return task
  } catch (error) {
    task.status = 'failed'
    task.finishedAt = Date.now()
    task.message = error.message || '批次新增執行失敗'
    logger.error('批次建立帳號失敗', 'ACCOUNT', '', error)
    scheduleBatchTaskCleanup(task.id)
    return task
  }
}

/**
 * 獲取所有帳號（分頁）
 * 
 * @param {number} page 頁碼
 * @param {number} pageSize 每頁數量
 * @returns {Object} 帳號列表
 */
router.get('/getAllAccounts', adminKeyVerify, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 1000
    const start = (page - 1) * pageSize

    // 獲取所有帳號鍵
    const allAccounts = accountManager.getAllAccountKeys()
    const total = allAccounts.length

    // 分頁處理
    const paginatedAccounts = allAccounts.slice(start, start + pageSize)

    // 獲取每個帳號的詳細資訊
    const accounts = paginatedAccounts.map(account => {
      return {
        email: account.email,
        password: account.password,
        token: account.token,
        expires: account.expires,
        proxy: account.proxy ?? null
      }
    })

    res.json({
      total,
      page,
      pageSize,
      data: accounts
    })
  } catch (error) {
    logger.error('獲取帳號列表失敗', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /setAccount
 * 新增帳號
 *
 * @param {string} email 郵箱
 * @param {string} password 密碼
 * @param {string} [proxy] 帳號專屬代理 URL（可選，HTTP/HTTPS/SOCKS5）
 * @returns {Object} 帳號資訊
 */
router.post('/setAccount', adminKeyVerify, async (req, res) => {
  try {
    const { email, password, proxy } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: '郵箱和密碼不能為空' })
    }

    // 規範化 proxy：空字串/純空白/非字串 → null
    const normalizedProxy = (typeof proxy === 'string' && proxy.trim()) ? proxy.trim() : null

    // 防禦性校驗：攔截明顯的拼寫錯誤（缺協議等），執行時才暴露的錯誤對使用者不友好
    if (normalizedProxy && !isValidProxyUrl(normalizedProxy)) {
      return res.status(400).json({ error: PROXY_FORMAT_ERROR })
    }

    // 檢查帳號是否已存在
    const exists = accountManager.accountTokens.find(item => item.email === email)
    if (exists) {
      return res.status(409).json({ error: '帳號已存在' })
    }

    const authToken = await accountManager.login(email, password)
    if (!authToken) {
      return res.status(401).json({ error: '登入失敗' })
    }
    // 解析JWT
    const decoded = JwtDecode(authToken)
    const expires = decoded.exp

    const success = await saveAccounts(email, password, authToken, expires, normalizedProxy)

    if (success) {
      res.status(200).json({
        email,
        message: '帳號建立成功'
      })
    } else {
      res.status(500).json({ error: '帳號建立失敗' })
    }
  } catch (error) {
    logger.error('建立帳號失敗', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /deleteAccount
 * 刪除帳號
 * 
 * @param {string} email 郵箱
 * @returns {Object} 帳號資訊
 */
router.delete('/deleteAccount', adminKeyVerify, async (req, res) => {
  try {
    const { email } = req.body

    // 檢查帳號是否存在
    const exists = await accountManager.accountTokens.find(item => item.email === email)
    if (!exists) {
      return res.status(404).json({ error: '帳號不存在' })
    }

    // 刪除帳號
    const success = await deleteAccount(email)

    if (success) {
      res.json({ message: '帳號刪除成功' })
    } else {
      res.status(500).json({ error: '帳號刪除失敗' })
    }
  } catch (error) {
    logger.error('刪除帳號失敗', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})


/**
 * POST /setAccounts
 * 批次新增帳號（並行處理）
 *
 * @param {string} accounts 帳號列表
 * @returns {Object} 新增結果統計
 */
router.post('/setAccounts', adminKeyVerify, async (req, res) => {
  try {
    let { accounts, async: asyncTask } = req.body
    if (!accounts) {
      return res.status(400).json({ error: '帳號列表不能為空' })
    }

    const { accountLines, parsedAccounts, invalidCount } = parseBatchAccountsText(accounts)

    if (accountLines.length === 0) {
      return res.status(400).json({ error: '沒有有效的帳號' })
    }

    if (parsedAccounts.length === 0) {
      return res.status(400).json({ error: '沒有符合格式的帳號，請使用 email:password' })
    }

    const existingEmails = new Set(accountManager.getAllAccountKeys().map(acc => acc.email))
    const seenEmails = new Set()
    const newAccounts = []
    let skippedCount = 0

    for (const account of parsedAccounts) {
      if (existingEmails.has(account.email) || seenEmails.has(account.email)) {
        skippedCount++
        continue
      }

      seenEmails.add(account.email)
      newAccounts.push(account)
    }

    const task = createBatchAccountTask(accountLines.length, parsedAccounts.length, skippedCount, invalidCount)

    if (asyncTask === true || asyncTask === 'true') {
      runBatchAccountTask(task, newAccounts)

      return res.status(202).json({
        message: '批次新增任務已建立',
        ...getBatchTaskSnapshot(task)
      })
    }

    await runBatchAccountTask(task, newAccounts)

    res.json({
      message: '批次新增完成',
      ...getBatchTaskSnapshot(task)
    })
  } catch (error) {
    logger.error('批次建立帳號失敗', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /batchTasks/:taskId
 * 獲取批次新增任務進度
 *
 * @param {string} taskId 任務 ID
 * @returns {Object} 任務進度
 */
router.get('/batchTasks/:taskId', adminKeyVerify, async (req, res) => {
  const { taskId } = req.params
  const task = batchAccountTasks.get(taskId)

  if (!task) {
    return res.status(404).json({ error: '任務不存在或已過期' })
  }

  res.json(getBatchTaskSnapshot(task))
})

/**
 * POST /updateAccountProxy
 * 更新帳號專屬代理 URL
 * 傳入空字串/null 視為清除代理，回退到全域性 PROXY_URL（若存在）
 *
 * @param {string} email 郵箱
 * @param {string|null} proxy 新代理 URL，空表示清除
 * @returns {Object} 更新結果
 */
router.post('/updateAccountProxy', adminKeyVerify, async (req, res) => {
  try {
    const { email, proxy } = req.body

    if (!email) {
      return res.status(400).json({ error: '郵箱不能為空' })
    }

    // 同 /setAccount：僅在傳入了非空 proxy 時才校驗格式；空值用於清除
    const normalizedProxy = (typeof proxy === 'string' && proxy.trim()) ? proxy.trim() : null
    if (normalizedProxy && !isValidProxyUrl(normalizedProxy)) {
      return res.status(400).json({ error: PROXY_FORMAT_ERROR })
    }

    const exists = accountManager.accountTokens.find(item => item.email === email)
    if (!exists) {
      return res.status(404).json({ error: '帳號不存在' })
    }

    const success = await accountManager.updateAccountProxy(email, normalizedProxy)

    if (success) {
      res.json({
        message: '帳號代理更新成功',
        email,
        proxy: exists.proxy ?? null
      })
    } else {
      res.status(500).json({ error: '帳號代理更新失敗' })
    }
  } catch (error) {
    logger.error('更新帳號代理失敗', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /refreshAccount
 * 重新整理單個帳號的令牌
 *
 * @param {string} email 郵箱
 * @returns {Object} 重新整理結果
 */
router.post('/refreshAccount', adminKeyVerify, async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: '郵箱不能為空' })
    }

    // 檢查帳號是否存在
    const exists = accountManager.accountTokens.find(item => item.email === email)
    if (!exists) {
      return res.status(404).json({ error: '帳號不存在' })
    }

    // 重新整理帳號令牌
    const success = await accountManager.refreshAccountToken(email)

    if (success) {
      res.json({
        message: '帳號令牌重新整理成功',
        email: email
      })
    } else {
      res.status(500).json({ error: '帳號令牌重新整理失敗' })
    }
  } catch (error) {
    logger.error('重新整理帳號令牌失敗', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /refreshAllAccounts
 * 重新整理所有帳號的令牌
 *
 * @param {number} thresholdHours 過期閾值（小時），預設24小時
 * @returns {Object} 重新整理結果
 */
router.post('/refreshAllAccounts', adminKeyVerify, async (req, res) => {
  try {
    const { thresholdHours = 24 } = req.body

    // 執行批次重新整理
    const refreshedCount = await accountManager.autoRefreshTokens(thresholdHours)

    res.json({
      message: '批次重新整理完成',
      refreshedCount: refreshedCount,
      thresholdHours: thresholdHours
    })
  } catch (error) {
    logger.error('批次重新整理帳號令牌失敗', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /forceRefreshAllAccounts
 * 強制重新整理所有帳號的令牌（不管是否即將過期）
 *
 * @returns {Object} 重新整理結果
 */
router.post('/forceRefreshAllAccounts', adminKeyVerify, async (req, res) => {
  try {
    // 強制重新整理所有帳號（設定閾值為很大的值，確保所有帳號都會被重新整理）
    const refreshedCount = await accountManager.autoRefreshTokens(8760) // 365天

    res.json({
      message: '強制重新整理完成',
      refreshedCount: refreshedCount,
      totalAccounts: accountManager.getAllAccountKeys().length
    })
  } catch (error) {
    logger.error('強制重新整理帳號令牌失敗', 'ACCOUNT', '', error)
    res.status(500).json({ error: error.message })
  }
})


module.exports = router
