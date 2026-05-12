# 安全補丁實作計畫 (Security Patch Implementation Plan)

為了解決目前系統存在的潛在安全隱患，我將實作以下安全修補計畫。主要針對「網路介面暴露 (Network Exposure)」與「授權驗證繞過 (Authorization Bypass)」兩大問題進行修復。

> [!WARNING]
> 本次修補會將預設的連線監聽位址從 `0.0.0.0` (對外公開) 改為 `127.0.0.1` (僅限本機)。如果您過去是從其他電腦連線到這台機器的服務，修補後將無法連線。若需對外開放，您必須明確在 `.env` 中設定 `LISTEN_ADDRESS=0.0.0.0`。

## User Review Required

請確認您是否同意將預設監聽位址改為 `127.0.0.1`，這能防止同網域內的其他設備任意存取您的 Qwen2API 服務。

## Open Questions

> [!IMPORTANT]
> 在盤點安全問題時，我發現一個**嚴重的功能性 Bug**：
> `qwen2api-plugin` 內部定義的 `qwen_bash`, `qwen_read` 等工具，實際上會發送請求到 `QWEN2API_URL/mcp`。但 `qwen2api` 專案中**完全沒有實作 `/mcp` 這個路由**，這會導致 opencode 呼叫這些工具時永遠失敗。
> 
> 您希望我在這次安全修補中，順便將這個 `/mcp` 的路由實作加到 `chat-proxy.js` 中，讓它變成一個真正的本機工具執行代理嗎？

## Proposed Changes

### Qwen2API Plugin (chat-proxy.js)

修復 Proxy 的網路綁定與授權漏洞。

#### [MODIFY] [chat-proxy.js](file:///home/reamaster/opencode-manager/projects/independent/qwen2api-plugin/src/chat-proxy.js)
1. **補上 API Key 驗證**：在 `handleRequest` 開頭加入對 `Authorization: Bearer <API_KEY>` 的驗證，防止未授權的本機/區域網路請求隨意觸發 Proxy 的運算。
2. **網路介面綁定 (Network Binding)**：將 `server.listen(PROXY_PORT, () => ...)` 改為 `server.listen(PROXY_PORT, "127.0.0.1", () => ...)`。

---

### Qwen2API (config)

收緊後端服務的預設綁定範圍。

#### [MODIFY] [index.js](file:///home/reamaster/opencode-manager/projects/independent/qwen2api/src/config/index.js)
1. 將 `listenAddress: process.env.LISTEN_ADDRESS || null` 改為 `listenAddress: process.env.LISTEN_ADDRESS || '127.0.0.1'`，預設僅允許本機連線，避免無意間將服務暴露在公網或區域網路。

## Verification Plan

### Automated Tests
- 重啟服務並透過 `curl` 測試 `http://localhost:<PROXY_PORT>/v1/chat/completions`，確認未帶 API Key 時會回傳 `401 Unauthorized`。
- 確認服務只能透過 `127.0.0.1` 存取，無法透過機器的區域網路 IP 存取。
