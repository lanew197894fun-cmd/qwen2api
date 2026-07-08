# qwen2api-plugin

> opencode 插件 — 將 Qwen2API 整合為 AI 助手，支援工具呼叫

## 架構概覽

```
opencode (插件載入)
    │
    ├── qwen2api-plugin/src/index.js  ← 插件入口（工具註冊 + 服務監控）
    │       │
    │       ├── autoStart()       → 啟動 qwen2api（port 3000）
    │       ├── autoStartProxy()  → 啟動 chat-proxy（port 3456）
    │       ├── startMonitor()    → 健康監控（30s 間隔，自動重啟）
    │       └── qwen_* 工具（15 個） → 透過 proxy /mcp 執行
    │
    ├── chat-proxy.js  ← 聊天代理（主要邏輯，1300 行）
    │       │
    │       ├── handleRequest()     → 請求路由（auth → health → mcp → chat）
    │       ├── runSinglePass()     → 單次 LLM 推論（注入 tool-prompt）
    │       ├── classifyModel()     → 動態模型路由（依任務複雜度）
    │       ├── streamResponse()    → SSE 串流輸出（含 keepalive）
    │       └── execTool()          → 本地工具執行（read/write/edit/bash/...）
    │
    ├── evolution-engine.js  ← 進化引擎（動態權重調整）
    ├── self-learning.js     ← 自我學習系統（1537 行）
    ├── hardware-detect.js   ← 硬體偵測（CPU/GPU/RAM）
    └── start-proxy.js       ← 獨立 proxy 啟動腳本
```

## 核心流程

### 聊天請求處理

1. opencode 發送 `/v1/chat/completions`（含 tools 定義）
2. proxy `handleRequest()` 驗證 API Key（寬鬆比對，不分大小寫）
3. `runSinglePass()` 轉換 tool role → user role，注入 tool-prompt
4. `routeModel()` 依任務複雜度選擇模型等級（small/medium/large）
5. 轉發至 qwen2api（stream=false，取得完整回應）
6. 解析回應：原生 tool_calls → 透傳 / bash-block → 轉換 tool_calls / 純文字
7. `streamResponse()` 串流輸出給 opencode

### 模型路由

- 啟動時自動查詢 qwen2api 可用模型列表
- 依名稱動態分類：large（200B+）/ medium（32B-100B）/ small（<=27B）
- 任務複雜度分析：文字長度、工具數量、關鍵字匹配
- 硬體感知降級：硬體不足時自動降級模型

## 認證機制

- 雙層驗證：proxy 驗證 incoming request → qwen2api middleware 再驗證
- 寬容期：啟動後 8 秒內跳過 auth（避免時序競爭）
- 斷路器：連續 5 次失敗後開啟，30 秒冷卻後半開

## 關鍵修復記錄

| 日期       | 變更                                                                          | 說明                                                                            |
| ---------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 2026-06-29 | auth 比對改為大小寫不敏感                                                     | 修復「Unauthorized: Invalid API Key」                                           |
| 2026-06-29 | enable_thinking 尊重請求端設定                                                | 修復非 thinking 模型強制輸出 `<think>`                                          |
| 2026-06-29 | 串流 keepalive（10s）                                                         | 避免 client 在等待時斷線                                                        |
| 2026-06-29 | 模型分類增強                                                                  | 相容上游動態模型命名                                                            |
| 2026-06-29 | 停滯偵測被動化 — 改為僅觸發真正卡住回應                                       | 移除「我來看看」「Let me check」誤判，新增 stuck 關鍵字比對                     |
| 2026-06-29 | client 斷線中止上游請求                                                       | \_goneWatch interval 500ms 檢查 client 狀態，斷線即 abort postJSON              |
| 2026-06-29 | res.on("close") 即時斷線感知                                                  | pipeUpstream/accumulateUpstream 註冊 close listener + 清理 upstream             |
| 2026-06-29 | buildErrorResponse 不回傳內容到對話框                                         | 錯誤細節僅 log.error → stderr + .err 日誌檔，不回傳 userMsg（content: null）    |
| 2026-06-29 | buildTextResponse 移除硬編碼空字串                                            | 移除 `"(空回應)"` 預設值，改為 `raw ?? null`，空內容對話框不顯示                |
| 2026-06-30 | processor.ts stderr/Bus/DB 錯誤隔離                                           | 移除 process.stderr.write、general Bus Error event、DB error 儲存，錯誤僅寫 log |
| 2026-06-30 | prompt.ts Bus.publish 保留合法配置錯誤                                        | Agent/Model/Command not found 仍顯示（配置錯誤應用戶可見），provider 錯誤已隔離 |
| 2026-07-06 | write 工具自動建立目錄：execTool write 前 `mkdirSync(dir, {recursive: true})` | 模型在不存在的目錄建立檔案靜默失敗                                              |
| 2026-07-06 | 非 bash 程式碼區塊自動轉 write tool_calls（40+ 語言）                         | 模型輸出 `tsx/`py 等區塊時檔案建立永遠不執行                                    |
| 2026-07-06 | bash 超時 30s→60s + cwd 支援                                                  | 大型 typecheck/build 任務 30s 不足                                              |
| 2026-07-06 | `os` import 修正 + 模型健康持久化                                             | 缺少 os import 導致 model-health 拋錯                                           |
| 2026-07-06 | `start-proxy.js` 背景駐留 + 優雅關閉                                          | 背景模式忽略 SIGHUP + keepalive；關閉前 drain 活躍 SSE，避免對話滯留            |
| 2026-07-06 | `chat-proxy.js` `buildErrorResponse` content:null 改為摘要                    | content:null 導致對話框永停空白，改為回傳簡潔錯誤摘要                           |
| 2026-07-06 | `chat-proxy.js` 活躍 SSE 追蹤 + `drain()`/`drainAndClose()` 匯出              | 追蹤進行中的 SSE 串流，關閉時優雅等待完成或超時強制關閉，確保 `[DONE]` 送達     |
| 2026-07-07 | Fix 1: `_extractFilePath` 永不回傳 null（加入 fallback 路徑）                 | 非 bash 區塊無法推斷檔案路徑時改用 `src/generated/file.{ext}`，不再靜默跳過     |
| 2026-07-07 | Fix 2: `_isStalling` 排除合法簡短回應與活躍工具上下文                         | 「好的」「Done」「完成」等確認詞不再誤觸停滯矯正，工具活躍中的簡短回應視為正常  |
| 2026-07-07 | Fix 3: 重複命令比對改為嚴格模式                                               | 移除 `cur.includes(prev)` 寬鬆比對，改為同命令首詞 prefix 匹配（minLen>=4）     |
| 2026-07-07 | Fix 4: `nonBashBlockToToolCalls` 未知語言區塊印警告而非靜默跳過               | 未知程式語言標籤不再無聲跳過，輸出 `log.warn` 供排查                            |
