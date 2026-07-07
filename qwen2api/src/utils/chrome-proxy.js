/**
 * Chrome CDP Proxy v2
 * 使用 CDP Fetch/Network 域繞過 CORS，從瀏覽器 context 發送 API 請求
 *
 * 流程：
 *   1. 啟動 Chrome，導航至 chat.qwen.ai 通過 WAF
 *   2. 使用 CDP Network.enable 監聽請求和回應
 *   3. 非串流：發送 CDP 請求 → 等待完整回應
 *   4. 串流：發送請求 → 監聽 dataReceived 事件 → 逐塊推送到客戶端
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { logger } = require("./logger");

const CHROME_DIR = path.join(__dirname, "../../.chrome-qwen-profile");
const CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

let instance = null;

class ChromeProxy {
  constructor() {
    this.browser = null;
    this.page = null;
    this.cdp = null;
    this.chromePath = null;
    this.ready = false;
    this._initPromise = null;
  }

  findChrome() {
    for (const p of CHROME_PATHS) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {}
    }
    return null;
  }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    this.chromePath = this.findChrome();
    if (!this.chromePath) throw new Error("Chrome 未找到");

    if (!fs.existsSync(CHROME_DIR))
      fs.mkdirSync(CHROME_DIR, { recursive: true });

    logger.info(`Chrome Proxy v2 啟動中`, "CHROME-PROXY");

    // 啟動 Chrome（無頭模式禁止被檢測）
    this.browser = await puppeteer.launch({
      executablePath: this.chromePath,
      args: [
        `--user-data-dir=${CHROME_DIR}`,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,720",
        `--user-agent=${UA}`,
        "--disable-features=IsolateOrigins,site-per-process,Gcm",
      ],
      headless: "new",
      defaultViewport: { width: 1280, height: 720 },
      timeout: 30000,
    });

    this.page = await this.browser.newPage();
    this.cdp = await this.page.target.createCDPSession();

    // 啟用 Network 域
    await this.cdp.send("Network.enable");

    // 導航至 chat.qwen.ai 通過 WAF 挑戰
    await this.page.goto("https://chat.qwen.ai", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // 等待頁面真正就緒（WAF 挑戰完成）
    await this.page.waitForFunction(
      () => {
        const t = document.title.toLowerCase();
        return (
          t.includes("qwen") ||
          t.includes("千问") ||
          t.includes("chat") ||
          t.includes("通义") ||
          t.includes("studio")
        );
      },
      { timeout: 30000 },
    );

    logger.success("Chrome Proxy v2 已就緒 (WAF 已通過)", "CHROME-PROXY");
    this.ready = true;
  }

  /**
   * 透過 CDP 發送完整 HTTP 請求（非串流）
   * 等同於 axios.post()，但使用瀏覽器的 TLS/Cookie
   */
  async fetchText(url, body, extraHeaders = {}) {
    await this.ensureReady();

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Origin: "https://chat.qwen.ai",
      Referer: "https://chat.qwen.ai/",
      ...extraHeaders,
    };

    // 使用 page.evaluate 從瀏覽器 context 發送請求
    // 此時已在 chat.qwen.ai 域下，無 CORS 問題
    const result = await this.page.evaluate(
      async (url, body, headers) => {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });
          const text = await res.text();
          return {
            ok: res.ok,
            status: res.status,
            text,
            headers: Object.fromEntries(res.headers.entries()),
          };
        } catch (err) {
          return { ok: false, status: 0, text: err.message, headers: {} };
        }
      },
      url,
      body,
      headers,
    );

    return result;
  }

  /**
   * 透過 CDP Network 域發送 SSE 串流請求
   * onData(headers, chunk) — 每個 data chunk 推送
   * onDone() — 請求完成
   * onError(err) — 錯誤
   */
  async fetchStream(url, body, extraHeaders = {}, callbacks) {
    await this.ensureReady();

    const { onData, onDone, onError } = callbacks;

    const requestHeaders = {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Origin: "https://chat.qwen.ai",
      Referer: "https://chat.qwen.ai/",
      ...extraHeaders,
    };

    // 攔截即將發送的請求
    const requestId = await new Promise((resolve, reject) => {
      const handler = async ({ requestId, request }) => {
        if (request.method === "POST" && request.url === url) {
          this.cdp.off("Network.requestWillBeSent", handler);
          resolve(requestId);
        }
      };
      // 超時保護
      const timeout = setTimeout(() => {
        this.cdp.off("Network.requestWillBeSent", handler);
        reject(new Error("請求攔截超時"));
      }, 10000);

      this.cdp.on("Network.requestWillBeSent", async (params) => {
        if (params.request.method === "POST" && params.request.url === url) {
          clearTimeout(timeout);
          this.cdp.off("Network.requestWillBeSent", handler);
          resolve(params.requestId);
        }
      });

      // 發送請求
      this.page.evaluate(
        (url, body, headers) => {
          fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
        },
        url,
        body,
        requestHeaders,
      );
    });

    // 監聽 stream data
    const cleanup = () => {
      this.cdp.off("Network.dataReceived", dataHandler);
      this.cdp.off("Network.loadingFinished", finishHandler);
      this.cdp.off("Network.loadingFailed", failHandler);
    };

    let fullResponseText = "";

    const dataHandler = (params) => {
      if (params.requestId !== requestId) return;
      if (params.data) {
        const text = Buffer.from(params.data, "base64").toString("utf-8");
        fullResponseText += text;
        onData(text);
      }
    };

    const finishHandler = (params) => {
      if (params.requestId !== requestId) return;
      cleanup();
      onDone(fullResponseText);
    };

    const failHandler = (params) => {
      if (params.requestId !== requestId) return;
      cleanup();
      onError(new Error(params.errorText || "Network request failed"));
    };

    this.cdp.on("Network.dataReceived", dataHandler);
    this.cdp.on("Network.loadingFinished", finishHandler);
    this.cdp.on("Network.loadingFailed", failHandler);
  }

  async ensureReady() {
    if (this.ready && this.page) return;
    if (this._initPromise) {
      await this._initPromise;
      return;
    }
    await this.init();
  }

  async destroy() {
    this.ready = false;
    if (this.cdp) {
      try {
        await this.cdp.detach();
      } catch {}
      this.cdp = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
      this.page = null;
    }
    instance = null;
    logger.info("Chrome Proxy v2 已關閉", "CHROME-PROXY");
  }
}

function getInstance() {
  if (!instance) {
    instance = new ChromeProxy();
  }
  return instance;
}

module.exports = { ChromeProxy, getInstance };
