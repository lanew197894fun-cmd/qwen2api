const { generateUUID } = require('../utils/tools.js')
const { isChatType, isThinkingEnabled, parserModel, parserMessages } = require('../utils/chat-helpers.js')
const { buildToolSystemPrompt, foldToolMessages } = require('../utils/tool-prompt.js')
const { logger } = require('../utils/logger')

/**
 * 處理聊天請求體的中介軟體
 * 解析和轉換請求引數為內部格式
 */
const processRequestBody = async (req, res, next) => {
  try {
    // 構建請求體
    const body = {
      "stream": true,
      "incremental_output": true,
      "chat_type": "t2t",
      "model": "qwen3-235b-a22b",
      "messages": [],
      "session_id": generateUUID(),
      "id": generateUUID(),
      "sub_chat_type": "t2t",
      "chat_mode": "normal"
    }

    // 獲取請求體原始資料
    let {
      messages,            // 訊息歷史
      model,               // 模型
      stream,              // 流式輸出
      enable_thinking,     // 是否啟用思考
      thinking_budget,      // 思考預算
      size,                  //圖片尺寸
      tools,                // 工具列表（OpenAI function calling）
      tool_choice           // 工具呼叫控制
    } = req.body

    // 處理 stream 引數
    if (stream === true || stream === 'true') {
      body.stream = true
    } else {
      body.stream = false
    }

    // 處理 chat_type 引數 : 聊天型別
    body.chat_type = isChatType(model)

    req.enable_web_search = body.chat_type === 'search' ? true : false

    // 處理 model 引數 : 模型
    body.model = await parserModel(model)

    // 處理 tools 引數 : 通過提示詞為網頁版模型注入工具呼叫能力
    const hasTools = Array.isArray(tools) && tools.length > 0 && body.chat_type === 't2t'
    let preparedMessages = messages
    let toolSystemPrompt = ''
    if (hasTools) {
      toolSystemPrompt = buildToolSystemPrompt(tools, { tool_choice })
      // 僅摺疊 assistant.tool_calls / role=tool 歷史，不在此插入 system 訊息，
      // 避免被下游 parserMessages 摺疊成 "system:<提示詞>;user:..." 幹擾模型理解。
      preparedMessages = foldToolMessages(messages || [])
      req.has_tools = true
      req.tool_choice = tool_choice || 'auto'
    } else {
      req.has_tools = false
    }

    // 處理 messages 引數 : 訊息歷史
    body.messages = await parserMessages(preparedMessages, isThinkingEnabled(model, enable_thinking, thinking_budget), body.chat_type)

    // 工具提示詞在 parserMessages 摺疊完成後，作為字首拼接到終端使用者訊息內容上，
    // 這樣既不會被角色字首汙染，也能讓模型在每一輪都看到完整工具說明。
    if (hasTools && toolSystemPrompt && Array.isArray(body.messages) && body.messages.length > 0) {
      const last = body.messages[body.messages.length - 1]
      if (typeof last.content === 'string') {
        last.content = `${toolSystemPrompt}\n\n${last.content}`
      } else if (Array.isArray(last.content)) {
        const textIdx = last.content.findIndex(c => c?.type === 'text')
        if (textIdx >= 0) {
          last.content[textIdx].text = `${toolSystemPrompt}\n\n${last.content[textIdx].text || ''}`
        } else {
          last.content.unshift({
            type: 'text',
            text: toolSystemPrompt,
            chat_type: 't2t',
            feature_config: { output_schema: 'phase', thinking_enabled: false }
          })
        }
      }
    }
    
    // 處理 enable_thinking 引數 : 是否啟用思考
    req.enable_thinking = isThinkingEnabled(model, enable_thinking, thinking_budget).thinking_enabled
    
    // 處理 sub_chat_type 引數 : 子聊天型別
    body.sub_chat_type = body.chat_type

    // 處理圖片尺寸
    if (size) {
      body.size = size
    }

    // 處理請求體,將body賦值給req.body
    req.body = body

    next()
  } catch (e) {
    logger.error('處理請求體時發生錯誤', 'MIDDLEWARE', '', e)
    res.status(500)
      .json({
        status: 500,
        message: "在處理請求體時發生錯誤 ~ ~ ~"
      })
  }
}

module.exports = {
  processRequestBody
}
