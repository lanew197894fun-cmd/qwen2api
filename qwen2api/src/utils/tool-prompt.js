const { generateUUID } = require('./tools.js');
const { logger } = require('./logger');

/**
 * 工具呼叫 XML 起始標籤
 * @type {string}
 */
const TOOL_CALL_OPEN = '<tool_call>';

/**
 * 工具呼叫 XML 結束標籤
 * @type {string}
 */
const TOOL_CALL_CLOSE = '</tool_call>';

/**
 * 將 JSON Schema 型別壓縮為簡短 TypeScript 風格簽名
 * @param {Object} schema - JSON Schema 節點
 * @returns {string} TS 風格型別表示
 */
const compressSchemaType = (schema) => {
  if (!schema || typeof schema !== 'object') {
    return 'any';
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map(value => JSON.stringify(value)).join(' | ');
  }

  const type = schema.type;

  if (type === 'array') {
    const itemType = compressSchemaType(schema.items);
    return `${itemType}[]`;
  }

  if (type === 'object') {
    if (!schema.properties || typeof schema.properties !== 'object') {
      return 'object';
    }
    const requiredKeys = new Set(Array.isArray(schema.required) ? schema.required : []);
    const fields = Object.entries(schema.properties).map(([key, value]) => {
      const optional = requiredKeys.has(key) ? '' : '?';
      return `${key}${optional}: ${compressSchemaType(value)}`;
    });
    return `{ ${fields.join('; ')} }`;
  }

  if (Array.isArray(type)) {
    return type.map(t => compressSchemaType({ ...schema, type: t })).join(' | ');
  }

  return type || 'any';
};

/**
 * 將單個工具定義壓縮為 TS 風格簽名
 * @param {Object} tool - OpenAI 工具定義
 * @returns {string} 壓縮後的工具描述
 */
const compressToolDefinition = (tool) => {
  const fn = tool?.function || tool;
  const name = fn?.name || 'unknown';
  const description = (fn?.description || '').trim();
  const params = fn?.parameters || { type: 'object', properties: {} };
  const signature = compressSchemaType(params);

  if (description) {
    return `- ${name}${signature}\n  ${description}`;
  }
  return `- ${name}${signature}`;
};

/**
 * 構建用於注入 system 訊息的工具呼叫提示詞
 * @param {Array<Object>} tools - OpenAI 風格工具定義列表
 * @param {Object} [options] - 可選引數
 * @param {string|Object} [options.tool_choice] - OpenAI tool_choice 引數
 * @returns {string} 完整的工具呼叫系統提示詞
 */
const buildToolSystemPrompt = (tools, options = {}) => {
  if (!Array.isArray(tools) || tools.length === 0) {
    return '';
  }

  const compressed = tools
    .map(compressToolDefinition)
    .filter(Boolean)
    .join('\n');

  const lines = [
    '# Tools',
    '',
    'You have access to the following tools. When a tool call is needed, output a `<tool_call>` block exactly as shown below.',
    '',
    '## Available tools',
    compressed,
    '',
    '## Output format',
    'Emit each tool invocation as:',
    '',
    '<tool_call>',
    '{"name": "<tool_name>", "arguments": {<json_arguments>}}',
    '</tool_call>',
    '',
    'Tool results are delivered back to you as user messages wrapped like this:',
    '',
    '<tool_response tool_call_id="<id>" name="<tool_name>">',
    '<result text or JSON>',
    '</tool_response>',
    '',
    'Rules:',
    '- The JSON inside `<tool_call>` must be valid and on a single logical block.',
    '- Use the exact tool name listed above.',
    '- Provide all required arguments; omit unknown ones.',
    '- You may emit multiple `<tool_call>` blocks back-to-back when more than one tool is needed.',
    '- After tool results are returned (as user/tool messages), continue the reply normally.',
    '- Do not wrap `<tool_call>` blocks in code fences or extra commentary.'
  ];

  const choice = options.tool_choice;
  if (choice === 'required') {
    lines.push('- You MUST call at least one tool before answering.');
  } else if (choice && typeof choice === 'object' && choice.function?.name) {
    lines.push(`- You MUST call the tool \`${choice.function.name}\` first.`);
  } else if (choice === 'none') {
    lines.push('- Do NOT call any tool for this turn; respond as plain text.');
  }

  return lines.join('\n');
};

/**
 * 將歷史中的 assistant tool_calls / tool 角色訊息摺疊成純文本，
 * 以便上游網頁介面（僅識別 user/assistant/system）能正確接收上下文。
 * 摺疊時保留原始 tool_call_id，並將後續 role=tool 訊息按 id 精確回鏈。
 * @param {Array<Object>} messages - 原始 OpenAI 風格訊息陣列
 * @returns {Array<Object>} 摺疊後的訊息陣列
 */
const foldToolMessages = (messages) => {
  if (!Array.isArray(messages)) return messages;

  const callIdToName = new Map();

  return messages.map((message) => {
    if (!message || typeof message !== 'object') return message;

    if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const blocks = message.tool_calls.map((call) => {
        let args = call?.function?.arguments;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch (_) {
            // 保留原始字串形式
          }
        }
        const name = call?.function?.name || 'unknown';
        const id = call?.id || `call_${generateUUID().replace(/-/g, '').slice(0, 24)}`;
        callIdToName.set(id, name);
        const payload = { id, name, arguments: args ?? {} };
        return `${TOOL_CALL_OPEN}\n${JSON.stringify(payload)}\n${TOOL_CALL_CLOSE}`;
      });
      const original = typeof message.content === 'string' ? message.content : '';
      return {
        role: 'assistant',
        content: [original, blocks.join('\n')].filter(Boolean).join('\n')
      };
    }

    if (message.role === 'tool') {
      const callId = message.tool_call_id || '';
      const name = message.name || callIdToName.get(callId) || 'tool';
      const content = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content ?? '');
      const idAttr = callId ? ` tool_call_id="${escapeAttr(callId)}"` : '';
      return {
        role: 'user',
        content: `<tool_response${idAttr} name="${escapeAttr(name)}">\n${content}\n</tool_response>`
      };
    }

    return message;
  });
};

/**
 * 轉義 XML 屬性中的特殊字元
 * @param {string} value - 原始字串
 * @returns {string} 轉義後的字串
 */
const escapeAttr = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/**
 * 解析單段 `<tool_call>...</tool_call>` 內的 JSON 負載
 * @param {string} raw - 標籤內的原始字串
 * @returns {{ name: string, arguments: Object }|null} 解析結果
 */
const parseToolCallPayload = (raw) => {
  if (!raw) return null;

  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    const name = parsed.name || parsed.tool || parsed.function;
    const args = parsed.arguments ?? parsed.parameters ?? parsed.args ?? {};
    if (!name) return null;
    return { name: String(name), arguments: args };
  } catch (error) {
    logger.warning?.('解析 tool_call 負載失敗', 'TOOL', text, error?.message);
    return null;
  }
};

/**
 * 從完整文本中提取所有工具呼叫塊
 * @param {string} fullText - 模型完整輸出
 * @returns {{ cleanedText: string, toolCalls: Array<Object> }} 抽取結果
 */
const parseToolCallsFromText = (fullText) => {
  if (typeof fullText !== 'string' || !fullText.includes(TOOL_CALL_OPEN)) {
    return { cleanedText: fullText || '', toolCalls: [] };
  }

  const toolCalls = [];
  const pattern = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  const cleanedText = fullText.replace(pattern, (_, inner) => {
    const payload = parseToolCallPayload(inner);
    if (payload) {
      toolCalls.push({
        id: `call_${generateUUID().replace(/-/g, '').slice(0, 24)}`,
        type: 'function',
        function: {
          name: payload.name,
          arguments: JSON.stringify(payload.arguments ?? {})
        }
      });
    }
    return '';
  });

  return { cleanedText: cleanedText.trim(), toolCalls };
};

/**
 * 建立增量式工具呼叫流解析器
 * 接收 content delta，識別 `<tool_call>` 塊邊界，
 * 對外吐出文本增量與已完成的工具呼叫物件。
 * @returns {{
 *   push: (chunk: string) => { textDelta: string, completedCalls: Array<Object> },
 *   flush: () => { textDelta: string, completedCalls: Array<Object> },
 *   hasPendingCall: () => boolean,
 *   hasEmittedAnyCall: () => boolean
 * }} 解析器例項
 */
const createToolCallStreamParser = () => {
  let pendingText = '';
  let inToolCall = false;
  let toolCallBuffer = '';
  let emittedCallCount = 0;

  /**
   * 在等待標籤出現時，安全地輸出已確定不是標籤字首的部分
   * @param {string} text - 當前累積的文本
   * @returns {{ safe: string, remainder: string }} 切分結果
   */
  const splitSafeText = (text) => {
    const openIdx = text.indexOf(TOOL_CALL_OPEN);
    if (openIdx !== -1) {
      return { safe: text.slice(0, openIdx), remainder: text.slice(openIdx) };
    }
    const maxCheck = Math.min(text.length, TOOL_CALL_OPEN.length - 1);
    for (let len = maxCheck; len > 0; len--) {
      const tail = text.slice(text.length - len);
      if (TOOL_CALL_OPEN.startsWith(tail)) {
        return { safe: text.slice(0, text.length - len), remainder: tail };
      }
    }
    return { safe: text, remainder: '' };
  };

  const push = (chunk) => {
    const result = { textDelta: '', completedCalls: [] };
    if (typeof chunk !== 'string' || chunk.length === 0) return result;

    let buffer = chunk;

    while (buffer.length > 0) {
      if (inToolCall) {
        toolCallBuffer += buffer;
        buffer = '';
        const closeIdx = toolCallBuffer.indexOf(TOOL_CALL_CLOSE);
        if (closeIdx === -1) {
          break;
        }
        const inner = toolCallBuffer.slice(0, closeIdx);
        buffer = toolCallBuffer.slice(closeIdx + TOOL_CALL_CLOSE.length);
        toolCallBuffer = '';
        const payload = parseToolCallPayload(inner);
        if (payload) {
          result.completedCalls.push({
            index: emittedCallCount,
            id: `call_${generateUUID().replace(/-/g, '').slice(0, 24)}`,
            type: 'function',
            function: {
              name: payload.name,
              arguments: JSON.stringify(payload.arguments ?? {})
            }
          });
          emittedCallCount += 1;
        }
        inToolCall = false;
        continue;
      }

      pendingText += buffer;
      buffer = '';

      const openIdx = pendingText.indexOf(TOOL_CALL_OPEN);
      if (openIdx !== -1) {
        const before = pendingText.slice(0, openIdx);
        if (before) result.textDelta += before;
        const tail = pendingText.slice(openIdx + TOOL_CALL_OPEN.length);
        pendingText = '';
        inToolCall = true;
        buffer = tail;
        continue;
      }

      const { safe, remainder } = splitSafeText(pendingText);
      if (safe) result.textDelta += safe;
      pendingText = remainder;
    }

    return result;
  };

  const flush = () => {
    const result = { textDelta: '', completedCalls: [] };
    if (inToolCall && toolCallBuffer) {
      const payload = parseToolCallPayload(toolCallBuffer);
      if (payload) {
        result.completedCalls.push({
          index: emittedCallCount,
          id: `call_${generateUUID().replace(/-/g, '').slice(0, 24)}`,
          type: 'function',
          function: {
            name: payload.name,
            arguments: JSON.stringify(payload.arguments ?? {})
          }
        });
        emittedCallCount += 1;
      }
      toolCallBuffer = '';
      inToolCall = false;
    }
    if (pendingText) {
      result.textDelta += pendingText;
      pendingText = '';
    }
    return result;
  };

  return {
    push,
    flush,
    hasPendingCall: () => inToolCall,
    hasEmittedAnyCall: () => emittedCallCount > 0
  };
};

module.exports = {
  TOOL_CALL_OPEN,
  TOOL_CALL_CLOSE,
  buildToolSystemPrompt,
  foldToolMessages,
  parseToolCallsFromText,
  createToolCallStreamParser
};
