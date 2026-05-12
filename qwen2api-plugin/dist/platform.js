/**
 * platform.js — 跨平台抽象層
 *
 * 集中管理 Linux / macOS / Windows 的系統差異，
 * 各模組透過此層呼叫平台特定操作，避免散落 process.platform 判斷。
 *
 * 環境變數覆蓋：
 *   QWEN2API_DIR  — qwen2api 目錄
 *   PROJECT_DIR   — opencode 專案目錄
 */

import { execSync } from "node:child_process";

export const PLATFORM = process.platform;
export const IS_WIN = PLATFORM === "win32";
export const IS_MAC = PLATFORM === "darwin";
export const IS_LINUX = PLATFORM === "linux";

// ─── 預設路徑（可透過環境變數覆蓋） ───

const PATH_TABLE = {
  qwen2api: {
    linux: "/home/reamaster/opencode-manager/projects/independent/qwen2api",
    darwin: "/Users/reamaster/opencode-manager/projects/independent/qwen2api",
    win32: "D:\\Tools\\opencode\\qwen2api",
  },
  projectDir: {
    linux: "/home/reamaster/opencode-manager/projects/system/packages/opencode",
    darwin:
      "/Users/reamaster/opencode-manager/projects/system/packages/opencode",
    win32:
      "D:\\Tools\\opencode\\opencode-manager\\projects\\system\\packages\\opencode",
  },
};

const ENV_MAP = {
  qwen2api: "QWEN2API_DIR",
  projectDir: "PROJECT_DIR",
};

export const getPath = (name) => {
  const envKey = ENV_MAP[name];
  if (envKey && process.env[envKey]) return process.env[envKey];
  const tbl = PATH_TABLE[name];
  return tbl?.[PLATFORM] || tbl?.linux || "";
};

// ─── Port killing ───

export const killPort = (port) => {
  try {
    if (IS_WIN) {
      execSync(
        `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do @taskkill /F /PID %a 2>nul`,
        { timeout: 3000 },
      );
    } else {
      execSync(`kill -9 $(lsof -ti:${port}) 2>/dev/null`, { timeout: 3000 });
    }
  } catch (_) {}
};

// ─── Shell 執行（跨平台） ───

export const execShell = (cmd, opts = {}) => {
  const [shell, flag] = IS_WIN ? ["cmd", "/c"] : ["bash", "-c"];
  try {
    const proc = Bun.spawnSync([shell, flag, cmd], opts);
    return {
      stdout: (proc.stdout || "").toString(),
      stderr: (proc.stderr || "").toString(),
      exitCode: proc.exitCode,
    };
  } catch {
    try {
      const out = execSync(cmd, {
        encoding: "utf-8",
        timeout: 30000,
        ...opts,
      });
      return { stdout: out || "", stderr: "", exitCode: 0 };
    } catch (e) {
      return { stdout: "", stderr: e.message, exitCode: 1 };
    }
  }
};

// ─── Grep（跨平台，有限支援） ───

export const execGrep = (pattern, filePath, includes = []) => {
  if (IS_WIN) {
    try {
      const out = execSync(
        `findstr /s /n /i "${pattern}" "${filePath}\\*" 2>nul`,
        { encoding: "utf-8", timeout: 30000 },
      );
      return { stdout: out || "", stderr: "", exitCode: 0 };
    } catch {
      return { stdout: "", stderr: "", exitCode: 1 };
    }
  }
  const args = ["grep", "-rn", pattern, filePath];
  for (const inc of includes) args.push(`--include=${inc}`);
  try {
    const proc = Bun.spawnSync(args);
    return {
      stdout: (proc.stdout || "").toString(),
      stderr: (proc.stderr || "").toString(),
      exitCode: proc.exitCode,
    };
  } catch (e) {
    return { stdout: "", stderr: e.message, exitCode: 1 };
  }
};

// ─── Signal 安全處理（SIGHUP 不存在於 Windows） ───

const UNSAFE_SIG = new Set(["SIGHUP", "SIGQUIT", "SIGUSR1", "SIGUSR2"]);

export const onSafeSignal = (signal, handler) => {
  if (IS_WIN && UNSAFE_SIG.has(signal)) return;
  process.on(signal, handler);
};

// ─── 硬體偵測輔助 ───

export const detectGpuMac = () => {
  if (!IS_MAC) return null;
  try {
    const out = execSync("system_profiler SPDisplaysDataType 2>/dev/null", {
      encoding: "utf-8",
      timeout: 10000,
    });
    for (const line of out.split("\n")) {
      const m = line.match(/Chipset Model:\s*(.+)/);
      if (m) return m[1].trim();
    }
    return null;
  } catch {
    return null;
  }
};
