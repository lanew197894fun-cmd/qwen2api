const express = require('express')
const router = express.Router()
const { apiKeyVerify } = require('../middlewares/authorization.js')
const { handleCliChatCompletion } = require('../controllers/cli.chat.js')
const accountManager = require('../utils/account.js')

router.post('/cli/v1/chat/completions',
    apiKeyVerify,
    async (req, res, next) => {
        // 非同步初始化新帳號（不阻塞當前請求）
        const noCliAccount = accountManager.accountTokens.filter(account => !account.cli_info)
        if (noCliAccount.length > 0) {
            const randomNewAccount = noCliAccount[Math.floor(Math.random() * noCliAccount.length)]
            // 非同步初始化，不等待結果
            accountManager.initializeCliForAccount(randomNewAccount).catch(error => {
                console.error(`非同步初始化CLI帳戶失敗 (${randomNewAccount.email}):`, error)
            })
        }

        // 獲取當前可用的CLI帳戶用於本次請求
        const availableAccounts = accountManager.accountTokens.filter(account =>
            account.cli_info && account.cli_info.request_number < 2000
        )

        if (availableAccounts.length === 0) {
            return res.status(503).json({
                error: '沒有可用的CLI帳戶，請稍後重試'
            })
        }

        // 隨機選擇一個可用帳戶用於本次請求
        const randomAccount = availableAccounts[Math.floor(Math.random() * availableAccounts.length)]
        req.account = randomAccount
        next()
    },
    handleCliChatCompletion
)

module.exports = router