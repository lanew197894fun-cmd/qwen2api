# 安全修補與功能修復總結 (Security Patch Walkthrough)

我已經成功為您的 `qwen2api` 與 `qwen2api-plugin` 套用了安全修補程式，並同時修復了原本隱藏的工具失效 Bug。

以下是本次更新的核心內容：

## 1. 網路介面暴露 (Network Exposure) 修復
預設情況下，Node.js 的 `listen()` 如果沒有指定位址，會自動綁定到 `::` 或 `0.0.0.0`，導致區域網路內的其他裝置能連上您的服務。我已經做出了以下限制：
* **[chat-proxy.js]**: Proxy 現在強制綁定於 `127.0.0.1`，其他人無法從外部連線呼叫您的 LLM。
* **[qwen2api]**: 後端服務預設的 `listenAddress` 已從 `null` 改為 `'127.0.0.1'`。
> [!NOTE]
> 如果您未來有透過 Docker 部署或需要對外開放存取的需求，只需在 `.env` 中設定 `LISTEN_ADDRESS=0.0.0.0` 即可覆蓋這個安全預設值。

## 2. API Key 授權驗證 (Authorization Bypass) 修復
原本的 Proxy 服務在處理 `/v1/chat/completions` 等請求時，完全沒有檢查 `Authorization` 標頭，存在被惡意呼叫的風險。
* **[chat-proxy.js]**: 現在除了 `/health` 健康檢查端點外，所有的請求都必須攜帶與環境變數中設定相同的 `API_KEY`，否則會被直接拒絕並回傳 `401 Unauthorized`。

## 3. Windows 系統專屬安全修補 (Command Injection Fix)
在先前的實作中，處理 Windows 環境的底層函式存有嚴重的 **指令注入 (Command Injection)** 漏洞。惡意請求可透過未跳脫的字串直接取得作業系統的任意執行權限：
* **[killPort]**: 原本直接將傳入的 `port` 變數拼接進 Windows 的 `for /f ... findstr` 系統指令中。我加上了 `parseInt()` 強制型別轉換，確保只有合法數字能被傳遞，阻斷惡意指令拼接。
* **[execGrep]**: `qwen_grep` 工具在 Windows 下原本使用 `execSync` 執行 `findstr`，且未過濾 `pattern` 和 `filePath`。如果搜尋關鍵字包含 `&` 或 `"` 等符號，便會觸發指令注入執行惡意程式 (如 `calc.exe`)。我已將其改寫為安全的 `Bun.spawnSync(args)`，跳過 Shell 處理階段，徹底根除注入風險！

## 4. 工具呼叫 Bug (MCP Route) 修復
這就是我在計畫中提到的「功能性 Bug」。原本的程式碼中，`mcpCall` 試圖透過 `post("/mcp", ...)` 將請求送到 `qwen2api` 的 3000 port，但那邊根本沒有這個路由。
* **[chat-proxy.js]**: 我在 proxy 內新增了真正的 `/mcp` 端點，負責接收工具呼叫並執行 `mcpCall` 邏輯。
* **[index.js]**: 補上了 `proxyPost` 函數，並將工具請求從傳送給 `qwen2api` 正確改為傳送給 `PROXY_URL`。這讓 `qwen_bash`, `qwen_read` 等強大的工具終於能正常運作了！

## 總結
您的系統現在不僅變得更加安全，也補齊了原本殘缺的 Agent 工具執行能力。請嘗試重啟您的服務（例如執行 `pm2 restart all` 或是重新啟動 docker 容器），確保所有更新生效！
