const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

const DATA_FILE = path.join(__dirname, 'data/data.json');
const CHROME_DIR = path.join(__dirname, '.chrome-qwen-profile');
const DEBUG_PORT = 9223;
const MAX_WAIT = 180;

// 日誌輔助
const log = (msg) => console.log(msg);
const error = (msg) => console.error(msg);

async function findChrome() {
  const isWin = process.platform === 'win32';
  const paths = isWin ? [
    process.env['ProgramFiles'] + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['ProgramFiles(x86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
    path.join(require('os').homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
  ] : [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
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
    let target = pages.find(p => p.url().includes('chat.qwen.ai'));
    
    if (!target) {
      target = await browser.newPage();
      await target.goto('https://chat.qwen.ai', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    }
    
    if (target) {
      const token = await target.evaluate(() => localStorage.getItem('token'));
      if (token && token.startsWith('eyJ')) {
        await browser.disconnect();
        return token;
      }
    }
    await browser.disconnect();
  } catch(e) {}
  return null;
}

async function main() {
  log('🔍 尋找 Chrome...');
  const chrome = await findChrome();
  if (!chrome) { error('❌ 未找到 Chrome'); process.exit(1); }
  log('✅ Chrome: ' + chrome);

  // 嘗試連線已執行的 Chrome
  log('🔗 嘗試連線已執行的 Chrome...');
  let token = await tryExtractToken('http://localhost:9222');
  if (token) {
    log('\n✅ 從已執行的 Chrome 提取 Token 成功！');
    updateDataFile(token);
    restartQwen2API();
    return;
  }

  token = await tryExtractToken(`http://localhost:${DEBUG_PORT}`);
  if (token) {
    log('\n✅ 從 Qwen Chrome Profile 提取 Token 成功！');
    updateDataFile(token);
    restartQwen2API();
    return;
  }

  log('📝 未找到已登入的 Token，啟動 Chrome...');
  if (!fs.existsSync(CHROME_DIR)) fs.mkdirSync(CHROME_DIR, { recursive: true });

  log('🚀 啟動 Chrome（獨立配置，首次需登入 GitHub）...');
  const cp = spawn(chrome, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${CHROME_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://chat.qwen.ai',
  ], { detached: true, stdio: 'ignore' });
  cp.unref();

  await sleep(3000);

  log('\n📝 請在彈出的 Chrome 視窗中用 GitHub 登入');
  log('   登入完成後指令碼會自動提取 Token\n');

  let elapsed = 0;
  let browser;

  while (elapsed < MAX_WAIT) {
    try {
      if (!browser) {
        browser = await puppeteer.connect({ browserURL: `http://localhost:${DEBUG_PORT}`, defaultViewport: null });
      }
      
      const pages = await browser.pages();
      const target = pages.find(p => p.url().includes('chat.qwen.ai'));
      
      if (target) {
        const t = await target.evaluate(() => localStorage.getItem('token'));
        if (t && t.startsWith('eyJ')) {
          log('\n✅ Token 提取成功！');
          updateDataFile(t);
          await browser.disconnect();
          restartQwen2API();
          return;
        }
      }
    } catch(e) {}
    await sleep(2000);
    elapsed += 2;
    process.stdout.write(`\r   ⏳ 等待登入... ${elapsed}s / ${MAX_WAIT}s`);
  }

  log('\n\n❌ 超時，請確認已成功登入');
  process.exit(1);
}

function updateDataFile(token) {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  if (!data.accounts || data.accounts.length === 0) {
    data.accounts = [{ email: 'github-user@qwen.ai', password: '' }];
  }
  data.accounts[0].token = token;
  data.accounts[0].expires = Math.floor(Date.now() / 1000) + 86400 * 7;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  log('📁 已更新 data.json');
}

function checkServer(cb) {
  const req = http.get('http://localhost:3000/v1/models', (res) => {
    if (res.statusCode === 200) {
      cb(true);
    } else {
      cb(false);
    }
  });
  req.on('error', () => cb(false));
}

function killPort(port) {
  const isWin = process.platform === 'win32';
  const p = parseInt(port, 10);
  if (isNaN(p)) return;
  try {
    if (isWin) {
      execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${p}') do @taskkill /F /PID %a 2>nul`,
        { timeout: 3000, stdio: 'ignore' });
    } else {
      execSync(`kill -9 $(lsof -ti:${p}) 2>/dev/null`, { timeout: 3000, stdio: 'ignore' });
    }
  } catch (_) {}
}

function restartQwen2API() {
  log('\n🔄 正在重啟 Qwen2API...');
  const isWin = process.platform === 'win32';
  
  // 精準釋放埠 3000（只殺佔用該埠的程式，不誤殺其他 Node 服務）
  log('   停止舊服務（僅釋放埠 3000）...');
  killPort(3000);
  
  // 等待埠釋放（最多 10 秒）
  log('   等待埠釋放...');
  for (let i = 0; i < 10; i++) {
    try {
      if (isWin) {
        execSync('netstat -ano | findstr :3000', { stdio: ['pipe', 'pipe', 'ignore'] });
      } else {
        execSync('lsof -i :3000', { stdio: ['pipe', 'pipe', 'ignore'] });
      }
    } catch(e) {
      log('   ✅ 埠 3000 已釋放');
      break;
    }
    if (isWin) {
      execSync('ping -n 1 127.0.0.1 >nul');
    } else {
      execSync('sleep 1');
    }
  }
  
  // 方案2：用 PM2 啟動（最穩定）
  log('🚀 正在啟動新服務...');
  try {
    // 確保 PM2 daemon 執行
    try {
      execSync('pm2 ping', { stdio: 'ignore' });
    } catch(e) {
      // daemon 沒執行，忽略
    }
    
    // 用 PM2 啟動
    execSync('pm2 start ecosystem.config.js', { stdio: 'inherit', cwd: __dirname });
  } catch(e) {
    // PM2 失敗，降級到直接啟動
    log('   PM2 失敗，降級到直接啟動...');
    const cp = spawn(process.execPath, ['src/start.js'], {
      cwd: __dirname,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env }
    });
    cp.unref();
  }
  
  // 檢查服務狀態
  checkAndFinish();
}

function checkAndFinish() {
  log('\n⏳ 正在檢查 Qwen2API 狀態 (最多等待 20 秒)...');
  
  let attempts = 0;
  const maxAttempts = 20;
    
  function tryConnect() {
    attempts++;
    checkServer((alive) => {
      if (alive) {
        log('\n✅ Qwen2API 已成功重啟並連線');
        finish();
      } else if (attempts < maxAttempts) {
        process.stdout.write(`\r   ⏳ 等待啟動... ${attempts}/${maxAttempts}`);
        setTimeout(tryConnect, 1000);
      } else {
        log('\n\n⚠️ Qwen2API 啟動超時。');
        log('💡 請手動執行以下指令啟動:');
        log(`   cd ${__dirname}`);
        log('   pm2 start ecosystem.config.js');
        finish();
      }
    });
  }
    
  setTimeout(tryConnect, 3000);
}

function finish() {
  log('\n\n🎉 所有操作已完成！');
  log('💡 按 Enter 鍵關閉此視窗...');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('', () => {
    rl.close();
    process.exit(0);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { error(e); process.exit(1); });
