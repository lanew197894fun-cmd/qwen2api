const { isJson, generateUUID } = require("../utils/tools.js");
const { createUsageObject } = require("../utils/precise-tokenizer.js");
const { sendChatRequest } = require("../utils/request.js");
const {
  createToolCallStreamParser,
  parseToolCallsFromText,
} = require("../utils/tool-prompt.js");
const accountManager = require("../utils/account.js");
const config = require("../config/index.js");
const axios = require("axios");
const { logger } = require("../utils/logger");

// ═══ ⚡ SSE 安全寫入 — 檢查 res.destroyed/res.writable，避免 client 斷線後 hang ═══
const safeWrite = (res, data) => {
  try {
    if (!res.destroyed && res.writable) {
      res.write(data);
      return true;
    }
  } catch {
    /* client 已斷線 */
  }
  return false;
};
const safeEnd = (res) => {
  try {
    if (!res.destroyed && res.writable) res.end();
  } catch {}
};

/**
 * 設定回應頭
 * @param {object} res - Express 回應物件
 * @param {boolean} stream - 是否流式回應
 */
const setResponseHeaders = (res, stream) => {
  try {
    if (stream) {
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
    } else {
      res.set({
        "Content-Type": "application/json",
      });
    }
  } catch (e) {
    logger.error("處理聊天請求時發生錯誤", "CHAT", "", e);
  }
};

const getImageMarkdownListFromDelta = (delta) => {
  // 常規聊天在觸發 image_gen_tool 時，僅使用 image_list 中用於展示的圖片連結
  const imageList = [];
  const displayImages = delta?.extra?.image_list || [];

  for (const item of displayImages) {
    if (item?.image) {
      imageList.push(`![image](${item.image})`);
    }
  }

  return imageList;
};

/**
 * 判斷 tool_choice 是否要求強制調用工具
 * @param {string|Object} toolChoice - OpenAI tool_choice
 * @returns {boolean} 是否需要至少一次工具調用
 */
const requiresToolCall = (toolChoice) => {
  if (toolChoice === "required") return true;
  if (
    toolChoice &&
    typeof toolChoice === "object" &&
    toolChoice.type === "function" &&
    toolChoice.function?.name
  ) {
    return true;
  }
  return false;
};

/**
 * 建置 tool_choice=required 重試時追加的強約束提示
 * @param {string|Object} toolChoice - OpenAI tool_choice
 * @returns {string} 重試提示詞
 */
const buildRequiredRetryHint = (toolChoice) => {
  if (
    toolChoice &&
    typeof toolChoice === "object" &&
    toolChoice.function?.name
  ) {
    return `You did not call any tool in your previous reply. You MUST now call the tool \`${toolChoice.function.name}\` using the <tool_call>...</tool_call> format and nothing else.`;
  }
  return "You did not call any tool in your previous reply. You MUST now call exactly one tool using the <tool_call>...</tool_call> format and nothing else.";
};

/**
 * 處理流式回應
 * @param {object} res - Express 回應物件
 * @param {object} response - 上游回應流
 * @param {boolean} enable_thinking - 是否啟用思考模式
 * @param {boolean} enable_web_search - 是否啟用網絡搜索
 * @param {object} requestBody - 原始請求體，用於提取prompt資訊
 * @param {object} [options] - 擴展選項
 * @param {boolean} [options.has_tools] - 是否啟用工具調用解析
 * @param {string|Object} [options.tool_choice] - OpenAI tool_choice 控制項
 */
/**
 * 安全累計 stats——任何異常都吞掉，不影響回應給客戶端
 * @param {Object} account - 目前賬戶物件（含 email）
 * @param {Object} usage - { prompt_tokens, completion_tokens }
 */
const attributeChatUsage = (account, usage) => {
  if (!account || !account.email || !usage) return;
  try {
    accountManager.accumulateStats(account.email, "chat", {
      input: Number(usage.prompt_tokens) || 0,
      output: Number(usage.completion_tokens) || 0,
    });
  } catch (e) {
    // 靜默——stats 累計失敗不應中斷回應
  }
};

const handleStreamResponse = async (
  res,
  response,
  enable_thinking,
  enable_web_search,
  requestBody = null,
  options = {},
) => {
  try {
    const message_id = generateUUID();
    let web_search_info = null;
    let thinking_start = false;
    let thinking_end = false;
    let emittedImageMarkdownSet = new Set();
    let pendingImageMarkdownList = [];

    const hasTools = !!options.has_tools;
    const toolChoice = options.tool_choice;
    const toolParser = hasTools ? createToolCallStreamParser() : null;

    // Token消耗量統計
    let totalTokens = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
    let completionContent = ""; // 收集完整的回覆內容用於token估算

    // ═══ <think> 標籤流解析狀態（fallback：當上游無 phase 欄位時使用） ═══
    let thinkActive = false;
    let thinkBuf = "";

    // 提取prompt文本用於token估算
    let promptText = "";
    if (requestBody && requestBody.messages) {
      promptText = requestBody.messages
        .map((msg) => {
          if (typeof msg.content === "string") {
            return msg.content;
          } else if (Array.isArray(msg.content)) {
            return msg.content.map((item) => item.text || "").join("");
          }
          return "";
        })
        .join("\n");
    }

    /**
     * 寫一個標準 OpenAI 文本增量（使用 safeWrite 避免 client 斷線 hang）
     * @param {string} text - 文本內容
     */
    const writeContentDelta = (text) => {
      if (!text) return;
      safeWrite(
        res,
        `data: ${JSON.stringify({
          id: `chatcmpl-${message_id}`,
          object: "chat.completion.chunk",
          created: Math.round(new Date().getTime() / 1000),
          choices: [
            {
              index: 0,
              delta: { content: text },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
    };

    /**
     * 寫一個 reasoning_content 增量（OpenAI 思考模式標準欄位）
     * @param {string} text - 思考文本內容
     */
    const writeReasoningDelta = (text) => {
      if (!text) return;
      safeWrite(
        res,
        `data: ${JSON.stringify({
          id: `chatcmpl-${message_id}`,
          object: "chat.completion.chunk",
          created: Math.round(new Date().getTime() / 1000),
          choices: [
            {
              index: 0,
              delta: { content: "", reasoning_content: text },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
    };

    /**
     * 寫一個工具調用增量，按 OpenAI 規範分片（使用 safeWrite）
     *   1) 頭塊：包含 index/id/type 與 function.name + 空 arguments
     *   2) 多個參數塊：function.arguments 切片
     * @param {Array<Object>} calls - 已完成的工具調用列表
     */
    const writeToolCallsDelta = (calls) => {
      if (!calls || calls.length === 0) return;
      const ARG_CHUNK_SIZE = 32;

      for (const call of calls) {
        const headerDelta = {
          id: `chatcmpl-${message_id}`,
          object: "chat.completion.chunk",
          created: Math.round(new Date().getTime() / 1000),
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: call.index,
                    id: call.id,
                    type: "function",
                    function: {
                      name: call.function.name,
                      arguments: "",
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        };
        if (!safeWrite(res, `data: ${JSON.stringify(headerDelta)}\n\n`)) return;

        const argsString = call.function.arguments || "";
        for (
          let offset = 0;
          offset < argsString.length;
          offset += ARG_CHUNK_SIZE
        ) {
          const piece = argsString.slice(offset, offset + ARG_CHUNK_SIZE);
          const argDelta = {
            id: `chatcmpl-${message_id}`,
            object: "chat.completion.chunk",
            created: Math.round(new Date().getTime() / 1000),
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: call.index,
                      function: { arguments: piece },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
          if (!safeWrite(res, `data: ${JSON.stringify(argDelta)}\n\n`)) return;
        }
      }
    };

    /**
     * 處理一個 SSE data 段（已剝離 'data: ' 前綴）
     * @param {string} dataContent - 原始 data 段
     */
    const processSSEPayload = async (dataContent) => {
      const decodeJson = isJson(dataContent) ? JSON.parse(dataContent) : null;
      if (
        decodeJson === null ||
        !decodeJson.choices ||
        decodeJson.choices.length === 0
      ) {
        return;
      }

      if (decodeJson.usage) {
        totalTokens = {
          prompt_tokens:
            decodeJson.usage.prompt_tokens || totalTokens.prompt_tokens,
          completion_tokens:
            decodeJson.usage.completion_tokens || totalTokens.completion_tokens,
          total_tokens:
            decodeJson.usage.total_tokens || totalTokens.total_tokens,
        };
      }

      const delta = decodeJson.choices[0].delta;

      if (delta && delta.name === "web_search") {
        web_search_info = delta.extra.web_search_info;
      }

      const imageMarkdownList = getImageMarkdownListFromDelta(delta);
      if (imageMarkdownList.length > 0) {
        const newImageMarkdownList = imageMarkdownList.filter(
          (item) => !emittedImageMarkdownSet.has(item),
        );

        if (thinking_start && !thinking_end) {
          for (const imageMarkdown of newImageMarkdownList) {
            if (!pendingImageMarkdownList.includes(imageMarkdown)) {
              pendingImageMarkdownList.push(imageMarkdown);
            }
          }
        } else if (newImageMarkdownList.length > 0) {
          const imageContent = `${newImageMarkdownList.join("\n\n")}\n\n`;
          completionContent += imageContent;
          newImageMarkdownList.forEach((item) =>
            emittedImageMarkdownSet.add(item),
          );
          writeContentDelta(imageContent);
        }
      }

      // ═══ 1) reasoning_content 先行（標準 OpenAI 思考模式欄位）═══
      if (delta.reasoning_content) {
        completionContent += delta.reasoning_content;
        if (!thinking_start) {
          thinking_start = true;
          if (web_search_info) {
            const rc = `${await accountManager.generateMarkdownTable(web_search_info, config.searchInfoMode)}\n\n${delta.reasoning_content}`;
            if (config.outThink) writeReasoningDelta(rc);
          } else if (config.outThink) {
            writeReasoningDelta(delta.reasoning_content);
          }
        } else if (config.outThink) {
          writeReasoningDelta(delta.reasoning_content);
        }
        // 若同時有 content，繼續往下處理（罕見，但仍支援）
        if (!delta.content) return;
      }

      // ═══ 2) content 處理 ═══
      if (!delta.content) return;
      let rawContent = delta.content;
      completionContent += rawContent;

      // ═══ No phase — parse <think> tags from content (fallback for non-reasoning upstreams) ═══
      if (thinkActive) {
        const endIdx = rawContent.indexOf("</think>");
        if (endIdx >= 0) {
          thinkBuf += rawContent.slice(0, endIdx);
          if (config.outThink && thinkBuf.trim()) writeReasoningDelta(thinkBuf);
          thinkActive = false;
          thinkBuf = "";
          const rest = rawContent.slice(endIdx + 8);
          if (rest) {
            writeContentDelta(rest);
            completionContent += rest;
          }
        } else {
          thinkBuf += rawContent;
        }
      } else {
        const startIdx = rawContent.indexOf("<think>");
        if (startIdx >= 0) {
          const preThink = rawContent.slice(0, startIdx);
          if (preThink) {
            writeContentDelta(preThink);
            completionContent += preThink;
          }
          const postThink = rawContent.slice(startIdx + 7);
          if (postThink.includes("</think>")) {
            const endIdx2 = postThink.indexOf("</think>");
            const thinkText = postThink.slice(0, endIdx2);
            if (config.outThink && thinkText.trim())
              writeReasoningDelta(thinkText);
            const after = postThink.slice(endIdx2 + 8);
            if (after) {
              writeContentDelta(after);
              completionContent += after;
            }
          } else {
            thinkBuf = postThink;
            thinkActive = true;
          }
        } else {
          // 純文字：若已有 reasoning 先關閉，輸出延遲的圖片
          if (thinking_start && !thinking_end) {
            thinking_end = true;
            if (pendingImageMarkdownList.length > 0) {
              const imgBlock = pendingImageMarkdownList.join("\n\n") + "\n\n";
              rawContent = imgBlock + rawContent;
              completionContent += imgBlock;
              pendingImageMarkdownList = [];
            }
          }
          writeContentDelta(rawContent);
        }
      }
    };

    /**
     * 把一個上游回應流接入解析與轉發管線，等其結束
     * 內建 idle timeout（30s 無資料視為結束）與 keepalive
     * @param {object} upstreamResponse - axios stream 回應
     * @returns {Promise<void>} 流處理完成的 Promise
     */
    const pipeUpstream = (upstreamResponse) =>
      new Promise((resolve, reject) => {
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let idleTimer = null;
        let keepaliveTimer = null;
        let finished = false;
        let hasDataArrived = false;

        // ═══ Fix 3: client 斷線時立即清理上游，不等到下筆資料 ═══
        const cleanup = () => {
          if (finished) return;
          finished = true;
          clearTimers();
          res.removeListener("close", onResClose);
          upstreamResponse.removeListener("data", onData);
          upstreamResponse.removeListener("end", onEnd);
          upstreamResponse.removeListener("error", onError);
          try {
            upstreamResponse.destroy();
          } catch {}
        };

        const onResClose = () => {
          cleanup();
          resolve();
        };
        res.on("close", onResClose);

        const clearTimers = () => {
          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
          if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
          }
        };

        // ═══ Fix 6: 增加間隔超時至 120s 避免模型產出中斷 ═══
        // 原 bug: 60s 間隔超時在複雜編碼任務時過早觸發，導致模型產出被截斷
        // 修復：調高至與 TTFB 一致 (120s)，給模型足夠時間生成長檔案
        const TTFB_TIMEOUT_MS = 120000;
        const INTER_CHUNK_TIMEOUT_MS = parseInt(
          process.env.CHAT_INTER_CHUNK_TIMEOUT_MS || "120000",
          10,
        );
        const resetIdle = () => {
          if (idleTimer) clearTimeout(idleTimer);
          const timeoutMs = hasDataArrived
            ? INTER_CHUNK_TIMEOUT_MS
            : TTFB_TIMEOUT_MS;
          idleTimer = setTimeout(() => {
            if (!finished) {
              const reason = hasDataArrived
                ? `串流間隔逾時 (${INTER_CHUNK_TIMEOUT_MS / 1000}s)`
                : `上游首字節逾時 (${TTFB_TIMEOUT_MS / 1000}s)`;
              logger.warn(reason + "，強制結束", "CHAT");
              cleanup();
              resolve();
            }
          }, timeoutMs);
        };

        // 15 秒 keepalive 心跳（維持 client 連線）
        const KEEPALIVE_INTERVAL_MS = 15000;
        keepaliveTimer = setInterval(() => {
          try {
            res.write(": keepalive\n\n");
          } catch {
            // client 可能已斷線
          }
        }, KEEPALIVE_INTERVAL_MS);

        resetIdle();

        const onData = async (chunk) => {
          if (finished) return;
          // ═══ Fix 3: 檢查 client 是否已斷線，斷線則清理上游 stream ═══
          if (res.destroyed) {
            cleanup();
            resolve();
            return;
          }
          if (!hasDataArrived) hasDataArrived = true; // 首 byte 已抵達，切換至間隔超時
          resetIdle(); // 有資料就重設 idle timer

          const decodeText = decoder.decode(chunk, { stream: true });
          buffer += decodeText;

          const chunks = [];
          let startIndex = 0;

          while (true) {
            const dataStart = buffer.indexOf("data: ", startIndex);
            if (dataStart === -1) break;
            const dataEnd = buffer.indexOf("\n\n", dataStart);
            if (dataEnd === -1) break;
            const dataChunk = buffer.substring(dataStart, dataEnd).trim();
            chunks.push(dataChunk);
            startIndex = dataEnd + 2;
          }

          if (startIndex > 0) {
            buffer = buffer.substring(startIndex);
          }

          for (const item of chunks) {
            try {
              await processSSEPayload(item.replace("data: ", ""));
            } catch (error) {
              logger.error("流式資料處理錯誤", "CHAT", "", error);
            }
          }
        };
        upstreamResponse.on("data", onData);

        const onEnd = () => {
          cleanup();
          resolve();
        };
        upstreamResponse.on("end", onEnd);

        const onError = (err) => {
          cleanup();
          reject(err);
        };
        upstreamResponse.on("error", onError);
      });

    await pipeUpstream(response);

    // tool_choice="required" 強校驗：未觸發任何工具調用則追加更強提示重試一次
    if (
      hasTools &&
      toolParser &&
      !toolParser.hasEmittedAnyCall() &&
      requiresToolCall(toolChoice)
    ) {
      const retryHint = buildRequiredRetryHint(toolChoice);
      const retryBody = {
        ...requestBody,
        messages: [
          ...(Array.isArray(requestBody?.messages) ? requestBody.messages : []),
          { role: "system", content: retryHint },
        ],
      };
      logger.warning?.(
        "tool_choice=required 首次未觸發工具調用，進行一次重試",
        "CHAT",
      );
      try {
        const retryResp = await sendChatRequest(retryBody);
        if (retryResp.status && retryResp.response) {
          await pipeUpstream(retryResp.response);
        }
      } catch (e) {
        logger.error("required 模式重試失敗", "CHAT", "", e);
      }
    }

    // flush 工具調用解析器中的殘留內容
    if (toolParser) {
      const tail = toolParser.flush();
      if (tail.textDelta) writeContentDelta(tail.textDelta);
      if (tail.completedCalls.length > 0)
        writeToolCallsDelta(tail.completedCalls);
    }

    // 處理最終的搜索資訊
    if (
      (config.outThink === false || !enable_thinking) &&
      web_search_info &&
      config.searchInfoMode === "text"
    ) {
      const webSearchTable = await accountManager.generateMarkdownTable(
        web_search_info,
        "text",
      );
      writeContentDelta(`\n\n---\n${webSearchTable}`);
    }

    // 計算最終的token使用量
    if (
      totalTokens.prompt_tokens === 0 &&
      totalTokens.completion_tokens === 0
    ) {
      totalTokens = createUsageObject(
        requestBody?.messages || promptText,
        completionContent,
        null,
      );
      logger.info(
        `流式使用tiktoken計算 - Prompt: ${totalTokens.prompt_tokens}, Completion: ${totalTokens.completion_tokens}, Total: ${totalTokens.total_tokens}`,
        "CHAT",
      );
    } else {
      // ═══ Fix 12: 上游回傳空內容時記錄除錯資訊 ═══
      const _hasStreamContent =
        totalTokens.completion_tokens > 0 ||
        completionContent.trim().length > 0;
      if (
        !_hasStreamContent &&
        (totalTokens.prompt_tokens > 0 || promptText.length > 0)
      ) {
        logger.warn(
          `⬆️ [串流] 上游回傳空內容: model=${requestBody?.model || "?"} prompt_tokens=${totalTokens.prompt_tokens} completion_tokens=${totalTokens.completion_tokens} 請檢查模型名稱與 Token 權限`,
          "CHAT",
        );
      }
      logger.info(
        `流式使用上游真實Token - Prompt: ${totalTokens.prompt_tokens}, Completion: ${totalTokens.completion_tokens}, Total: ${totalTokens.total_tokens}`,
        "CHAT",
      );
    }

    totalTokens.prompt_tokens = Math.max(0, totalTokens.prompt_tokens || 0);
    totalTokens.completion_tokens = Math.max(
      0,
      totalTokens.completion_tokens || 0,
    );
    totalTokens.total_tokens =
      totalTokens.prompt_tokens + totalTokens.completion_tokens;

    // Daily stats 累計——一次性歸屬到主請求賬戶
    // 注：tool_choice=required retry 走的可能是另一個賬戶，但 retry 路徑罕見，
    // 全歸屬主賬戶是可接受的精度損失（PR #3wg.1 epic notes 已記）
    attributeChatUsage(options.currentAccount, totalTokens);

    const finishReason =
      toolParser && toolParser.hasEmittedAnyCall() ? "tool_calls" : "stop";
    safeWrite(
      res,
      `data: ${JSON.stringify({
        id: `chatcmpl-${message_id}`,
        object: "chat.completion.chunk",
        created: Math.round(new Date().getTime() / 1000),
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: finishReason,
          },
        ],
      })}\n\n`,
    );

    safeWrite(
      res,
      `data: ${JSON.stringify({
        id: `chatcmpl-${message_id}`,
        object: "chat.completion.chunk",
        created: Math.round(new Date().getTime() / 1000),
        choices: [],
        usage: totalTokens,
      })}\n\n`,
    );

    safeWrite(res, `data: [DONE]\n\n`);
    safeEnd(res);
  } catch (error) {
    logger.error("聊天處理錯誤", "CHAT", "", error);
    // ═══ Fix 10: 若 headers 已送出，不應再 res.status(500) ═══
    // 原 bug: SSE 串流開始後，catch 嘗試發送 JSON error response，
    // 但 content-type 已是 text/event-stream，發送會失敗且客戶端看到不完整串流
    if (!res.headersSent) {
      try {
        res.status(500).json({ error: "Service error" });
      } catch (_) {}
    }
  }
};

/**
 * 處理非流式回應（從流式資料累積完整回應）
 * @param {object} res - Express 回應物件
 * @param {object} response - 上游回應流
 * @param {boolean} enable_thinking - 是否啟用思考模式
 * @param {boolean} enable_web_search - 是否啟用網絡搜索
 * @param {string} model - 模型名稱
 * @param {object} requestBody - 原始請求體，用於提取prompt資訊
 * @param {object} [options] - 擴展選項
 * @param {boolean} [options.has_tools] - 是否啟用工具調用解析
 */
const handleNonStreamResponse = async (
  res,
  response,
  enable_thinking,
  enable_web_search,
  model,
  requestBody = null,
  options = {},
) => {
  try {
    let fullContent = ""; // only content + images, NO reasoning_content
    let reasoningContent = "";
    let contentForToken = ""; // for token estimation (includes reasoning tokens)
    let web_search_info = null;
    let thinking_start = false;
    let thinking_end = false;
    let appendedImageMarkdownSet = new Set();
    let pendingImageMarkdownList = [];

    const hasTools = !!options.has_tools;
    const toolChoice = options.tool_choice;

    // Token消耗量統計
    let totalTokens = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };

    // 提取prompt文本用於token估算
    let promptText = "";
    if (requestBody && requestBody.messages) {
      promptText = requestBody.messages
        .map((msg) => {
          if (typeof msg.content === "string") {
            return msg.content;
          } else if (Array.isArray(msg.content)) {
            return msg.content.map((item) => item.text || "").join("");
          }
          return "";
        })
        .join("\n");
    }

    /**
     * 把一個上游回應流讀完並累積到 fullContent
     * 內建 idle timeout（30s 無資料視為結束）
     * @param {object} upstreamResponse - axios stream 回應
     * @returns {Promise<void>} 流處理完成的 Promise
     */
    const accumulateUpstream = (upstreamResponse) =>
      new Promise((resolve, reject) => {
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let idleTimer = null;
        let finished = false;
        let hasDataArrived = false;

        // ═══ Fix 3: client 斷線時立即清理上游（非串流也適用） ═══
        const cleanup = () => {
          if (finished) return;
          finished = true;
          clearIdle();
          res.removeListener("close", onResClose);
          upstreamResponse.removeListener("data", onData);
          upstreamResponse.removeListener("end", onEnd);
          upstreamResponse.removeListener("error", onError);
          try {
            upstreamResponse.destroy();
          } catch {}
        };

        const onResClose = () => {
          cleanup();
          resolve();
        };
        res.on("close", onResClose);

        const clearIdle = () => {
          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
        };

        // ═══ 兩段式超時（同 pipeUpstream，INTER_CHUNK 120s） ═══
        const TTFB_TIMEOUT_MS = 120000;
        const INTER_CHUNK_TIMEOUT_MS = parseInt(
          process.env.CHAT_INTER_CHUNK_TIMEOUT_MS || "120000",
          10,
        );
        const resetIdle = () => {
          clearIdle();
          const timeoutMs = hasDataArrived
            ? INTER_CHUNK_TIMEOUT_MS
            : TTFB_TIMEOUT_MS;
          idleTimer = setTimeout(() => {
            if (!finished) {
              const reason = hasDataArrived
                ? `非流式間隔逾時 (${INTER_CHUNK_TIMEOUT_MS / 1000}s)`
                : `上游首字節逾時 (${TTFB_TIMEOUT_MS / 1000}s)`;
              logger.warn(reason + "，強制結束", "CHAT");
              cleanup();
              resolve();
            }
          }, timeoutMs);
        };

        resetIdle();

        const onData = async (chunk) => {
          if (finished) return;
          // ═══ Fix 3: 檢查 client 是否已斷線 ═══
          if (res.destroyed) {
            cleanup();
            resolve();
            return;
          }
          if (!hasDataArrived) hasDataArrived = true;
          resetIdle();

          const decodeText = decoder.decode(chunk, { stream: true });
          buffer += decodeText;

          const chunks = [];
          let startIndex = 0;

          while (true) {
            const dataStart = buffer.indexOf("data: ", startIndex);
            if (dataStart === -1) break;
            const dataEnd = buffer.indexOf("\n\n", dataStart);
            if (dataEnd === -1) break;
            const dataChunk = buffer.substring(dataStart, dataEnd).trim();
            chunks.push(dataChunk);
            startIndex = dataEnd + 2;
          }

          if (startIndex > 0) {
            buffer = buffer.substring(startIndex);
          }

          for (const item of chunks) {
            try {
              const dataContent = item.replace("data: ", "");
              const decodeJson = isJson(dataContent)
                ? JSON.parse(dataContent)
                : null;
              if (
                decodeJson === null ||
                !decodeJson.choices ||
                decodeJson.choices.length === 0
              ) {
                continue;
              }

              if (decodeJson.usage) {
                totalTokens = {
                  prompt_tokens:
                    decodeJson.usage.prompt_tokens || totalTokens.prompt_tokens,
                  completion_tokens:
                    decodeJson.usage.completion_tokens ||
                    totalTokens.completion_tokens,
                  total_tokens:
                    decodeJson.usage.total_tokens || totalTokens.total_tokens,
                };
              }

              const delta = decodeJson.choices[0].delta;

              if (delta && delta.name === "web_search") {
                web_search_info = delta.extra.web_search_info;
              }

              const imageMarkdownList = getImageMarkdownListFromDelta(delta);
              if (imageMarkdownList.length > 0) {
                const newImageMarkdownList = imageMarkdownList.filter(
                  (it) => !appendedImageMarkdownSet.has(it),
                );

                if (thinking_start && !thinking_end) {
                  for (const imageMarkdown of newImageMarkdownList) {
                    if (!pendingImageMarkdownList.includes(imageMarkdown)) {
                      pendingImageMarkdownList.push(imageMarkdown);
                    }
                  }
                } else if (newImageMarkdownList.length > 0) {
                  const imgBlock = `${newImageMarkdownList.join("\n\n")}\n\n`;
                  fullContent += imgBlock;
                  contentForToken += imgBlock;
                  newImageMarkdownList.forEach((it) =>
                    appendedImageMarkdownSet.add(it),
                  );
                }
              }

              if (!delta || (!delta.content && !delta.reasoning_content))
                continue;

              // ═══ 1) reasoning_content 先行 ═══
              if (delta.reasoning_content) {
                contentForToken += delta.reasoning_content; // for token estimation
                if (!thinking_start) {
                  thinking_start = true;
                  if (web_search_info) {
                    const table = await accountManager.generateMarkdownTable(
                      web_search_info,
                      config.searchInfoMode,
                    );
                    reasoningContent += table + "\n\n";
                  }
                }
                reasoningContent += delta.reasoning_content;
                if (!delta.content) continue;
              }

              // ═══ 2) content ═══
              let rawContent = delta.content;
              if (!rawContent) continue;

              // 從 reasoning 切換到 content 時，輸出延遲的圖片
              if (!thinking_end && thinking_start) {
                thinking_end = true;
                if (pendingImageMarkdownList.length > 0) {
                  const pendingImg =
                    pendingImageMarkdownList.join("\n\n") + "\n\n";
                  fullContent += pendingImg;
                  contentForToken += pendingImg;
                  pendingImageMarkdownList.forEach((it) =>
                    appendedImageMarkdownSet.add(it),
                  );
                  pendingImageMarkdownList = [];
                }
              }
              fullContent += rawContent;
              contentForToken += rawContent;
            } catch (error) {
              logger.error("非流式資料處理錯誤", "CHAT", "", error);
            }
          }
        };
        upstreamResponse.on("data", onData);

        const onEnd = () => {
          cleanup();
          resolve();
        };
        upstreamResponse.on("end", onEnd);

        const onError = (err) => {
          cleanup();
          reject(err);
        };
        upstreamResponse.on("error", onError);
      });

    await accumulateUpstream(response);

    // ═══ fallback: <think> 標籤提取（僅上游無 reasoning_content 時使用） ═══
    if (!reasoningContent && fullContent.includes("<think>")) {
      const cleaned = fullContent.replace(
        /<think>[\s\S]*?<\/think>/g,
        (match) => {
          const thinkText = match.replace(/<\/?think>/g, "").trim();
          if (thinkText && config.outThink)
            reasoningContent += thinkText + "\n";
          return "";
        },
      );
      fullContent = cleaned.trim();
    }

    // 工具調用解析：從 fullContent 抽取 <tool_call> 塊
    let assistantContent = fullContent;
    let toolCalls = [];
    if (hasTools) {
      const parsed = parseToolCallsFromText(fullContent);
      assistantContent = parsed.cleanedText;
      toolCalls = parsed.toolCalls;
    }

    // tool_choice="required" 強校驗：未觸發則重試一次
    if (hasTools && toolCalls.length === 0 && requiresToolCall(toolChoice)) {
      const retryHint = buildRequiredRetryHint(toolChoice);
      const retryBody = {
        ...requestBody,
        messages: [
          ...(Array.isArray(requestBody?.messages) ? requestBody.messages : []),
          { role: "system", content: retryHint },
        ],
      };
      logger.warning?.(
        "tool_choice=required 首次未觸發工具調用，進行一次重試",
        "CHAT",
      );
      try {
        const retryResp = await sendChatRequest(retryBody);
        if (retryResp.status && retryResp.response) {
          const before = fullContent;
          await accumulateUpstream(retryResp.response);
          const retriedText = fullContent.slice(before.length);
          const parsedRetry = parseToolCallsFromText(retriedText);
          if (parsedRetry.toolCalls.length > 0) {
            toolCalls = parsedRetry.toolCalls;
            assistantContent = parseToolCallsFromText(fullContent).cleanedText;
          }
        }
      } catch (e) {
        logger.error("required 模式重試失敗", "CHAT", "", e);
      }
    }

    // 處理最終的搜索資訊
    if (
      (config.outThink === false || !enable_thinking) &&
      web_search_info &&
      config.searchInfoMode === "text"
    ) {
      const webSearchTable = await accountManager.generateMarkdownTable(
        web_search_info,
        "text",
      );
      assistantContent += `\n\n---\n${webSearchTable}`;
    }

    // 計算最終的token使用量
    if (
      totalTokens.prompt_tokens === 0 &&
      totalTokens.completion_tokens === 0
    ) {
      totalTokens = createUsageObject(
        requestBody?.messages || promptText,
        contentForToken,
        null,
      );
      logger.info(
        `非流式使用tiktoken計算 - Prompt: ${totalTokens.prompt_tokens}, Completion: ${totalTokens.completion_tokens}, Total: ${totalTokens.total_tokens}`,
        "CHAT",
      );
    } else {
      // ═══ Fix 12: 上游回傳空內容時記錄除錯資訊 ═══
      // 當上游 API 回傳 HTTP 200 但 completion=0 且 prompt>0，
      // 表示 Qwen API 成功接收請求但回傳空白回應（可能模型不可用、Token 無權限、WAF 靜默阻擋）
      const _upstreamHasContent =
        totalTokens.completion_tokens > 0 ||
        contentForToken.trim().length > 0 ||
        !!(toolCalls?.length > 0);
      if (
        !_upstreamHasContent &&
        (totalTokens.prompt_tokens > 0 || promptText.length > 0)
      ) {
        logger.warn(
          `⬆️ 上游回傳空內容: model=${model} prompt_tokens=${totalTokens.prompt_tokens} completion_tokens=${totalTokens.completion_tokens} 請檢查模型名稱與 Token 權限`,
          "CHAT",
        );
      }
      logger.info(
        `非流式使用上游真實Token - Prompt: ${totalTokens.prompt_tokens}, Completion: ${totalTokens.completion_tokens}, Total: ${totalTokens.total_tokens}`,
        "CHAT",
      );
    }

    totalTokens.prompt_tokens = Math.max(0, totalTokens.prompt_tokens || 0);
    totalTokens.completion_tokens = Math.max(
      0,
      totalTokens.completion_tokens || 0,
    );
    totalTokens.total_tokens =
      totalTokens.prompt_tokens + totalTokens.completion_tokens;

    // Daily stats 累計——一次性歸屬到主請求賬戶（同 stream 分支註釋）
    attributeChatUsage(options.currentAccount, totalTokens);

    const assistantMessage = {
      role: "assistant",
      content: assistantContent || null,
    };
    if (toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls;
    }
    // 當 OUTPUT_THINK=true 且上游有思考內容時，輸出 OpenAI 標準 reasoning_content 欄位
    if (config.outThink && reasoningContent) {
      assistantMessage.reasoning_content = reasoningContent.trimEnd();
    }

    const bodyTemplate = {
      id: `chatcmpl-${generateUUID()}`,
      object: "chat.completion",
      created: Math.round(new Date().getTime() / 1000),
      model: model,
      choices: [
        {
          index: 0,
          message: assistantMessage,
          finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
        },
      ],
      usage: totalTokens,
    };
    res.json(bodyTemplate);
  } catch (error) {
    logger.error("非流式聊天處理錯誤", "CHAT", "", error);
    res.status(500).json({
      error: "Service error",
    });
  }
};

/**
 * 主要的聊天完成處理函式
 * @param {object} req - Express 請求物件
 * @param {object} res - Express 回應物件
 */
const handleChatCompletion = async (req, res) => {
  const { stream, model } = req.body;

  const enable_thinking = req.enable_thinking;
  const enable_web_search = req.enable_web_search;

  try {
    const response_data = await sendChatRequest(req.body);

    if (!response_data.status || !response_data.response) {
      res.status(500).json({
        error: "Request failed",
      });
      return;
    }

    if (stream) {
      setResponseHeaders(res, true);
      await handleStreamResponse(
        res,
        response_data.response,
        enable_thinking,
        enable_web_search,
        req.body,
        {
          has_tools: req.has_tools,
          tool_choice: req.tool_choice,
          currentAccount: response_data.currentAccount,
        },
      );
    } else {
      setResponseHeaders(res, false);
      await handleNonStreamResponse(
        res,
        response_data.response,
        enable_thinking,
        enable_web_search,
        model,
        req.body,
        {
          has_tools: req.has_tools,
          tool_choice: req.tool_choice,
          currentAccount: response_data.currentAccount,
        },
      );
    }
  } catch (error) {
    logger.error("聊天處理錯誤", "CHAT", "", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Invalid token, request failed",
      });
    }
  }
};

module.exports = {
  handleChatCompletion,
  handleStreamResponse,
  handleNonStreamResponse,
  setResponseHeaders,
};
