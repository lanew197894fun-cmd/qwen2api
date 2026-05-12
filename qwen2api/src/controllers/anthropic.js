const { isJson, generateUUID } = require('../utils/tools.js');
const { createUsageObject } = require('../utils/precise-tokenizer.js');
const { sendChatRequest } = require('../utils/request.js');
const { isChatType, isThinkingEnabled, parserModel, parserMessages } = require('../utils/chat-helpers.js');
const {
  buildToolSystemPrompt,
  foldToolMessages,
  parseToolCallsFromText,
  createToolCallStreamParser
} = require('../utils/tool-prompt.js');
const { logger } = require('../utils/logger');

/**
 * Anthropic stop_reason 列舉
 * @typedef {('end_turn'|'tool_use'|'max_tokens'|'stop_sequence')} AnthropicStopReason
 */

/**
 * 將 Anthropic system 欄位規範為字串
 * @param {string|Array<Object>} system - Anthropic system
 * @returns {string} 合併後的 system 文本
 */
const normalizeAnthropicSystem = (system) => {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .filter(b => b && b.type === 'text')
      .map(b => b.text || '')
      .join('\n');
  }
  return '';
};

/**
 * 將 Anthropic tools 列表轉為 OpenAI 風格供 buildToolSystemPrompt 使用
 * @param {Array<Object>} tools - Anthropic 工具定義
 * @returns {Array<Object>} OpenAI 風格工具定義
 */
const normalizeAnthropicTools = (tools) => {
  if (!Array.isArray(tools)) return [];
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema || { type: 'object', properties: {} }
    }
  }));
};

/**
 * 將 Anthropic tool_choice 轉為內部統一形式
 * @param {Object} toolChoice - Anthropic tool_choice
 * @returns {string|Object|undefined} OpenAI 風格 tool_choice
 */
const normalizeAnthropicToolChoice = (toolChoice) => {
  if (!toolChoice || typeof toolChoice !== 'object') return undefined;
  if (toolChoice.type === 'auto') return 'auto';
  if (toolChoice.type === 'any') return 'required';
  if (toolChoice.type === 'tool' && toolChoice.name) {
    return { type: 'function', function: { name: toolChoice.name } };
  }
  if (toolChoice.type === 'none') return 'none';
  return undefined;
};

/**
 * 把 Anthropic 風格的訊息（含 content blocks 與 tool_use/tool_result）展開為
 * OpenAI 風格訊息列表。tool_use 轉為 assistant.tool_calls；tool_result 轉為
 * role=tool 訊息（保留 tool_call_id），後續由 foldToolMessages 摺疊。
 * @param {Array<Object>} messages - Anthropic messages
 * @returns {Array<Object>} OpenAI 風格 messages
 */
const flattenAnthropicMessages = (messages) => {
  if (!Array.isArray(messages)) return [];
  const out = [];

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const role = msg.role;

    if (typeof msg.content === 'string') {
      out.push({ role, content: msg.content });
      continue;
    }

    if (!Array.isArray(msg.content)) continue;

    if (role === 'assistant') {
      const textParts = [];
      const toolCalls = [];
      for (const block of msg.content) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text);
        } else if (block?.type === 'tool_use') {
          toolCalls.push({
            id: block.id || `toolu_${generateUUID().replace(/-/g, '').slice(0, 24)}`,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {})
            }
          });
        }
      }
      const out_msg = { role: 'assistant', content: textParts.join('') };
      if (toolCalls.length > 0) out_msg.tool_calls = toolCalls;
      out.push(out_msg);
      continue;
    }

    // user 角色：tool_result 拆為獨立 role=tool 訊息，普通文本/圖片合併保留
    const collectedTextParts = [];
    for (const block of msg.content) {
      if (block?.type === 'tool_result') {
        const resultContent = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.filter(b => b?.type === 'text').map(b => b.text || '').join('\n')
            : JSON.stringify(block.content ?? '');
        out.push({
          role: 'tool',
          tool_call_id: block.tool_use_id || '',
          content: resultContent
        });
      } else if (block?.type === 'text' && typeof block.text === 'string') {
        collectedTextParts.push(block.text);
      } else if (block?.type === 'image') {
        // 透傳 image 塊給現有 parserMessages 處理（OpenAI image_url 形態）
        const src = block.source || {};
        const url = src.type === 'base64' && src.data
          ? `data:${src.media_type || 'image/png'};base64,${src.data}`
          : (src.url || '');
        if (url) {
          if (collectedTextParts.length > 0) {
            out.push({
              role: 'user',
              content: [
                { type: 'text', text: collectedTextParts.join('') },
                { type: 'image_url', image_url: { url } }
              ]
            });
            collectedTextParts.length = 0;
          } else {
            out.push({ role: 'user', content: [{ type: 'image_url', image_url: { url } }] });
          }
        }
      }
    }
    if (collectedTextParts.length > 0) {
      out.push({ role: 'user', content: collectedTextParts.join('') });
    }
  }

  return out;
};

/**
 * 構造內部 Qwen 上游請求體
 * @param {Object} anthropicReq - Anthropic 風格請求體
 * @returns {Promise<{body: Object, hasTools: boolean, toolChoice: any, enable_thinking: boolean, model: string}>} 轉換結果
 */
const buildInternalRequest = async (anthropicReq) => {
  const { model, messages, system, tools, tool_choice, stream, thinking } = anthropicReq;

  const normalizedTools = normalizeAnthropicTools(tools);
  const internalToolChoice = normalizeAnthropicToolChoice(tool_choice);

  // 1. 展開 Anthropic 訊息（tool_use/tool_result 摺疊由 foldToolMessages 完成）
  let flat = flattenAnthropicMessages(messages);
  const systemText = normalizeAnthropicSystem(system);

  // 2. system 文本拼到首條使用者訊息內容字首（不要作為獨立 system 訊息，
  //    否則會被 parserMessages 摺疊為 "system:..." 文字字首汙染模型理解）
  const hasTools = normalizedTools.length > 0;
  const toolPrompt = hasTools ? buildToolSystemPrompt(normalizedTools, { tool_choice: internalToolChoice }) : '';

  if (hasTools) {
    flat = foldToolMessages(flat);
  }

  // 3. 走現有 parserMessages 複用圖片上傳與 thinking 配置
  const enable_thinking = !!(thinking && thinking.type === 'enabled');
  const thinkingCfg = isThinkingEnabled(model, enable_thinking, thinking?.budget_tokens);
  const chatType = isChatType(model);
  const parsedMessages = await parserMessages(flat, thinkingCfg, chatType);
  const parsedModel = await parserModel(model);

  // 4. 合併 system 文本與工具提示詞到終端使用者訊息開頭
  const prefixParts = [systemText, toolPrompt].filter(Boolean);
  if (prefixParts.length > 0 && Array.isArray(parsedMessages) && parsedMessages.length > 0) {
    const prefix = prefixParts.join('\n\n');
    const last = parsedMessages[parsedMessages.length - 1];
    if (typeof last.content === 'string') {
      last.content = `${prefix}\n\n${last.content}`;
    } else if (Array.isArray(last.content)) {
      const textIdx = last.content.findIndex(c => c && c.type === 'text');
      if (textIdx >= 0) {
        last.content[textIdx].text = `${prefix}\n\n${last.content[textIdx].text || ''}`;
      } else {
        last.content.unshift({
          type: 'text',
          text: prefix,
          chat_type: 't2t',
          feature_config: { output_schema: 'phase', thinking_enabled: false }
        });
      }
    }
  }

  const body = {
    stream: !!stream,
    incremental_output: true,
    chat_type: chatType,
    sub_chat_type: chatType,
    chat_mode: 'normal',
    model: parsedModel,
    messages: parsedMessages,
    session_id: generateUUID(),
    id: generateUUID()
  };

  return {
    body,
    hasTools,
    toolChoice: internalToolChoice,
    enable_thinking: thinkingCfg.thinking_enabled,
    model: parsedModel
  };
};

/**
 * 在請求體中追加用於 required 重試的強制提示
 * @param {Object} body - 內部請求體
 * @param {string} hint - 重試提示詞
 * @returns {Object} 新請求體
 */
const appendRetryHint = (body, hint) => ({
  ...body,
  messages: [
    ...(Array.isArray(body.messages) ? body.messages : []),
    { role: 'system', content: hint }
  ]
});

/**
 * 判斷 tool_choice 是否需要強制呼叫
 * @param {string|Object} toolChoice - 內部 tool_choice
 * @returns {boolean} 是否要求至少一次工具呼叫
 */
const requiresToolCall = (toolChoice) => {
  if (toolChoice === 'required') return true;
  if (toolChoice && typeof toolChoice === 'object' && toolChoice.function?.name) return true;
  return false;
};

/**
 * 構建 required 重試提示
 * @param {string|Object} toolChoice - 內部 tool_choice
 * @returns {string} 提示文本
 */
const buildRetryHint = (toolChoice) => {
  if (toolChoice && typeof toolChoice === 'object' && toolChoice.function?.name) {
    return `You did not call any tool. You MUST now call \`${toolChoice.function.name}\` using the <tool_call>...</tool_call> format.`;
  }
  return 'You did not call any tool. You MUST now call exactly one tool using the <tool_call>...</tool_call> format.';
};

/**
 * 非同步迭代上游 axios 流，按 SSE 段切分回撥內部 delta JSON
 * @param {object} upstream - axios stream 響應
 * @param {(json: Object) => Promise<void>|void} onDelta - 單個 delta 回撥
 * @returns {Promise<void>} 完成 Promise
 */
const consumeUpstream = (upstream, onDelta) => new Promise((resolve, reject) => {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  upstream.on('data', async (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    const segments = [];
    let startIndex = 0;
    while (true) {
      const dataStart = buffer.indexOf('data: ', startIndex);
      if (dataStart === -1) break;
      const dataEnd = buffer.indexOf('\n\n', dataStart);
      if (dataEnd === -1) break;
      segments.push(buffer.substring(dataStart, dataEnd).trim());
      startIndex = dataEnd + 2;
    }
    if (startIndex > 0) buffer = buffer.substring(startIndex);

    for (const seg of segments) {
      const payload = seg.replace('data: ', '');
      if (!isJson(payload)) continue;
      try {
        await onDelta(JSON.parse(payload));
      } catch (e) {
        logger.error('Anthropic 上游處理錯誤', 'ANTHROPIC', '', e);
      }
    }
  });
  upstream.on('end', () => resolve());
  upstream.on('error', err => reject(err));
});

/**
 * 把工具呼叫的 arguments JSON 字串切成 input_json_delta 切片
 * @param {string} argsJson - 完整 JSON 字串
 * @param {number} chunkSize - 單片大小
 * @returns {Array<string>} 切片列表
 */
const sliceArgsJson = (argsJson, chunkSize = 32) => {
  const out = [];
  for (let i = 0; i < argsJson.length; i += chunkSize) {
    out.push(argsJson.slice(i, i + chunkSize));
  }
  return out;
};

/**
 * 寫入一個 Anthropic SSE 事件
 * @param {object} res - Express 響應
 * @param {string} event - 事件名
 * @param {Object} data - 事件 payload
 */
const writeAnthropicEvent = (res, event, data) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

/**
 * 處理流式 Anthropic 響應
 * @param {object} res - Express 響應
 * @param {Object} ctx - 處理上下文
 * @param {object} upstream - 上游 axios 響應
 * @param {string} ctx.message_id - 訊息 ID
 * @param {string} ctx.model - 模型名
 * @param {boolean} ctx.hasTools - 是否啟用工具
 * @param {string|Object} ctx.toolChoice - 內部 tool_choice
 * @param {Object} ctx.requestBody - 內部請求體（用於重試）
 * @returns {Promise<void>} 完成 Promise
 */
const handleAnthropicStream = async (res, ctx, upstream) => {
  const { message_id, model, hasTools, toolChoice, requestBody } = ctx;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // message_start
  writeAnthropicEvent(res, 'message_start', {
    type: 'message_start',
    message: {
      id: message_id,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 }
    }
  });

  let blockIndex = -1;
  let textBlockOpen = false;
  let promptTokens = 0;
  let completionTokens = 0;

  const parser = hasTools ? createToolCallStreamParser() : null;

  /**
   * 關閉當前開啟的文本塊
   */
  const closeTextBlockIfOpen = () => {
    if (textBlockOpen) {
      writeAnthropicEvent(res, 'content_block_stop', { type: 'content_block_stop', index: blockIndex });
      textBlockOpen = false;
    }
  };

  /**
   * 輸出一段文本增量；按需開啟新文本塊
   * @param {string} text - 文本增量
   */
  const emitTextDelta = (text) => {
    if (!text) return;
    if (!textBlockOpen) {
      blockIndex += 1;
      writeAnthropicEvent(res, 'content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'text', text: '' }
      });
      textBlockOpen = true;
    }
    writeAnthropicEvent(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: blockIndex,
      delta: { type: 'text_delta', text }
    });
  };

  /**
   * 輸出一個完整的 tool_use 塊（按 input_json_delta 切片）
   * @param {Object} call - 工具呼叫
   */
  const emitToolUse = (call) => {
    closeTextBlockIfOpen();
    blockIndex += 1;
    writeAnthropicEvent(res, 'content_block_start', {
      type: 'content_block_start',
      index: blockIndex,
      content_block: { type: 'tool_use', id: call.id, name: call.function.name, input: {} }
    });
    const args = call.function.arguments || '{}';
    for (const piece of sliceArgsJson(args)) {
      writeAnthropicEvent(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'input_json_delta', partial_json: piece }
      });
    }
    writeAnthropicEvent(res, 'content_block_stop', { type: 'content_block_stop', index: blockIndex });
  };

  let completionContent = '';
  let webSearchInfo = null;
  let thinkingStarted = false;
  let thinkingEnded = false;

  /**
   * 處理一個上游 delta JSON
   * @param {Object} json - 上游 SSE delta
   */
  const onUpstreamDelta = async (json) => {
    if (!json.choices || json.choices.length === 0) return;
    if (json.usage) {
      promptTokens = json.usage.prompt_tokens || promptTokens;
      completionTokens = json.usage.completion_tokens || completionTokens;
    }
    const delta = json.choices[0].delta;
    if (delta && delta.name === 'web_search') {
      webSearchInfo = delta.extra?.web_search_info;
    }
    if (!delta || !delta.content || (delta.phase !== 'think' && delta.phase !== 'answer')) return;

    let content = delta.content;
    completionContent += content;

    if (delta.phase === 'think' && !thinkingStarted) {
      thinkingStarted = true;
      content = `<think>\n\n${content}`;
    }
    if (delta.phase === 'answer' && !thinkingEnded && thinkingStarted) {
      thinkingEnded = true;
      content = `\n\n</think>\n${content}`;
    }

    if (parser && delta.phase === 'answer') {
      const parsed = parser.push(content);
      if (parsed.textDelta) emitTextDelta(parsed.textDelta);
      for (const call of parsed.completedCalls) emitToolUse(call);
    } else {
      emitTextDelta(content);
    }
  };

  await consumeUpstream(upstream, onUpstreamDelta);

  // required 重試
  if (parser && !parser.hasEmittedAnyCall() && requiresToolCall(toolChoice)) {
    const retryBody = appendRetryHint(requestBody, buildRetryHint(toolChoice));
    logger.warning?.('Anthropic 流式: tool_choice=required 首次未觸發，重試一次', 'ANTHROPIC');
    try {
      const retryResp = await sendChatRequest(retryBody);
      if (retryResp.status && retryResp.response) {
        await consumeUpstream(retryResp.response, onUpstreamDelta);
      }
    } catch (e) {
      logger.error('Anthropic 流式重試失敗', 'ANTHROPIC', '', e);
    }
  }

  if (parser) {
    const tail = parser.flush();
    if (tail.textDelta) emitTextDelta(tail.textDelta);
    for (const call of tail.completedCalls) emitToolUse(call);
  }

  closeTextBlockIfOpen();

  const stopReason = (parser && parser.hasEmittedAnyCall()) ? 'tool_use' : 'end_turn';

  if (promptTokens === 0 && completionTokens === 0) {
    const usage = createUsageObject(requestBody?.messages || '', completionContent, null);
    promptTokens = usage.prompt_tokens || 0;
    completionTokens = usage.completion_tokens || 0;
  }

  writeAnthropicEvent(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { input_tokens: promptTokens, output_tokens: completionTokens }
  });
  writeAnthropicEvent(res, 'message_stop', { type: 'message_stop' });
  res.end();
};

/**
 * 處理非流式 Anthropic 響應
 * @param {object} res - Express 響應
 * @param {Object} ctx - 處理上下文
 * @param {object} upstream - 上游 axios 響應
 * @returns {Promise<void>} 完成 Promise
 */
const handleAnthropicNonStream = async (res, ctx, upstream) => {
  const { message_id, model, hasTools, toolChoice, requestBody } = ctx;

  let fullContent = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let thinkingStarted = false;
  let thinkingEnded = false;

  /**
   * 處理一個上游 delta JSON 並累積 fullContent
   * @param {Object} json - 上游 SSE delta
   */
  const onUpstreamDelta = async (json) => {
    if (!json.choices || json.choices.length === 0) return;
    if (json.usage) {
      promptTokens = json.usage.prompt_tokens || promptTokens;
      completionTokens = json.usage.completion_tokens || completionTokens;
    }
    const delta = json.choices[0].delta;
    if (!delta || !delta.content || (delta.phase !== 'think' && delta.phase !== 'answer')) return;
    let content = delta.content;
    if (delta.phase === 'think' && !thinkingStarted) {
      thinkingStarted = true;
      content = `<think>\n\n${content}`;
    }
    if (delta.phase === 'answer' && !thinkingEnded && thinkingStarted) {
      thinkingEnded = true;
      content = `\n\n</think>\n${content}`;
    }
    fullContent += content;
  };

  await consumeUpstream(upstream, onUpstreamDelta);

  let { cleanedText, toolCalls } = hasTools
    ? parseToolCallsFromText(fullContent)
    : { cleanedText: fullContent, toolCalls: [] };

  // required 重試
  if (hasTools && toolCalls.length === 0 && requiresToolCall(toolChoice)) {
    logger.warning?.('Anthropic 非流式: tool_choice=required 首次未觸發，重試一次', 'ANTHROPIC');
    try {
      const retryResp = await sendChatRequest(appendRetryHint(requestBody, buildRetryHint(toolChoice)));
      if (retryResp.status && retryResp.response) {
        const before = fullContent;
        await consumeUpstream(retryResp.response, onUpstreamDelta);
        const retried = fullContent.slice(before.length);
        const parsedRetry = parseToolCallsFromText(retried);
        if (parsedRetry.toolCalls.length > 0) {
          toolCalls = parsedRetry.toolCalls;
          cleanedText = parseToolCallsFromText(fullContent).cleanedText;
        }
      }
    } catch (e) {
      logger.error('Anthropic 非流式重試失敗', 'ANTHROPIC', '', e);
    }
  }

  if (promptTokens === 0 && completionTokens === 0) {
    const usage = createUsageObject(requestBody?.messages || '', fullContent, null);
    promptTokens = usage.prompt_tokens || 0;
    completionTokens = usage.completion_tokens || 0;
  }

  const contentBlocks = [];
  if (cleanedText && cleanedText.trim()) {
    contentBlocks.push({ type: 'text', text: cleanedText });
  }
  for (const call of toolCalls) {
    let input = {};
    try { input = JSON.parse(call.function.arguments || '{}'); } catch (_) { input = {}; }
    contentBlocks.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input
    });
  }

  res.set({ 'Content-Type': 'application/json' });
  res.json({
    id: message_id,
    type: 'message',
    role: 'assistant',
    model,
    content: contentBlocks,
    stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: promptTokens, output_tokens: completionTokens }
  });
};

/**
 * Anthropic /v1/messages 主入口
 * @param {object} req - Express 請求
 * @param {object} res - Express 響應
 */
const handleAnthropicMessages = async (req, res) => {
  try {
    const built = await buildInternalRequest(req.body || {});
    const { body, hasTools, toolChoice, model } = built;

    const upstreamResp = await sendChatRequest(body);
    if (!upstreamResp.status || !upstreamResp.response) {
      return res.status(500).json({
        type: 'error',
        error: { type: 'api_error', message: '請求傳送失敗' }
      });
    }

    const message_id = `msg_${generateUUID().replace(/-/g, '').slice(0, 24)}`;
    const ctx = { message_id, model, hasTools, toolChoice, requestBody: body };

    if (req.body?.stream) {
      await handleAnthropicStream(res, ctx, upstreamResp.response);
    } else {
      await handleAnthropicNonStream(res, ctx, upstreamResp.response);
    }
  } catch (error) {
    logger.error('Anthropic Messages 處理錯誤', 'ANTHROPIC', '', error);
    if (!res.headersSent) {
      res.status(500).json({
        type: 'error',
        error: { type: 'api_error', message: '服務錯誤' }
      });
    } else {
      try { res.end(); } catch (_) { /* ignore */ }
    }
  }
};

module.exports = {
  handleAnthropicMessages,
  // 暴露內部輔助以便測試
  flattenAnthropicMessages,
  normalizeAnthropicTools,
  normalizeAnthropicToolChoice,
  normalizeAnthropicSystem
};
