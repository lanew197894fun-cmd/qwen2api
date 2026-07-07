#!/usr/bin/env node
/**
 * auto-login.js — 自動獲取 Qwen API 金鑰（免瀏覽器）
 *
 * 透過 chat.qwen.ai 的登入 API 直接獲取 JWT token，
 * 無需 Puppeteer、無需 Chrome、無需手動登入。
 *
 * 用法:
 *   node auto-login.js                           # 互動式輸入
 *   node auto-login.js email@example.com pass123  # 命令列參數
 *   node auto-login.js --batch                   # 從 .env ACCOUNTS 批次登入
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

const ENV_FILE = path.join(__dirname, ".env");
const DATA_FILE = path.join(__dirname, "data/data.json");
const LOGIN_URL = "https://chat.qwen.ai/api/v1/auths/signin";

const log = {
  info: console.log,
  error: console.error,
  ok: (m) => console.log("✅", m),
};

// ─── SHA256 ───
function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// ─── JWT decode ───
function decodeJwt(token) {
  try {
    const body = token.split(".")[1];
    const dec = JSON.parse(Buffer.from(body, "base64url").toString());
    return dec;
  } catch {
    return null;
  }
}

// ─── Login ───
async function login(email, password) {
  try {
    const res = await axios.post(
      LOGIN_URL,
      {
        email,
        password: sha256(password),
      },
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );
    const token = res.data?.token;
    if (!token) {
      log.error("❌ 登入回應缺少 token");
      return null;
    }
    const dec = decodeJwt(token);
    if (!dec) {
      log.error("❌ token 解析失敗");
      return null;
    }
    const exp = new Date(dec.exp * 1000).toISOString();
    log.ok(`登入成功! (過期: ${exp})`);
    return { token, expires: dec.exp };
  } catch (err) {
    const detail =
      err.response?.data?.message || err.response?.status || err.message;
    log.error(`❌ 登入失敗 (${email}): ${detail}`);
    return null;
  }
}

// ─── 讀寫 data.json ───
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return { accounts: [] };
  }
}

function saveAccount(email, password, token, expires) {
  const data = loadData();
  const idx = data.accounts.findIndex((a) => a.email === email);
  const entry = { email, password, token, expires, proxy: null };
  if (idx >= 0) data.accounts[idx] = entry;
  else data.accounts.push(entry);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  log.ok(`已儲存 ${email} 到 ${DATA_FILE}`);
}

function readEnv() {
  try {
    const raw = fs.readFileSync(ENV_FILE, "utf-8");
    const env = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*(\w+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
    return env;
  } catch {
    return {};
  }
}

function writeEnv(key, val) {
  let raw = "";
  try {
    raw = fs.readFileSync(ENV_FILE, "utf-8");
  } catch {}
  const lines = raw.split("\n");
  const idx = lines.findIndex((l) => l.startsWith(key + "="));
  const kv = `${key}=${val}`;
  if (idx >= 0) lines[idx] = kv;
  else lines.push(kv);
  fs.writeFileSync(ENV_FILE, lines.join("\n"));
  log.ok(`已更新 ${key} 到 .env`);
}

// ─── 互動式輸入 ───
function prompt(q) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((r) =>
    rl.question(q, (ans) => {
      rl.close();
      r(ans.trim());
    }),
  );
}

async function interactive() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   Qwen2API 自動登入 — 免瀏覽器          ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log("║   輸入你的 Qwen 帳號密碼即可自動獲取     ║");
  console.log("║   JWT Token，無需 Chrome 或 Puppeteer   ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const email = await prompt("  Qwen 郵箱: ");
  if (!email) {
    log.error("❌ 郵箱不可為空");
    return;
  }

  const password = await prompt("  Qwen 密碼: ");
  if (!password) {
    log.error("❌ 密碼不可為空");
    return;
  }

  const result = await login(email, password);
  if (!result) return;

  saveAccount(email, password, result.token, result.expires);
  log.ok("Token 已自動儲存，Qwen2API 啟動後將自動使用");
}

// ─── 批次登入（從 .env ACCOUNTS） ───
async function batchLogin() {
  const env = readEnv();
  const raw = env.ACCOUNTS || "";
  if (!raw) {
    log.error("❌ .env 中未設定 ACCOUNTS");
    log.info("  格式: ACCOUNTS=user@mail.com:pass123,user2@mail.com:pass456");
    return;
  }

  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let ok = 0,
    fail = 0;
  for (const item of items) {
    const [email, ...rest] = item.split(":");
    const password = rest.join(":").split("|")[0];
    if (!email || !password) {
      fail++;
      continue;
    }
    log.info(`登入 ${email}...`);
    const result = await login(email, password);
    if (result) {
      saveAccount(email, password, result.token, result.expires);
      ok++;
    } else fail++;
    await new Promise((r) => setTimeout(r, 1500));
  }
  log.info(`完成: ${ok} 成功, ${fail} 失敗`);
}

// ─── 檢查帳號狀態 ───
function checkStatus() {
  const data = loadData();
  const env = readEnv();
  if (data.accounts.length === 0 && !env.ACCOUNTS) {
    log.info("⚠️  尚未設定任何 Qwen 帳號");
    log.info("   執行: node auto-login.js");
    log.info("   或設定: ACCOUNTS=email:password 到 .env");
    return false;
  }
  const valid = data.accounts.filter((a) => {
    if (!a.token) return false;
    const dec = decodeJwt(a.token);
    return dec && dec.exp > Math.floor(Date.now() / 1000);
  });
  const total = data.accounts.length;
  log.info(`帳號: ${valid.length}/${total} token 有效`);
  for (const a of data.accounts) {
    const dec = decodeJwt(a.token);
    if (dec) {
      const remain = Math.round((dec.exp - Date.now() / 1000) / 3600);
      log.info(`  ${a.email}: ${remain > 0 ? `${remain}h 有效` : "❌ 已過期"}`);
    } else {
      log.info(`  ${a.email}: ❌ token 無效`);
    }
  }
  return valid.length > 0;
}

// ─── Main ───
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--batch")) {
    await batchLogin();
  } else if (args.includes("--check")) {
    checkStatus();
  } else if (args.length >= 2 && !args[0].startsWith("--")) {
    const result = await login(args[0], args[1]);
    if (result) saveAccount(args[0], args[1], result.token, result.expires);
  } else {
    // 先檢查狀態，如無帳號則進入互動
    if (!checkStatus()) {
      const ans = await prompt("  是否要現在輸入帳號密碼? (Y/n): ");
      if (ans.toLowerCase() !== "n") await interactive();
    }
  }
}

main().catch((e) => log.error("❌", e.message));
