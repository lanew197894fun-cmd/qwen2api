const express = require('express')
const router = express.Router()
const { apiKeyVerify } = require('../middlewares/authorization')
const { handleGetModels } = require('../controllers/models.js')

router.get('/v1/models', apiKeyVerify, handleGetModels)

router.get('/models', handleGetModels)

const handleCliModels = async (req, res) => {
    res.json({
        object: 'list',
        data: [
            {
                id: 'coder-model',
                object: 'model',
                created: 1719878112,
                owned_by: 'qwen-code'
            },
            {
                id: 'qwen3.6-plus',
                object: 'model',
                created: 1719878112,
                owned_by: 'qwen-code'
            },
        ]
    })
}

router.get('/cli/v1/models', apiKeyVerify, handleCliModels)
router.post('/cli/v1/models', apiKeyVerify, handleCliModels)


module.exports = router
