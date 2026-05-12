const express = require('express')
const router = express.Router()
const config = require('../config')
const { apiKeyVerify, adminKeyVerify } = require('../middlewares/authorization')
const { logger } = require('../utils/logger')


router.get('/settings', adminKeyVerify, async (req, res) => {
  // 分離管理員金鑰和普通金鑰
  const regularKeys = config.apiKeys.filter(key => key !== config.adminKey)

  res.json({
    apiKey: config.apiKey, // 保持向後相容
    adminKey: config.adminKey,
    regularKeys: regularKeys,
    defaultHeaders: config.defaultHeaders,
    defaultCookie: config.defaultCookie,
    autoRefresh: config.autoRefresh,
    autoRefreshInterval: config.autoRefreshInterval,
    batchLoginConcurrency: config.batchLoginConcurrency,
    outThink: config.outThink,
    searchInfoMode: config.searchInfoMode,
    simpleModelMap: config.simpleModelMap
  })
})

// 新增普通API Key
router.post('/addRegularKey', adminKeyVerify, async (req, res) => {
  try {
    const { apiKey } = req.body
    if (!apiKey) {
      return res.status(400).json({ error: 'API Key不能為空' })
    }

    // 檢查是否已存在
    if (config.apiKeys.includes(apiKey)) {
      return res.status(409).json({ error: 'API Key已存在' })
    }

    // 新增到配置中
    config.apiKeys.push(apiKey)

    res.json({ message: 'API Key新增成功' })
  } catch (error) {
    logger.error('新增API Key失敗', 'CONFIG', '', error)
    res.status(500).json({ error: error.message })
  }
})

// 刪除普通API Key
router.post('/deleteRegularKey', adminKeyVerify, async (req, res) => {
  try {
    const { apiKey } = req.body
    if (!apiKey) {
      return res.status(400).json({ error: 'API Key不能為空' })
    }

    // 不能刪除管理員金鑰
    if (apiKey === config.adminKey) {
      return res.status(403).json({ error: '不能刪除管理員金鑰' })
    }

    // 從配置中移除
    const index = config.apiKeys.indexOf(apiKey)
    if (index === -1) {
      return res.status(404).json({ error: 'API Key不存在' })
    }

    config.apiKeys.splice(index, 1)

    res.json({ message: 'API Key刪除成功' })
  } catch (error) {
    logger.error('刪除API Key失敗', 'CONFIG', '', error)
    res.status(500).json({ error: error.message })
  }
})

// 更新自動重新整理設定
router.post('/setAutoRefresh', adminKeyVerify, async (req, res) => {
  try {
    const { autoRefresh, autoRefreshInterval } = req.body

    if (typeof autoRefresh !== 'boolean') {
      return res.status(400).json({ error: '無效的自動重新整理設定' })
    }

    if (autoRefreshInterval !== undefined) {
      const interval = parseInt(autoRefreshInterval)
      if (isNaN(interval) || interval < 0) {
        return res.status(400).json({ error: '無效的自動重新整理間隔' })
      }
    }
    config.autoRefresh = autoRefresh
    config.autoRefreshInterval = autoRefreshInterval || 6 * 60 * 60
    res.json({
      status: true,
      message: '自動重新整理設定更新成功'
    })
  } catch (error) {
    logger.error('更新自動重新整理設定失敗', 'CONFIG', '', error)
    res.status(500).json({ error: error.message })
  }
})

// 更新批次登入併發數
router.post('/setBatchLoginConcurrency', adminKeyVerify, async (req, res) => {
  try {
    const concurrency = parseInt(req.body.batchLoginConcurrency)

    if (isNaN(concurrency) || concurrency < 1 || concurrency > 20) {
      return res.status(400).json({ error: '無效的批次登入併發數，允許範圍為 1-20' })
    }

    config.batchLoginConcurrency = concurrency
    res.json({
      status: true,
      message: '批次登入併發數更新成功'
    })
  } catch (error) {
    logger.error('更新批次登入併發數失敗', 'CONFIG', '', error)
    res.status(500).json({ error: error.message })
  }
})

// 更新思考輸出設定
router.post('/setOutThink', adminKeyVerify, async (req, res) => {
  try {
    const { outThink } = req.body;
    if (typeof outThink !== 'boolean') {
      return res.status(400).json({ error: '無效的思考輸出設定' })
    }

    config.outThink = outThink
    res.json({
      status: true,
      message: '思考輸出設定更新成功'
    })
  } catch (error) {
    logger.error('更新思考輸出設定失敗', 'CONFIG', '', error)
    res.status(500).json({ error: error.message })
  }
})

// 更新搜尋資訊模式
router.post('/search-info-mode', adminKeyVerify, async (req, res) => {
  try {
    const { searchInfoMode } = req.body
    if (!['table', 'text'].includes(searchInfoMode)) {
      return res.status(400).json({ error: '無效的搜尋資訊模式' })
    }

    config.searchInfoMode = searchInfoMode
    res.json({
      status: true,
      message: '搜尋資訊模式更新成功'
    })
  } catch (error) {
    logger.error('更新搜尋資訊模式失敗', 'CONFIG', '', error)
    res.status(500).json({ error: error.message })
  }
})

// 更新簡化模型對映設定
router.post('/simple-model-map', adminKeyVerify, async (req, res) => {
  try {
    const { simpleModelMap } = req.body
    if (typeof simpleModelMap !== 'boolean') {
      return res.status(400).json({ error: '無效的簡化模型對映設定' })
    }

    config.simpleModelMap = simpleModelMap
    res.json({
      status: true,
      message: '簡化模型對映設定更新成功'
    })
  } catch (error) {
    logger.error('更新簡化模型對映設定失敗', 'CONFIG', '', error)
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
