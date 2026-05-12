# ⚠️ 核心安全規範（每次啟動必讀）

1. **🔴 危險區（絕對禁止寫入）：** `projects/system/` — 此目錄翻車會整包刪除
2. **🟢 安全區（所有資料放這裡）：** `projects/.opencode/`
3. **📍 獨立專案區（可讀寫）：** `projects/independent/` — qwen2api 在這裡
4. **📄 寫入任何檔案前，先確認路徑不在 system/ 底下**
5. **❌ 禁止：** 在 system/packages/opencode/ 或任何 system/ 子目錄下建立檔案

---

# qwen2api 安全審計狀態

> **檔案路徑：** `D:\Tools\opencode\opencode-manager\projects\independent\qwen2api\AUDIT_STATUS.md`
> **恢復指令（壓縮後使用）：** 用 read 工具讀取此檔案，從「未完成」繼續
> **指標檔（備用）：** `.opencode/qwen2api-audit-pointer.md`

---

## 已完成

- [x] 目錄結構盤點
- [x] `.env` 檢查（預設 API_KEY=sk-123456，已記錄）
- [x] `server.js` — CORS localhost ✅、Rate Limiter 600/min ✅
- [x] `routes/accounts.js` — adminKeyVerify 保護 ✅
- [x] `routes/settings.js` — adminKeyVerify 保護 ✅
- [x] `middlewares/authorization.js` — Bearer + 分級權限 ✅
- [x] `routes/chat.js` — apiKeyVerify + multer 100MB ✅
- [x] `auto-get-token.js` — taskkill → killPort() ✅
- [x] `resolve-deps.mjs` — fileURLToPath 修復 ✅
- [x] `platform.js` — fileURLToPath 修復 ✅
- [x] `request.js` — withRetry 指數退避 ✅
- [x] `chat-proxy.js` — thinking + token 計數 + rate limit ✅
- [x] `data/data.json` — 清除 JWT Token ✅
- [x] Plugin `index.js` — 工具定義 + 斷路器 + 重試 ✅
- [x] bun audit — qwen2api 1 low(pm2) / plugin 無漏洞 ✅

## 未完成

- [x] `routes/verify.js` — 使用 validateApiKey，無敏感資訊洩露 ✅
- [x] `routes/anthropic.js` — apiKeyVerify 保護 + Anthropic 協定轉換 ✅
- [x] `routes/cli.chat.js` — apiKeyVerify + 帳號輪詢 + CLI 代理轉發 ✅
- [x] `routes/health.js` — 健康檢查端點，無認證要求（公開端點）✅
- [x] `routes/models.js` — apiKeyVerify 保護（部分端點）+ 模型列表 ✅
- [x] `controllers/chat.js` — 流式/非流式處理 + Token 統計 + 工具呼叫重試 ✅
- [x] `controllers/chat.image.video.js` — 圖片/影片生成 + OSS 上傳 + 任務輪詢 ✅
- [x] `controllers/anthropic.js` — Anthropic 協定適配層 ✅
- [x] `controllers/cli.chat.js` — CLI 請求預處理 + 流式轉發 ✅
- [x] `controllers/models.js` — 模型列表建構 ✅
- [x] `utils/upload.js` — STS Token 獲取 + OSS 上傳 + 重試機制 ✅
- [x] `middlewares/authorization.js` — Bearer Token 驗證 + Admin 分級 ✅
- [x] `server.js` — CORS localhost 限制 + Rate Limiter 600/min ✅
- [x] puppeteer-core 沙箱逃逸風險 — fingerprint.js 為瀏覽器指紋模擬，無頭模式預設啟用沙箱 ✅
- [x] 日誌檔案權限與輪替策略 — logger.js 實作 rotateLogFile + cleanOldLogFiles (max 10MB/5檔) ✅
- [x] 檔案上傳 MIME 驗證 — upload.js 使用 mime-types lookup + SUPPORTED_TYPES 白名單 ✅
- [x] Path Traversal 防護 — OSS 路徑由 STS Token 服務端生成，客戶端無法控制路徑 ✅
