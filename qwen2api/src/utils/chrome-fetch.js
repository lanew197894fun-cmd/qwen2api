/**
 * Chrome Fetch Proxy v3
 * 使用無頭 Chrome 繞過阿里雲 WAF JA3 TLS 指紋檢測
 *
 * 流程:
 *   1. 啟動 Chrome (headless:new), 導航至 chat.qwen.ai 通過 WAF
 *   2. 設定 token Cookie 讓 Chrome 處於登入狀態
 *   3. 透過 page.evaluate 在瀏覽器 context 中發送 API 請求
 *   4. SSE 串流透過 exposeFunction 橋接到 Node.js stream
 *
 * 注意:
 *   - ═══ Fix 5: 強制 headless 模式，所有錯誤輸出導向 stderr ═══
 *   - 禁止 Chrome 顯示任何視窗或對話框
 *   - 中斷/崩潰時自動清理所有子程序，避免殭屍進程
 *
 * 依賴: google-chrome-stable, puppeteer-core
 */

const puppeteer = require("puppeteer-core");
const { PassThrough } = require("stream");
const { logger } = require("./logger");

// 固定從一次帳號提取 token (不 round-robin)
const accountManager = require("./account");
const { getChatBaseUrl } = require("./proxy-helper");

const CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.PROGRAMFILES || ""}\\Google\\Chrome\\Application\\chrome.exe`,
];

// 全域單例
let instance = null;
let initPromise = null;

// ═══ Chrome Fetch 斷路器（指數退避 + 永久禁用） ═══
const CB = {
  failures: 0,
  lastAttempt: 0,
  cooldown: 5000, // 初始 5s
  maxCooldown: 300000, // 最長 5min
  threshold: 0, // 0 = 每次失敗都退避
  resetAfter: 600000, // 成功後 10min 重設計數
  lastSuccess: 0,
  _warned: false, // 避免重複噴斷路器訊息
  _permanentDisabled: false, // ═══ Fix: 超過最大冷卻後永久禁用 ═══
  _permanentWarned: false,
};

function _cbShouldTry() {
  // ═══ Fix: 永久禁用後不再嘗試 ═══
  if (CB._permanentDisabled) {
    if (!CB._permanentWarned) {
      const { logger } = require("./logger");
      logger.warn(
        "[CHROME] ⛔ Chrome Fetch 已永久禁用（連續失敗過多），使用 Axios",
        "CHROME",
      );
      CB._permanentWarned = true;
    }
    return false;
  }
  if (CB.failures === 0) {
    CB._warned = false;
    return true;
  }
  const elapsed = Date.now() - CB.lastAttempt;
  return elapsed >= CB.cooldown;
}

function _cbRecordFail() {
  CB.failures++;
  CB.lastAttempt = Date.now();
  CB.cooldown = Math.min(CB.cooldown * 2, CB.maxCooldown);
  CB._warned = false; // 下次可重新警告
  // ═══ Fix 2026-07-07 (v3): 提高門檻至 12 次 + 縮短自動恢復至 5 分鐘 ═══
  // 原 8 次 + 15 分鐘恢復太長 — WAF 可能僅短暫波動，快速恢復可減少空窗期.
  // 提高至 12 次，且 5 分鐘後自動嘗試恢復.
  if (CB.failures >= 12) {
    CB._permanentDisabled = true;
    process.env.CHROME_DISABLED = "true";
    process.env.DISABLE_BROWSER = "true";
    // 永久禁用後 5 分鐘自動嘗試恢復
    if (!CB._recoverTimer) {
      CB._recoverTimer = setTimeout(
        () => {
          if (CB._permanentDisabled) {
            const { logger } = require("./logger");
            logger.info(
              "[CHROME] ⏰ 定時恢復檢查：嘗試重啟 Chrome Fetch...",
              "CHROME",
            );
            CB._permanentDisabled = false;
            CB._permanentWarned = false;
            process.env.CHROME_DISABLED = "false";
            process.env.DISABLE_BROWSER = "false";
            // 重設斷路器計數
            CB.failures = 0;
            CB.cooldown = 5000;
          }
          CB._recoverTimer = null;
        },
        5 * 60 * 1000,
      );
      CB._recoverTimer.unref();
    }
  }
}

function _cbRecordSuccess() {
  CB.failures = 0;
  CB.cooldown = 5000;
  CB.lastSuccess = Date.now();
  CB._warned = false;
  CB._permanentDisabled = false; // ═══ Fix: 成功時重設永久禁用 ═══
  CB._permanentWarned = false;
}

class ChromeFetch {
  constructor() {
    this.browser = null;
    this.page = null;
    this.ready = false;
    this.reqSeq = 0;
    this.callbacks = new Map();
    this._initLock = null;
    this.chatBaseUrl = getChatBaseUrl();
  }

  findChrome() {
    for (const p of CHROME_PATHS) {
      try {
        if (require("fs").existsSync(p)) return p;
      } catch {}
    }
    return null;
  }

  /**
   * 清理 Chrome profile 鎖檔（避免前次異常退出導致鎖定）
   */
  _cleanProfileLock(profileDir) {
    const fs = require("fs");
    const locks = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
    for (const lock of locks) {
      const fp = require("path").join(profileDir, lock);
      try {
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch {}
    }
  }

  /**
   * ═══ Fix 2026-07-07: 建立新頁面 + WAF 繞過 ═══
   * 為 POST/SSE 請求建立隔離的暫時頁面，
   * 避免 POST fetch 導致 main page (this.page) 被關閉。
   *
   * 流程：
   *   1. 建立新頁面
   *   2. 導航至 chat.qwen.ai 通過 WAF 挑戰
   *   3. 設定 token Cookie
   *   4. 等待 WAF 通過（頁面 title 含 qwen/chat 等）
   *   5. 回傳 page 物件供調用方使用
   *
   * @returns {Promise<Page|null>} Puppeteer Page 或 null
   */
  async _freshInitPage() {
    if (!this.browser || !this.browser.isConnected()) return null;
    const account = accountManager.getAccount();
    const token = account ? account.token : "";
    let page = null;
    const _t0 = Date.now();
    // ═══ 整體 25s 逾時保護（避免 request 被永久懸掛） ═══
    try {
      page = await Promise.race([
        this.browser.newPage(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("newPage 逾時 15s")), 15000),
        ),
      ]);
      logger.info(`暫時頁面建立 (${Date.now() - _t0}ms)`, "CHROME");
      // 導航至 chat.qwen.ai 觸發 WAF 挑戰
      const navRes = await page.goto(this.chatBaseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000, // 20s WAF 導航逾時
      });
      logger.info(`暫時頁面導航完成 (${Date.now() - _t0}ms)`, "CHROME");
      // 設定 token Cookie（CDP 方式，不依賴 frame）
      if (token && navRes) {
        const status = navRes.status();
        if (status !== 403 && status !== 503) {
          try {
            const cdp = await page.createCDPSession();
            await cdp.send("Network.setCookie", {
              name: "token",
              value: token,
              domain: ".chat.qwen.ai",
              path: "/",
              httpOnly: false,
              secure: true,
            });
          } catch {}
        }
      }
      // 等待 WAF 挑戰完成（最長 10s）
      try {
        await page.waitForFunction(
          () => {
            const t = document.title.toLowerCase();
            return (
              t.includes("qwen") ||
              t.includes("千问") ||
              t.includes("chat") ||
              t.includes("studio")
            );
          },
          { timeout: 10000 },
        );
      } catch {
        // WAF 超時非致命，繼續嘗試
      }
      logger.info(`暫時頁面就緒 (${Date.now() - _t0}ms)`, "CHROME");
      return page;
    } catch (e) {
      if (page) {
        try {
          if (!page.isClosed()) await page.close();
        } catch {}
      }
      logger.warn(
        `建立暫時頁面失敗 (${Date.now() - _t0}ms): ${e.message}`,
        "CHROME",
      );
      return null;
    }
  }

  async init() {
    if (
      process.env.DISABLE_BROWSER === "true" ||
      process.env.CHROME_DISABLED === "true"
    ) {
      logger.warn(
        "[CHROME] ⛔ Chrome Fetch 已透過環境變數禁用，將直接使用 Axios",
      );
      this.ready = false;
      return;
    }
    if (this.ready) return;
    if (this._initLock) return this._initLock;

    // ═══ 斷路器檢查：連續失敗時採用指數退避 ═══
    if (!_cbShouldTry()) {
      if (!CB._warned) {
        const waitSec = Math.round(
          (CB.cooldown - (Date.now() - CB.lastAttempt)) / 1000,
        );
        logger.warn(
          `[CHROME] ⏳ 斷路器開啟，等待 ${waitSec}s 後再試（已連續失敗 ${CB.failures} 次）`,
        );
        CB._warned = true;
      }
      return;
    }

    this._initLock = this._doInit();
    try {
      await this._initLock;
      _cbRecordSuccess();
    } catch (e) {
      _cbRecordFail();
      logger.warn(
        `[CHROME] ⚠️ 初始化異常: ${e.message}，降級至 Axios（下次重試 ${Math.round(CB.cooldown / 1000)}s 後）`,
      );
      await this.destroy().catch(() => {});
      this.ready = false;
    }
    this._initLock = null;
  }

  async _doInit() {
    const chromePath = this.findChrome();
    if (!chromePath) throw new Error("Chrome 未安裝");

    const fs = require("fs");
    const path = require("path");
    const CHROME_DIR = path.join(__dirname, "../../.chrome-qwen-profile");
    if (!fs.existsSync(CHROME_DIR))
      fs.mkdirSync(CHROME_DIR, { recursive: true });
    // 清理殘留 Chrome 進程 + 鎖檔
    try {
      require("child_process").execSync(
        "killall -9 chrome google-chrome chromium 2>/dev/null || true",
        { stdio: "pipe" },
      );
    } catch {}
    this._cleanProfileLock(CHROME_DIR);

    this._initT0 = Date.now();
    logger.info("Chrome Fetch Proxy v3 初始化...", "CHROME");

    const execSync = require("child_process").execSync;
    const launchChrome = async (tryCount) => {
      try {
        // ═══ Fix 2026-07-06 (v3): 移除 --single-process ═══
        // Chrome 149 的 --single-process + --headless 導致 browser crash，
        // 即使 fallback 也無法穩定。機器 15GB RAM 充足，改用多進程模式。
        // 一律使用 --headless=new（現代無頭模式，Chrome 149+ 穩定）。
        const UA =
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
        const baseArgs = [
          `--user-data-dir=${CHROME_DIR}`,
          "--headless=new",
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
          "--disable-features=IsolateOrigins,site-per-process,Gcm,Translate",
          "--disable-popup-blocking",
          "--disable-session-crashed-bubble",
          "--disable-infobars",
          "--disable-breakpad",
          "--noerrdialogs",
          "--enable-logging=stderr",
          "--v=0",
          "--disable-component-update",
          "--disable-background-networking",
          "--disable-sync",
          "--disable-ipc-flooding-protection",
          "--disable-prompt-on-repost",
          "--disable-software-rasterizer",
          "--window-size=1280,720",
          `--user-agent=${UA}`,
        ];
        return await puppeteer.launch({
          executablePath: chromePath,
          headless: true,
          args: baseArgs,
          defaultViewport: { width: 1280, height: 720 },
          timeout: 45000,
          protocolTimeout: 300000, // ═══ Fix: page.evaluate 串流長時間運行不因 protocol 超時中斷 ═══
          dumpio: false,
        });
      } catch (e) {
        // profile 被佔用 → 殺光 Chrome 進程 + 清鎖檔 + 重試一次
        if (tryCount < 1 && (e.message || "").includes("already running")) {
          logger.warn("Chrome profile 被佔用，強制清理後重試...", "CHROME");
          try {
            execSync(
              "killall -9 chrome google-chrome chromium chromium-browser 2>/dev/null || true",
              { stdio: "pipe" },
            );
          } catch {}
          this._cleanProfileLock(CHROME_DIR);
          await new Promise((r) => setTimeout(r, 1000));
          return launchChrome(1);
        }
        throw e;
      }
    };

    this.browser = await launchChrome(0);

    // ═══ Fix 7: 關閉預設 page，建立全新頁面（避免「Requesting main frame too early」）═══
    const existingPages = await this.browser.pages();
    for (const p of existingPages) {
      try {
        await p.close();
      } catch {}
    }
    this.page = await this.browser.newPage();

    // 設定 token Cookie (使用 CDP Network.setCookie 繞過 page.setCookie 的 frame 依賴)
    const account = accountManager.getAccount();
    const token = account ? account.token : "";
    if (token) {
      try {
        // ═══ Fix 6: 先導航至 chat.qwen.ai 再設 Cookie，確保 CDP session 可用 ═══
        const navRes = await this.page.goto(this.chatBaseUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        // ═══ 檢查 WAF 阻擋：如果狀態碼是 403/503 或 body 含 WAF 關鍵字，跳過 Cookie 設定 ═══
        if (navRes && (navRes.status() === 403 || navRes.status() === 503)) {
          logger.warn(
            "[CHROME] WAF 阻擋頁面 (HTTP " +
              navRes.status() +
              ")，先嘗試繼續...",
            "CHROME",
          );
        } else {
          const cdp = await this.page.createCDPSession();
          await cdp.send("Network.setCookie", {
            name: "token",
            value: token,
            domain: ".chat.qwen.ai",
            path: "/",
            httpOnly: false,
            secure: true,
          });
        }
      } catch {
        // fallback: 正常導航後 Cookie 由 WAF 流程處理，此處非必要
      }
    } else {
      // 無 token 仍導航至 chat.qwen.ai
      try {
        await this.page.goto(this.chatBaseUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      } catch {}
    }

    // 設定 SSE 事件橋接
    await this.page.exposeFunction("__qwenFetchOnData", (reqId, data) => {
      const cb = this.callbacks.get(reqId);
      if (cb) cb.onData(data);
    });
    await this.page.exposeFunction("__qwenFetchOnDone", (reqId) => {
      const cb = this.callbacks.get(reqId);
      if (cb) {
        this.callbacks.delete(reqId);
        cb.onDone();
      }
    });
    await this.page.exposeFunction("__qwenFetchOnError", (reqId, err) => {
      const cb = this.callbacks.get(reqId);
      if (cb) {
        this.callbacks.delete(reqId);
        cb.onError(err);
      }
    });

    // 等待 WAF 挑戰完成
    try {
      await this.page.waitForFunction(
        () => {
          const t = document.title.toLowerCase();
          return (
            t.includes("qwen") ||
            t.includes("千问") ||
            t.includes("chat") ||
            t.includes("studio")
          );
        },
        { timeout: 20000 },
      );
      logger.success("WAF 挑戰通過！", "CHROME");
    } catch {
      logger.warn("WAF 等待超時 (20s)，仍嘗試繼續...", "CHROME");
    }

    // 注入通用 fetch 包裝函式 (供 page.evaluate 呼叫)
    await this.page.evaluate(() => {
      window.__qwenApiFetch = async function (url, opts) {
        const res = await fetch(url, opts);
        return {
          ok: res.ok,
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          body: await res.text(),
        };
      };
    });

    this.ready = true;
    // ═══ Fix 5: Chrome crash/disconnect 時徹底清理子程序 ═══
    this.browser.on("disconnected", () => {
      logger.warn("Chrome 瀏覽器連線中斷，標記為未就緒", "CHROME");
      // ═══ Fix 8: 銷毀所有 active streams，避免串流永久懸掛 ═══
      for (const [rid, cb] of this.callbacks) {
        clearTimeout(cb._tid);
        try {
          cb._stream?.destroy(new Error("Chrome 瀏覽器連線中斷"));
        } catch {}
      }
      this.callbacks.clear();
      try {
        if (this.browser && this.browser.process) {
          this.browser.process().kill("SIGKILL");
        }
      } catch (_) {}
      this.ready = false;
      this.page = null;
      this.browser = null;
    });
    const elapsed = Date.now() - this._initT0;
    logger.success(`Chrome Fetch 初始化完成 (${elapsed}ms)`, "CHROME");
  }

  /**
   * 建立新聊天 — 使用 Chrome 原生 fetch 繞過 WAF（含 JA3 TLS 指紋）
   * ═══ Fix 2026-07-07: 使用暫時頁面隔離 POST crash ═══
   * 原本用 this.page.evaluate()，但 POST fetch 導致 Chrome target 關閉
   * （Target closed），使 main page 無法再用於後續健康檢查與 GET 請求。
   * 改用 _freshInitPage() 建立暫時頁面，POST 即使 crash 也只影響暫時頁面，
   * main page 保持健康。
   *
   * @param {string} model - 上游模型名稱
   * @param {string} [token] - JWT token
   * @returns {Promise<string|null>} chat_id
   */
  async createChat(model, token) {
    if (
      process.env.DISABLE_BROWSER === "true" ||
      process.env.CHROME_DISABLED === "true"
    )
      return null;
    if (!token) {
      const account = accountManager.getAccount();
      token = account ? account.token : "";
    }
    if (!token) return null;

    await this.init();
    if (!this.ready || !this.browser) return null;

    // ═══ Fix: 使用暫時頁面（非 this.page）執行 POST fetch ═══
    const tempPage = await this._freshInitPage();
    if (!tempPage) {
      logger.warn("createChat: 無法建立暫時頁面", "CHROME");
      return null;
    }

    try {
      // ═══ Fix: page.evaluate 加入 20s 逾時，防止 POST 永久懸掛 ═══
      const chatId = await Promise.race([
        tempPage.evaluate(
          async (baseUrl, model, token) => {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 15000);
            try {
              const res = await fetch(`${baseUrl}/api/v2/chats/new`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: "Bearer " + token,
                  source: "web",
                  version: "0.2.63",
                },
                body: JSON.stringify({
                  title: "New Chat",
                  models: [model],
                  chat_mode: "normal",
                  chat_type: "t2t",
                  timestamp: Date.now(),
                }),
                signal: controller.signal,
              });
              clearTimeout(tid);
              if (!res.ok) {
                const txt = await res.text().catch(() => "");
                throw new Error(`HTTP ${res.status}: ${txt.substring(0, 200)}`);
              }
              const json = await res.json();
              return json?.data?.id || null;
            } catch (e) {
              clearTimeout(tid);
              throw e;
            }
          },
          this.chatBaseUrl,
          model,
          token,
        ),
        new Promise((_, rej) =>
          setTimeout(
            () => rej(new Error("createChat evaluate 逾時 20s")),
            20000,
          ),
        ),
      ]);

      return chatId;
    } catch (e) {
      logger.warn(
        `createChat 失敗 (${Date.now() - (this._initT0 || Date.now())}ms): ${e.message}（暫時頁面，不影響 main page）`,
        "CHROME",
      );
      return null;
    } finally {
      await tempPage.close().catch(() => {});
    }
  }

  /**
   * 發送 SSE 串流聊天請求，透過 PassThrough stream 橋接
   * @param {object} payload - 完整請求 body (含 messages, model, chat_id 等)
   * @param {object} [account] - 帳號物件 (含 token)
   * @returns {{ status: boolean, response: PassThrough|null, currentAccount: object|null }}
   */
  async sendChatRequest(payload, account) {
    if (
      process.env.DISABLE_BROWSER === "true" ||
      process.env.CHROME_DISABLED === "true"
    )
      return { status: false, response: null };
    await this.init();
    if (!this.ready) return { status: false, response: null };

    const currentAccount = account || accountManager.getAccount();
    const token = currentAccount ? currentAccount.token : "";
    if (!token) {
      logger.error("Chrome Fetch: 無可用 token", "CHROME");
      return { status: false, response: null, currentAccount: null };
    }

    // 先建立 chat (如果 payload 沒有 chat_id)
    let chatId = payload.chat_id;
    if (!chatId) {
      chatId = await this.createChat(payload.model, token);
      if (!chatId) {
        logger.error("Chrome Fetch: 建立 chat 失敗", "CHROME");
        return { status: false, response: null, currentAccount };
      }
    }

    // 建立 PassThrough 串流
    const stream = new PassThrough();
    const reqId = ++this.reqSeq;

    this.callbacks.set(reqId, {
      _stream: stream,
      _tid: null,
      onData: (chunk) => {
        try {
          stream.write(Buffer.from(chunk));
        } catch {}
      },
      onDone: () => {
        try {
          stream.end(null);
        } catch {}
      },
      onError: (errMsg) => {
        try {
          stream.destroy(new Error(errMsg));
        } catch {}
      },
    });

    // 設定超時清理
    const timeoutId = setTimeout(() => {
      const cb = this.callbacks.get(reqId);
      if (cb) {
        this.callbacks.delete(reqId);
        try {
          stream.destroy(new Error("Chrome Fetch 超時 (60s)"));
        } catch {}
      }
    }, 120000);
    this.callbacks.get(reqId)._tid = timeoutId;

    // 在回呼中清除 timeout
    const origOnDone = this.callbacks.get(reqId).onDone;
    this.callbacks.get(reqId).onDone = () => {
      clearTimeout(timeoutId);
      origOnDone();
    };
    const origOnError = this.callbacks.get(reqId).onError;
    this.callbacks.get(reqId).onError = (err) => {
      clearTimeout(timeoutId);
      origOnError(err);
    };

    // 建構上游請求 payload (沿用 middleware 處理好的格式)
    const upstreamPayload = {
      stream: true,
      version: payload.version || "2.1",
      incremental_output: payload.incremental_output !== false,
      chat_id: chatId,
      chat_mode: payload.chat_mode || "normal",
      model: payload.model,
      parent_id: payload.parent_id || null,
      messages: payload.messages || [],
      timestamp: payload.timestamp || Math.floor(Date.now() / 1000),
      ...(payload.chat_type ? { chat_type: payload.chat_type } : {}),
    };

    // ═══ Fix 2026-07-07: 使用暫時頁面執行 SSE（隔離 main page） ═══
    // 原本用 this.page.evaluate()，POST 請求會導致 Chrome target 關閉，
    // 使得 main page 死亡影響後續 GET/健康檢查。
    // 改用 _freshInitPage() 建立專用 SSE 頁面，crash 時不影響 main page。
    // SSE 頁面在串流結束或錯誤時自動關閉（透過 onDone/onError 包裝）。
    const _runSseOnPage = async (targetPage) => {
      // 在目標頁面註冊 exposeFunction 橋接
      try {
        await targetPage.exposeFunction("__qwenFetchOnData", (id, data) => {
          const cb = this.callbacks.get(id);
          if (cb) cb.onData(data);
        });
        await targetPage.exposeFunction("__qwenFetchOnDone", (id) => {
          const cb = this.callbacks.get(id);
          if (cb) {
            this.callbacks.delete(id);
            cb.onDone();
          }
        });
        await targetPage.exposeFunction("__qwenFetchOnError", (id, err) => {
          const cb = this.callbacks.get(id);
          if (cb) {
            this.callbacks.delete(id);
            cb.onError(err);
          }
        });
      } catch {
        // exposeFunction 失敗（page 已關閉等），跳過
        return false;
      }

      // 包裝 callbacks 以在完成時關閉 SSE 頁面
      const _closeSsePage = () => {
        try {
          if (!targetPage.isClosed()) targetPage.close();
        } catch {}
      };
      const origOnDone = this.callbacks.get(reqId).onDone;
      this.callbacks.get(reqId).onDone = () => {
        clearTimeout(timeoutId);
        origOnDone();
        _closeSsePage();
      };
      const origOnError = this.callbacks.get(reqId).onError;
      this.callbacks.get(reqId).onError = (err) => {
        clearTimeout(timeoutId);
        origOnError(err);
        _closeSsePage();
      };

      targetPage
        .evaluate(
          async (reqId, baseUrl, chatId, payload, token) => {
            try {
              const res = await fetch(
                `${baseUrl}/api/v2/chat/completions?chat_id=${chatId}`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                    source: "web",
                    version: "0.2.67",
                    Accept: "text/event-stream",
                  },
                  body: JSON.stringify(payload),
                },
              );

              if (!res.ok) {
                const text = await res.text();
                window.__qwenFetchOnError(
                  reqId,
                  `HTTP ${res.status}: ${text.substring(0, 200)}`,
                );
                return;
              }

              const reader = res.body.getReader();
              const decoder = new TextDecoder();

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                if (chunk) window.__qwenFetchOnData(reqId, chunk);
              }

              window.__qwenFetchOnDone(reqId);
            } catch (e) {
              window.__qwenFetchOnError(reqId, e.message);
            }
          },
          reqId,
          this.chatBaseUrl,
          chatId,
          upstreamPayload,
          token,
        )
        .catch((e) => {
          logger.error(`Chrome SSE page.evaluate 失敗: ${e.message}`, "CHROME");
          const cb = this.callbacks.get(reqId);
          if (cb) {
            this.callbacks.delete(reqId);
            clearTimeout(timeoutId);
            try {
              stream.destroy(
                new Error(`Chrome SSE evaluate 失敗: ${e.message}`),
              );
            } catch {}
          }
          _closeSsePage();
        });

      return true;
    };

    // 嘗試使用暫時頁面，失敗時降級至 main page
    const ssePage = await this._freshInitPage();
    if (ssePage) {
      await _runSseOnPage(ssePage);
    } else {
      // 降級：使用 main page（若仍存活）
      if (this.page && this.ready) {
        logger.warn("SSE 暫時頁面建立失敗，降級至 main page", "CHROME");
        this.page
          .evaluate(
            async (reqId, baseUrl, chatId, payload, token) => {
              try {
                const res = await fetch(
                  `${baseUrl}/api/v2/chat/completions?chat_id=${chatId}`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: "Bearer " + token,
                      source: "web",
                      version: "0.2.67",
                      Accept: "text/event-stream",
                    },
                    body: JSON.stringify(payload),
                  },
                );

                if (!res.ok) {
                  const text = await res.text();
                  window.__qwenFetchOnError(
                    reqId,
                    `HTTP ${res.status}: ${text.substring(0, 200)}`,
                  );
                  return;
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const chunk = decoder.decode(value, { stream: true });
                  if (chunk) window.__qwenFetchOnData(reqId, chunk);
                }

                window.__qwenFetchOnDone(reqId);
              } catch (e) {
                window.__qwenFetchOnError(reqId, e.message);
              }
            },
            reqId,
            this.chatBaseUrl,
            chatId,
            upstreamPayload,
            token,
          )
          .catch((e) => {
            logger.error(
              `Chrome (main) page.evaluate 失敗: ${e.message}`,
              "CHROME",
            );
            const cb = this.callbacks.get(reqId);
            if (cb) {
              this.callbacks.delete(reqId);
              clearTimeout(timeoutId);
              try {
                stream.destroy(new Error(`Chrome evaluate 失敗: ${e.message}`));
              } catch {}
            }
          });
      } else {
        // main page 也不可用
        logger.error("Chrome 無可用頁面執行 SSE", "CHROME");
        this.callbacks.delete(reqId);
        clearTimeout(timeoutId);
        try {
          stream.destroy(new Error("Chrome 無可用頁面"));
        } catch {}
        return { status: false, response: null, currentAccount };
      }
    }

    return { status: true, response: stream, currentAccount };
  }

  /**
   * 一般 HTTP 請求 (非串流, 用於 getLatestModels 等)
   * @param {string} url - 完整 URL
   * @param {object} [opts] - { method, headers, body }
   * @returns {Promise<{ok:boolean, status:number, body:string}>}
   */
  async fetch(url, opts = {}) {
    if (
      process.env.DISABLE_BROWSER === "true" ||
      process.env.CHROME_DISABLED === "true"
    )
      return { ok: false, status: 0, body: "" };
    await this.init();

    const result = await this.page.evaluate(
      async (url, opts) => {
        // 內部 fetch 設定 12s timeout，避免模型列表請求永久掛起
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          const res = await fetch(url, {
            method: opts.method || "GET",
            headers: opts.headers || {},
            body: opts.body || undefined,
            signal: controller.signal,
          });
          clearTimeout(timer);
          return {
            ok: res.ok,
            status: res.status,
            body: await res.text(),
          };
        } catch (e) {
          clearTimeout(timer);
          return { ok: false, status: 0, body: e.message };
        }
      },
      url,
      opts,
    );

    return result;
  }

  /**
   * 取得目前頁面 cookies
   */
  async getCookies() {
    if (
      process.env.DISABLE_BROWSER === "true" ||
      process.env.CHROME_DISABLED === "true"
    )
      return [];
    await this.init();
    return this.page.cookies();
  }

  /**
   * 健康檢查
   * 驗證 Chrome 頁面是否仍可正常執行 JS，且非 WAF/錯誤頁面
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    if (
      process.env.DISABLE_BROWSER === "true" ||
      process.env.CHROME_DISABLED === "true"
    )
      return false;
    try {
      if (!this.ready || !this.browser || !this.page) return false;
      if (!this.browser.isConnected()) {
        this.ready = false;
        return false;
      }
      const result = await this.page.evaluate(() => {
        try {
          const title = (document.title || "").toLowerCase();
          const body = (document.body?.innerText || "").toLowerCase();
          // WAF/錯誤頁面偵測
          if (
            body.includes("waf") ||
            body.includes("blocked") ||
            body.includes("captcha") ||
            body.includes("verify") ||
            body.includes("安全驗證") ||
            body.includes("請確認你不是機器人")
          ) {
            return false;
          }
          return title.length > 0;
        } catch {
          return false;
        }
      });
      return !!result;
    } catch {
      this.ready = false;
      return false;
    }
  }

  /**
   * 自動恢復（含指數退避）
   * 重新啟動 Chrome 並通過 WAF
   */
  async recover() {
    // 斷路器檢查
    if (!_cbShouldTry()) {
      if (!CB._warned) {
        const waitSec = Math.round(
          (CB.cooldown - (Date.now() - CB.lastAttempt)) / 1000,
        );
        logger.warn(
          `[CHROME] ⏳ 恢復跳過：斷路器開啟，等待 ${waitSec}s（已連續失敗 ${CB.failures} 次）`,
        );
        CB._warned = true;
      }
      return false;
    }

    logger.warn("Chrome Fetch 正在自動恢復...", "CHROME");
    try {
      await this.destroy();
    } catch {}
    this._initLock = null;
    initPromise = null;
    try {
      await this.init();
      if (this.ready) {
        _cbRecordSuccess();
        logger.success("Chrome Fetch 自動恢復成功", "CHROME");
        return true;
      }
      // init() 返回了但 browser 未就緒（_doInit 失敗被 init 內部吞掉）
      _cbRecordFail();
      logger.error(
        `Chrome Fetch 自動恢復失敗: browser 未就緒（下次 ${Math.round(CB.cooldown / 1000)}s 後重試）`,
        "CHROME",
      );
      return false;
    } catch (e) {
      _cbRecordFail();
      logger.error(
        `Chrome Fetch 自動恢復失敗: ${e.message}（下次 ${Math.round(CB.cooldown / 1000)}s 後重試）`,
        "CHROME",
      );
      return false;
    }
  }

  /**
   * 清理資源
   * ═══ Fix 2026-07-06: SIGTERM 優先 → 等待 3s → SIGKILL 最後手段 + profile 清理 ═══
   */
  async destroy() {
    this.ready = false;
    this.callbacks.clear();
    if (this.browser) {
      const proc = this.browser.process();
      try {
        // 先 SIGTERM 讓 Chrome 優雅關閉（避免 profile 損毀）
        if (proc) proc.kill("SIGTERM");
        await this.browser.close();
      } catch (_) {}
      // 等 3s 讓 Chrome 完全關閉
      await new Promise((r) => setTimeout(r, 3000));
      // 若進程仍存活，強制 SIGKILL
      if (proc) {
        try {
          proc.kill("SIGKILL");
        } catch (_) {}
      }
      this.browser = null;
      this.page = null;
      // 清理 profile 鎖檔，確保下次啟動不卡
      const fs = require("fs");
      const path = require("path");
      const CHROME_DIR = path.join(__dirname, "../../.chrome-qwen-profile");
      this._cleanProfileLock(CHROME_DIR);
    }
    instance = null;
    logger.info("Chrome Fetch Proxy 已關閉", "CHROME");
  }
}

function getInstance() {
  if (!instance) instance = new ChromeFetch();
  return instance;
}

module.exports = { ChromeFetch, getInstance };
