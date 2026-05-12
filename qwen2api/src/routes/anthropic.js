const express = require('express');
const router = express.Router();
const { apiKeyVerify } = require('../middlewares/authorization.js');
const { handleAnthropicMessages } = require('../controllers/anthropic.js');

router.post('/v1/messages',
  apiKeyVerify,
  handleAnthropicMessages
);

module.exports = router;
