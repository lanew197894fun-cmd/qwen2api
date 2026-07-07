const { generateUUID } = require("../utils/tools.js");
const {
  isChatType,
  isThinkingEnabled,
  parserModel,
  parserMessages,
} = require("../utils/chat-helpers.js");
const {
  buildToolSystemPrompt,
  foldToolMessages,
} = require("../utils/tool-prompt.js");
const { logger } = require("../utils/logger");

/**
 * 處理聊天請求體的中間件
 * 解析和轉換請求參數為內部格式
 */
const processRequestBody = async (req, res, next) => {
  try {
    // 取得請求體原始資料
    let {
      messages, // 訊息歷史
      model, // 模型
      stream, // 流式輸出
      enable_thinking, // 是否啟用思考
      thinking_budget, // 思考預算
      size, //圖片尺寸
      tools, // 工具列表（OpenAI function calling）
      tool_choice, // 工具調用控制
    } = req.body;

    const now = Math.floor(Date.now() / 1000);
    const fid = generateUUID();
    const thinkingConfig = isThinkingEnabled(
      model,
      enable_thinking,
      thinking_budget,
    );

    // 建置請求體 — 對齊 React 前端格式
    const body = {
      stream: stream !== false,
      version: "2.1",
      incremental_output: true,
      chat_id: null, // 由 sendChatRequest 填充
      chat_mode: "normal",
      model: await parserModel(model),
      parent_id: null,
      messages: [
        {
          fid: fid,
          parentId: null,
          childrenIds: [],
          role: "user", // 取最後一條訊息的角色
          content: "", // 由下方 parserMessages 填充
          user_action: "chat",
          files: [],
          timestamp: now,
          models: [await parserModel(model)],
          chat_type: isChatType(model),
          feature_config: {
            thinking_enabled: thinkingConfig.thinking_enabled,
            research_mode: "normal",
            auto_thinking: true,
            thinking_mode: "Auto",
            thinking_format: "detail",
            auto_search: true,
          },
          extra: { meta: { subChatType: isChatType(model) } },
          sub_chat_type: isChatType(model),
        },
      ],
      timestamp: now,
    };

    // 處理 stream 參數
    if (stream === true || stream === "true") {
      body.stream = true;
    } else {
      body.stream = false;
    }

    // 處理 tools 參數 : 通過提示詞為網頁版模型注入工具調用能力
    const chatType = isChatType(model);
    const hasTools =
      Array.isArray(tools) && tools.length > 0 && chatType === "t2t";
    let preparedMessages = messages;
    let toolSystemPrompt = "";
    if (hasTools) {
      toolSystemPrompt = buildToolSystemPrompt(tools, { tool_choice });
      preparedMessages = foldToolMessages(messages || []);
      req.has_tools = true;
      req.tool_choice = tool_choice || "auto";
    } else {
      req.has_tools = false;
    }

    // 處理 messages 參數 : 訊息歷史（回傳 OpenAI 格式訊息陣列）
    const parsedMessages = await parserMessages(
      preparedMessages,
      thinkingConfig,
      chatType,
    );

    // 將解析後的訊息填充到 React UI 格式的訊息物件中
    // 取最後一條使用者訊息作為主訊息內容，歷史訊息通過 content 傳遞
    const lastMessage = parsedMessages[parsedMessages.length - 1] || {
      role: "user",
      content: "",
    };
    body.messages[0].role = lastMessage.role || "user";
    body.messages[0].content = lastMessage.content || "";
    body.messages[0].chat_type = chatType;
    body.messages[0].sub_chat_type = chatType;
    body.messages[0].feature_config.thinking_enabled =
      thinkingConfig.thinking_enabled;

    // 工具提示詞拼接到使用者訊息內容上
    if (hasTools && toolSystemPrompt) {
      const msgContent = body.messages[0].content;
      if (typeof msgContent === "string") {
        body.messages[0].content = `${toolSystemPrompt}\n\n${msgContent}`;
      } else if (Array.isArray(msgContent)) {
        const textIdx = msgContent.findIndex((c) => c?.type === "text");
        if (textIdx >= 0) {
          msgContent[textIdx].text =
            `${toolSystemPrompt}\n\n${msgContent[textIdx].text || ""}`;
        } else {
          msgContent.unshift({ type: "text", text: toolSystemPrompt });
        }
      }
    }

    // 保存完整訊息歷史供下游使用（用於多輪對話上下文）
    req.parsed_messages = parsedMessages;
    req.enable_web_search = chatType === "search" ? true : false;
    // 保存 thinking 設定供 chat controller 使用
    req.enable_thinking = thinkingConfig.thinking_enabled;

    // 頂層 chat_type 供路由選擇器使用 (selectChatCompletion)
    body.chat_type = chatType;

    // 處理圖片尺寸
    if (size) {
      body.size = size;
    }

    // 處理請求體,將body賦值給req.body
    req.body = body;

    next();
  } catch (e) {
    logger.error("處理請求體時發生錯誤", "MIDDLEWARE", "", e);
    res.status(500).json({
      status: 500,
      message: "在處理請求體時發生錯誤 ~ ~ ~",
    });
  }
};

module.exports = {
  processRequestBody,
};
