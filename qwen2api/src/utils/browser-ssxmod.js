/**
 * 瀏覽器型 SSXMOD Cookie 提取器
 * 使用 Puppeteer 開啟真實瀏覽器 → 通過 WAF 挑戰 → 提取真實 SSXMOD Cookie
 * 回退：若無法提取則回傳 null，由 ssxmod-manager 決定是否繼續使用合成 Cookie
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { logger } = require("./logger");

const CHROME_DIR = path.join(__dirname, "../../.chrome-qwen-profile");
const MAX_WAIT = 60 * 1000;
const NAV_TIMEOUT = 30 * 1000;

const CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function findChrome() {
  for (const p of CHROME_PATHS) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

/**
 * 啟動 Chrome 並提取 SSXMOD Cookie
 * @param {number} [retries=2] - 重試次數
 * @returns {Promise<{ssxmod_itna:string, ssxmod_itna2:string, timestamp:number}|null>}
 */
async function extractSsxmodCookies(retries = 2) {
  const chromePath = findChrome();
  if (!chromePath) {
    logger.warn("未找到 Chrome 可執行檔", "SSXMOD");
    return null;
  }

  if (!fs.existsSync(CHROME_DIR)) {
    fs.mkdirSync(CHROME_DIR, { recursive: true });
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    let browser;
    try {
      const launchArgs = [
        `--user-data-dir=${CHROME_DIR}`,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=IsolateOrigins,site-per-process,Gcm",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-agent=${UA}`,
        "--window-size=1280,720",
      ];

      browser = await puppeteer.launch({
        executablePath: chromePath,
        args: launchArgs,
        headless: attempt === 0 ? "new" : false,
        defaultViewport: { width: 1280, height: 720 },
        timeout: 30000,
      });

      const pages = await browser.pages();
      const page = pages[0] || (await browser.newPage());

      // 設定 Cookie 讓瀏覽器帶上 token（可加速認證）
      // 導航至 chat.qwen.ai
      logger.info(
        `瀏覽器 SSXMOD 提取 (嘗試 ${attempt + 1}/${retries + 1})`,
        "SSXMOD",
      );

      await page.goto("https://chat.qwen.ai", {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT,
      });

      // 等待 WAF 挑戰完成（檢測頁面標題是否為正常 AI Chat 頁面）
      try {
        await page.waitForFunction(
          () => {
            const t = document.title.toLowerCase();
            return (
              t.includes("qwen") ||
              t.includes("千问") ||
              t.includes("chat") ||
              t.includes("通义")
            );
          },
          { timeout: MAX_WAIT },
        );
      } catch {
        // timeout — WAF 可能仍在挑戰或已阻擋
        // 依舊嘗試提取 cookies
      }

      // 等待一下確保 cookie 同步
      await new Promise((r) => setTimeout(r, 2000));

      const cookies = await page.cookies();
      const ssxmod_itna = cookies.find((c) => c.name === "ssxmod_itna")?.value;
      const ssxmod_itna2 = cookies.find(
        (c) => c.name === "ssxmod_itna2",
      )?.value;

      await browser.close();
      browser = null;

      if (ssxmod_itna && ssxmod_itna2) {
        logger.success(
          `SSXMOD Cookie 提取成功 (itna: ${ssxmod_itna.substring(0, 30)}...)`,
          "SSXMOD",
        );
        return {
          ssxmod_itna,
          ssxmod_itna2,
          timestamp: Date.now(),
        };
      }

      logger.warn(
        `提取結果無 SSXMOD Cookie (itna=${!!ssxmod_itna}, itna2=${!!ssxmod_itna2})`,
        "SSXMOD",
      );
    } catch (error) {
      logger.error(
        `瀏覽器 SSXMOD 提取失敗 (嘗試 ${attempt + 1})`,
        "SSXMOD",
        "",
        error.message,
      );
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return null;
}

module.exports = { extractSsxmodCookies, findChrome };
