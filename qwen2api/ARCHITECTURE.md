# qwen2api

> Qwen API 反向代理服務 — 將 Qwen 官方 API 轉換為 OpenAI-compatible 格式

## 架構概覽

```
外部客戶端 → chat-proxy (3456) → qwen2api (3000) → upstream Qwen API
                ↑                        ↑
          工具支援層               API 認證 + 路由
```

## 核心模組

| 路徑                               | 功能                                                          |
| ---------------------------------- | ------------------------------------------------------------- |
| `src/server.js`                    | Express 主服務，CORS、Rate Limiter、路由註冊                  |
| `src/middlewares/authorization.js` | API Key 驗證（Bearer token → config.apiKeys）                 |
| `src/routes/chat.js`               | 聊天端點路由，掛載 authorization + chat-middleware            |
| `src/controllers/chat.js`          | 聊天邏輯，SSE 串流處理（含 idle timeout 30s + keepalive 15s） |
| `src/controllers/models.js`        | 上游模型列表快取與分類（thinking/search/image/...）           |
| `src/config/index.js`              | 設定管理（env → config object）                               |
| `src/utils/request.js`             | 上游 HTTP 請求發送（含重試）                                  |
| `src/utils/account.js`             | 帳戶輪換管理（多帳號 round-robin）                            |
| `src/utils/account-rotator.js`     | 帳戶旋轉器                                                    |
| `src/utils/proxy-helper.js`        | 代理配置輔助                                                  |
| `src/utils/tool-prompt.js`         | Tool Call XML 解析器                                          |
| `src/utils/ssxmod-manager.js`      | SSXMOD Cookie 管理器                                          |
| `src/utils/chrome-fetch.js`        | Chrome Fetch Proxy v3 — 非無頭 Chrome 繞過阿里雲 WAF JA3 檢測 |
| `src/models/models-map.js`         | 上游模型列表取得（Chrome Fetch 優先，axios 降級）             |

## 關鍵修復記錄

| 日期       | 變更                                                                     | 說明                                                                 |
| ---------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 2026-06-29 | 加入 idle timeout + keepalive                                            | 避免上游串流中斷導致連線永久掛起                                     |
| 2026-06-29 | 擴充 CORS origin                                                         | 支援 Tailscale/LAN 跨裝置存取                                        |
| 2026-06-29 | 新增 Chrome Fetch Proxy v3                                               | 使用非無頭 Chrome 繞過阿里雲 WAF JA3 TLS 指紋 + acw_tc 雙重檢測      |
| 2026-06-29 | chat-proxy 強化工具提示 + 停滯矯正                                       | buildToolPrompt 正反例強制直接輸出命令；停滯偵測自動重試注入矯正訊息 |
| 2026-06-29 | request.js: Chrome Fetch 為主路徑, axios 降級                            | WAF 繞過後請求直達上游                                               |
| 2026-06-29 | 模型名稱映射: qwen-plus → qwen3.7-plus 等                                | 上游 API 模型名稱已變更，硬編碼映射表作為後備                        |
| 2026-06-29 | Chrome 健康監控 (60s) + 自動恢復                                         | Chrome crash 時自動重啟，不影響服務可用性                            |
| 2026-06-29 | SSE 管線 client 斷線即時清理                                             | pipeUpstream/accumulateUpstream 註冊 res.on("close") 摧毀上游 stream |
| 2026-06-29 | Chrome Fetch page.evaluate 回呼洩漏修復                                  | .catch() 清理 callbacks + timeout + stream destroy                   |
| 2026-06-30 | process.on("exit") 同步殺 Chrome 子進程                                  | 避免 SIGTERM 後 Chrome 變孤兒進程累積佔用記憶體                      |
| 2026-06-30 | start.mjs 啟動前掃描孤兒 Chrome 並清除                                   | 二次防護：掃描 cmdline 含 `.chrome-qwen-profile` 的殘留進程並殺掉    |
| 2026-06-30 | LIGHTWEIGHT 環境變數支援                                                 | 筆電開發預設 `--single-process`，節省 60-70% 記憶體                  |
| 2026-07-06 | Chrome Fetch 斷路器永久禁用：maxCooldown+≥6次失敗 → `_permanentDisabled` | 避免無限重試浪費資源                                                 |

## Chrome Fetch 繞過 WAF 原理

阿里雲 WAF 使用雙重檢測：

1. **JA3 TLS 指紋** — 非無頭 Chrome (headless:false) 使用真實瀏覽器 TLS 指紋
2. **acw_tc context-bound token** — 瀏覽器 context 中通過 `page.evaluate` 發送請求

Bun fetch、curl、headless Chrome 全被 WAF 阻擋。唯一成功方案：

- Chrome (headless:false, DISPLAY=:0) → chat.qwen.ai 通過 WAF → page.evaluate 發 API 請求

## 啟動方式

```bash
# 需要 DISPLAY=:0 (X11) 和 google-chrome-stable
DISPLAY=:0 bun src/start.js
```

## 開發機輕量化配置

筆電 (i5-5200U) 開發時 Chrome 預設多進程架構會產生 9 個子進程、吃 ~1.2GB RAM，導致系統卡頓。

| 設定                       | 效果                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `LIGHTWEIGHT=true`（預設） | Chrome `--single-process` 模式，子進程合併為一個，記憶體節省 60-70% |
| `LIGHTWEIGHT=false`        | 完整多進程模式（生產環境用）                                        |

env var 由 `start.sh` / `start.mjs` 自動設定，不需手動指定。
