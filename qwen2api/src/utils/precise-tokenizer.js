/**
 * 精準Token統計工具
 * 使用tiktoken進行準確的token計數
 */

const tiktoken = require('tiktoken')

/**
 * 使用tiktoken進行精準token計數
 * @param {string} text - 要計數的文本
 * @param {string} model - 模型名稱，預設為gpt-3.5-turbo
 * @returns {number} 精確的token數量
 */
function countTokens(text, model = 'gpt-3.5-turbo') {
  if (!text || typeof text !== 'string') return 0

  const encoding = tiktoken.encoding_for_model(model)
  const tokens = encoding.encode(text)
  encoding.free() // 釋放記憶體
  return tokens.length
}



/**
 * 計算訊息陣列的token數量
 * @param {Array} messages - 訊息陣列
 * @param {string} model - 模型名稱
 * @returns {number} 總token數量
 */
function countMessagesTokens(messages, model = 'gpt-3.5-turbo') {
  if (!Array.isArray(messages)) return 0

  let totalTokens = 0

  // 每條訊息的基礎開銷（根據OpenAI檔案）
  const messageOverhead = 4 // 每條訊息約4個token的格式開銷

  for (const message of messages) {
    totalTokens += messageOverhead

    // 角色token
    if (message.role) {
      totalTokens += countTokens(message.role, model)
    }

    // 內容token
    if (typeof message.content === 'string') {
      totalTokens += countTokens(message.content, model)
    } else if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if (item.text) {
          totalTokens += countTokens(item.text, model)
        }
      }
    }

    // 函式呼叫等其他欄位的token計算
    if (message.function_call) {
      totalTokens += countTokens(JSON.stringify(message.function_call), model)
    }
  }

  // 對話的額外開銷
  totalTokens += 2 // 對話開始和結束的token

  return totalTokens
}

/**
 * 建立精準的usage物件
 * @param {Array|string} promptMessages - 提示訊息或文本
 * @param {string} completionText - 完成文本
 * @param {object} realUsage - 真實的usage資料（如果有）
 * @param {string} model - 模型名稱
 * @returns {object} usage物件
 */
function createUsageObject(promptMessages, completionText = '', realUsage = null, model = 'gpt-3.5-turbo') {
  // 如果有真實的usage資料，優先使用
  if (realUsage && realUsage.prompt_tokens && realUsage.completion_tokens) {
    return {
      prompt_tokens: realUsage.prompt_tokens,
      completion_tokens: realUsage.completion_tokens,
      total_tokens: realUsage.total_tokens || (realUsage.prompt_tokens + realUsage.completion_tokens)
    }
  }

  // 計算prompt tokens
  let promptTokens = 0
  if (Array.isArray(promptMessages)) {
    promptTokens = countMessagesTokens(promptMessages, model)
  } else if (typeof promptMessages === 'string') {
    promptTokens = countTokens(promptMessages, model)
  }

  // 計算completion tokens
  const completionTokens = countTokens(completionText, model)

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  }
}

module.exports = {
  countTokens,
  countMessagesTokens,
  createUsageObject
}
