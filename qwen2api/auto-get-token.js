const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execSync, spawn } = require("child_process");
const readline = require("readline");

const DATA_FILE = path.join(__dirname, "data/data.json");
const CHROME_DIR = path.join(__dirname, ".chrome-qwen-profile");
const DEBUG_PORT = 9223;
const MAX_WAIT = 180;

function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8"),
    );
    return decoded;
  } catch {
    return null;
  }
}

const log = (msg) => console.log(msg);
const error = (msg) => console.error(msg);

async function findChrome() {
  const isWin = process.platform === "win32";
  const paths = isWin
    ? [
        process.env["ProgramFiles"] +
          "\\Google\\Chrome\\Application\\chrome.exe",
        process.env["ProgramFiles(x86)"] +
          "\\Google\\Chrome\\Application\\chrome.exe",
        path.join(
          require("os").homedir(),
          "AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
        ),
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
      ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function tryExtractToken(browserURL) {
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL, defaultViewport: null });
    const pages = await browser.pages();
    let target = pages.find((p) => p.url().includes("chat.qwen.ai"));

    if (!target) {
      target = await browser.newPage();
      await target
        .goto("https://chat.qwen.ai", {
          waitUntil: "domcontentloaded",
          timeout: 10000,
        })
        .catch(() => {});
    }

    if (target) {
      const token = await target.evaluate(() => localStorage.getItem("token"));
      if (token && token.startsWith("eyJ")) {
        await browser.disconnect();
        return token;
      }
    }
    await browser.disconnect();
  } catch (e) {}
  return null;
}

async function main() {
  log("🔍 尋找 Chrome...");
  const chrome = await findChrome();
  if (!chrome) {
    error("❌ 未找到 Chrome");
    process.exit(1);
  }
  log("✅ Chrome: " + chrome);

  log("🔗 嘗試連線已執行的 Chrome...");
  let token = await tryExtractToken("http://localhost:9222");
  if (token) {
    log("\n✅ 從已執行的 Chrome 提取 Token 成功！");
    if (updateDataFile(token)) {
      restartQwen2API();
      return;
    }
    showFinish();
    return;
  }

  token = await tryExtractToken(`http://localhost:${DEBUG_PORT}`);
  if (token) {
    log("\n✅ 從 Qwen Chrome Profile 提取 Token 成功！");
    if (updateDataFile(token)) {
      restartQwen2API();
      return;
    }
    showFinish();
    return;
  }

  log("📝 未找到已連線 Chrome，啟動 Headless 模式...");
  if (!fs.existsSync(CHROME_DIR)) fs.mkdirSync(CHROME_DIR, { recursive: true });

  const headlessToken = await tryHeadlessExtraction(chrome);
  if (headlessToken) {
    log("\n✅ Headless 模式提取 Token 成功！");
    if (updateDataFile(headlessToken)) {
      restartQwen2API();
      return;
    }
    showFinish();
    return;
  }

  log("\n⚠️ Headless 模式無法取得 Token（快取 session 可能已過期）");
  log("📝 降級到 GUI 模式，啟動 Chrome 視窗...");

  log("🚀 啟動 Chrome（獨立配置，需登入 GitHub）...");
  const cp = spawn(
    chrome,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${CHROME_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://chat.qwen.ai",
    ],
    { detached: true, stdio: "ignore" },
  );
  cp.unref();

  await sleep(3000);

  log("\n📝 請在彈出的 Chrome 視窗中用 GitHub 登入");
  log("   登入完成後指令碼會自動提取 Token\n");

  let elapsed = 0;
  let browser;

  while (elapsed < MAX_WAIT) {
    try {
      if (!browser) {
        browser = await puppeteer.connect({
          browserURL: `http://localhost:${DEBUG_PORT}`,
          defaultViewport: null,
        });
      }

      const pages = await browser.pages();
      const target = pages.find((p) => p.url().includes("chat.qwen.ai"));

      if (target) {
        const t = await target.evaluate(() => localStorage.getItem("token"));
        if (t && t.startsWith("eyJ")) {
          log("\n✅ Token 提取成功！");
          if (updateDataFile(t)) {
            restartQwen2API();
            return;
          }
          showFinish();
          return;
        }
      }
    } catch (e) {}
    await sleep(2000);
    elapsed += 2;
    process.stdout.write(`\r   ⏳ 等待登入... ${elapsed}s / ${MAX_WAIT}s`);
  }

  log("\n\n❌ 超時，請確認已成功登入");
  process.exit(1);
}

async function tryHeadlessExtraction(chromePath, retried = false) {
  let browser;
  let overallTimer;
  try {
    const timeout = new Promise((_, reject) => {
      overallTimer = setTimeout(
        () => reject(new Error("Headless extraction timeout (60s)")),
        60000,
      );
    });

    const work = (async () => {
      browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        userDataDir: CHROME_DIR,
        timeout: 30000,
        args: [
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-sandbox",
        ],
      });

      const page = await browser.newPage();
      await page.goto("https://chat.qwen.ai", {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });

      await sleep(2000);

      const token = await page.evaluate(() => localStorage.getItem("token"));
      return token;
    })();

    const token = await Promise.race([work, timeout]);
    clearTimeout(overallTimer);

    if (token && token.startsWith("eyJ")) {
      await browser.close();
      return token;
    }

    await browser.close();
    return null;
  } catch (e) {
    if (overallTimer) clearTimeout(overallTimer);
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }

    const msg = e.message || "";
    const isLocked =
      msg.includes("profile") ||
      msg.includes("lock") ||
      msg.includes("EXDEV") ||
      msg.includes("locked") ||
      msg.includes("timed out");

    if (isLocked && !retried) {
      log("⚠️  Chrome profile 被鎖定，清理殘留行程後重試...");
      killStaleChrome();
      await sleep(3000);
      return tryHeadlessExtraction(chromePath, true);
    }

    log(
      `⚠️  Headless 提取失敗${isLocked ? "（已重試仍失敗）" : ""}: ${msg.slice(0, 80)}`,
    );
    return null;
  }
}

function killStaleChrome() {
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      execSync("taskkill /F /IM chrome.exe 2>nul", {
        timeout: 3000,
        stdio: "ignore",
      });
    } else {
      execSync(
        `ps aux | grep '${CHROME_DIR}' | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true`,
        { timeout: 3000, stdio: "ignore" },
      );
    }
  } catch {
    /* best effort */
  }
}

function updateDataFile(token) {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  if (!data.accounts || data.accounts.length === 0) {
    data.accounts = [{}];
  }

  // token 未變則跳過重啟
  const oldToken = data.accounts[0]?.token || "";
  if (token === oldToken) {
    log("📁 Token 未變更，跳過重啟");
    return false;
  }

  const existingPassword = data.accounts[0]?.password || "";

  const decoded = decodeJwt(token);
  const expires = decoded?.exp
    ? decoded.exp
    : Math.floor(Date.now() / 1000) + 86400 * 7;

  data.accounts[0].email = data.accounts[0].email || "github-user@qwen.ai";
  data.accounts[0].password = existingPassword;
  data.accounts[0].token = token;
  data.accounts[0].expires = expires;
  data.accounts[0].refresh_method = "browser";

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  log("📁 已更新 data.json，到期: " + new Date(expires * 1000).toISOString());
  return true;
}

function checkServer(cb) {
  const req = http.get("http://localhost:3000/v1/models", (res) => {
    if (res.statusCode >= 200 && res.statusCode < 500) {
      cb(true);
    } else {
      cb(false);
    }
  });
  req.on("error", () => cb(false));
  req.setTimeout(5000, () => {
    req.destroy();
    cb(false);
  });
}

function getPids(port) {
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      const out = execSync(
        `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do @echo %a`,
        { timeout: 3000, encoding: "utf8" },
      );
      return [
        ...new Set(
          out
            .trim()
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
        ),
      ];
    }
    const out = execSync(`lsof -ti :${port} 2>/dev/null`, {
      timeout: 3000,
      encoding: "utf8",
    }).trim();
    return out
      ? [
          ...new Set(
            out
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

function killPids(pids, signal) {
  for (const pid of pids) {
    try {
      execSync(`kill -${signal} ${pid} 2>/dev/null`, { timeout: 3000 });
    } catch (_) {}
  }
}

function killPort(port) {
  const p = parseInt(port, 10);
  if (isNaN(p)) return;
  const pids = getPids(p);
  if (!pids.length) return;
  killPids(pids, "TERM");
  for (let i = 0; i < 5; i++) {
    const alive = pids.filter((pid) => {
      try {
        execSync(`kill -0 ${pid} 2>/dev/null`, { timeout: 1000 });
        return true;
      } catch {
        return false;
      }
    });
    if (!alive.length) return;
    execSync("sleep 1", { timeout: 1000, stdio: "ignore" });
  }
  killPids(pids, 9);
}

function restartQwen2API() {
  log("\n🔄 正在重啟 Qwen2API...");
  const isWin = process.platform === "win32";
  const BUN = isWin ? "bun.exe" : "bun";

  log("   停止舊服務（埠 3000）...");
  killPort(3000);

  log("   等待埠釋放...");
  for (let i = 0; i < 10; i++) {
    try {
      if (isWin) {
        execSync("netstat -ano | findstr :3000", {
          stdio: ["pipe", "pipe", "ignore"],
        });
      } else {
        execSync("lsof -i :3000", { stdio: ["pipe", "pipe", "ignore"] });
      }
    } catch (e) {
      log("   ✅ 埠 3000 已釋放");
      break;
    }
    if (isWin) {
      execSync("ping -n 1 127.0.0.1 >nul");
    } else {
      execSync("sleep 1");
    }
  }

  log("🚀 使用 Bun 啟動新服務...");
  const cp = spawn(BUN, ["src/start.js", "--force"], {
    cwd: __dirname,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, FORCE_RESTART: "true" },
  });
  cp.unref();

  checkAndFinish();
}

function checkAndFinish() {
  log("\n⏳ 正在檢查 Qwen2API 狀態 (最多等待 20 秒)...");

  let attempts = 0;
  const maxAttempts = 20;

  function tryConnect() {
    attempts++;
    checkServer((alive) => {
      if (alive) {
        log("\n✅ Qwen2API 已成功重啟並連線");
        finish();
      } else if (attempts < maxAttempts) {
        process.stdout.write(`\r   ⏳ 等待啟動... ${attempts}/${maxAttempts}`);
        setTimeout(tryConnect, 1000);
      } else {
        log("\n\n⚠️ Qwen2API 啟動超時。");
        log("💡 請手動執行以下指令啟動:");
        log(`   cd ${__dirname}`);
        log("   bun src/start.js --force");
        finish();
      }
    });
  }

  setTimeout(tryConnect, 3000);
}

function showFinish() {
  log(`   📍 ${__dirname}`);
  log("   ▶️  bun src/start.js --force");
  finish();
}

function finish() {
  log("\n\n🎉 所有操作已完成！");

  if (process.env.AUTO_TRIGGER === "true" || !process.stdin.isTTY) {
    process.exit(0);
  }

  log("💡 按 Enter 鍵關閉此視窗...");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("", () => {
    rl.close();
    process.exit(0);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  error(e);
  process.exit(1);
});
