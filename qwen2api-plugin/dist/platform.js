/**
 * platform.js — 跨平台抽象層
 *
 * 集中管理 Linux / macOS / Windows 的系統差異，
 * 各模組透過此層呼叫平台特定操作，避免散落 process.platform 判斷。
 *
 * 環境變數覆蓋：
 *   QWEN2API_DIR  — qwen2api 目錄
 *   PROJECT_DIR   — opencode 專案目錄
 *   QWEN2API_PORT — qwen2api 端口（預設 3000）
 *   QWEN2API_HOST — qwen2api 主機（預設 localhost）
 */
import { execSync, spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
export const PLATFORM = process.platform;
export const IS_WIN = PLATFORM === "win32";
export const IS_MAC = PLATFORM === "darwin";
export const IS_LINUX = PLATFORM === "linux";
// ─── 預設路徑（可透過環境變數覆蓋） ───
const PATH_TABLE = {
    qwen2api: {
        linux: "/home/reamaster/opencode-manager/projects/independent/qwen2api-dev/qwen2api",
        darwin: "/Users/reamaster/opencode-manager/projects/independent/qwen2api",
        win32: "D:\\opencode\\opencode-manager\\projects\\independent\\qwen2api-dev\\qwen2api",
    },
    projectDir: {
        linux: "/home/reamaster/opencode-manager/projects/system/packages/opencode",
        darwin: "/Users/reamaster/opencode-manager/projects/system/packages/opencode",
        win32: "D:\\opencode\\opencode-manager\\projects\\system\\packages\\opencode",
    },
};
const ENV_MAP = {
    qwen2api: "QWEN2API_DIR",
    projectDir: "PROJECT_DIR",
};
export const getPath = (name) => {
    const envKey = ENV_MAP[name];
    if (envKey && process.env[envKey])
        return process.env[envKey];
    const tbl = PATH_TABLE[name];
    return tbl?.[PLATFORM] || tbl?.linux || "";
};
// ─── 共享依賴路徑 ───
/** 取得專案根目錄（從插件目錄往上推） */
export const getProjectRoot = () => {
    const srcDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
    return path.resolve(srcDir, "../../../");
};
/** 取得 shared-deps 目錄路徑 */
export const getSharedDepsPath = () => {
    return path.join(getProjectRoot(), "shared-deps", "node_modules");
};
/**
 * 解析共享依賴包路徑
 * 優先級：本地 node_modules > shared-deps > 專案根 node_modules
 */
export const resolveSharedDep = (pkgName) => {
    const roots = [
        path.join(getProjectRoot(), "independent", "qwen2api-plugin", "node_modules"),
        getSharedDepsPath(),
        path.join(getProjectRoot(), "node_modules"),
    ];
    for (const root of roots) {
        const pkgPath = path.join(root, pkgName);
        try {
            if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isDirectory()) {
                const realPath = fs.realpathSync(pkgPath);
                if (fs.existsSync(realPath) && fs.statSync(realPath).isDirectory()) {
                    return realPath;
                }
            }
        }
        catch {
            continue;
        }
    }
    return null;
};
// ─── Port killing ───
export const killPort = (port) => {
    const p = parseInt(port, 10);
    if (isNaN(p))
        return;
    try {
        if (IS_WIN) {
            execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${p}') do @taskkill /F /PID %a 2>nul`, { timeout: 3000 });
        }
        else {
            execSync(`kill -9 $(lsof -ti:${p} -sTCP:LISTEN) 2>/dev/null`, {
                timeout: 3000,
            });
        }
    }
    catch (_) { }
};
// ─── Shell 執行（跨平台） ───
export const execShell = (cmd, opts = {}) => {
    const [shell, flag] = IS_WIN ? ["cmd", "/c"] : ["bash", "-c"];
    try {
        const proc = spawnSync(shell, [flag, cmd], {
            encoding: "utf-8",
            timeout: 30000,
            ...opts,
        });
        return {
            stdout: proc.stdout || "",
            stderr: proc.stderr || "",
            exitCode: proc.status ?? 0,
        };
    }
    catch {
        try {
            const out = execSync(cmd, {
                encoding: "utf-8",
                timeout: 30000,
                ...opts,
            });
            return { stdout: out || "", stderr: "", exitCode: 0 };
        }
        catch (e) {
            return { stdout: "", stderr: e.message, exitCode: 1 };
        }
    }
};
// ─── Shell 非同步執行（不阻塞 event loop） ───
/**
 * execShellAsync — 非同步執行 shell 命令，不阻塞 event loop
 * 支援超時自動 kill、stdout/stderr 收集
 * @param {string} cmd
 * @param {object} [opts]
 * @param {number}  [opts.timeout] — 超時毫秒（預設 30000）
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number, timedOut: boolean}>}
 */
export const execShellAsync = (cmd, opts = {}) => {
    const [shell, flag] = IS_WIN ? ["cmd", "/c"] : ["bash", "-c"];
    const timeout = opts.timeout || 30000;
    return new Promise((resolve) => {
        let stdoutBuf = "";
        let stderrBuf = "";
        let done = false;
        const finish = (code, timedOut = false) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            resolve({
                stdout: stdoutBuf,
                stderr: stderrBuf,
                exitCode: code ?? 0,
                timedOut,
            });
        };
        let proc;
        try {
            proc = spawn(shell, [flag, cmd], {
                stdio: ["pipe", "pipe", "pipe"],
                ...opts,
            });
        }
        catch (e) {
            clearTimeout(timer);
            resolve({ stdout: "", stderr: e.message, exitCode: 1, timedOut: false });
            return;
        }
        // ═══ Fix 2026-07-06: timer 在 proc 就緒後再啟動，避免 race ═══
        // 原本 timer 在 proc 宣告前就設定，proc.kill 參考到 undefined → TypeError 被吞
        const _timer = setTimeout(() => {
            try {
                if (proc?.kill) {
                    proc.kill("SIGTERM");
                    setTimeout(() => {
                        try {
                            proc.kill("SIGKILL");
                        }
                        catch { }
                    }, 1000);
                }
            }
            catch { }
            finish(null, true);
        }, timeout);
        proc.stdout.on("data", (d) => {
            stdoutBuf += d.toString();
        });
        proc.stderr.on("data", (d) => {
            stderrBuf += d.toString();
        });
        proc.on("close", (code) => {
            clearTimeout(_timer);
            finish(code);
        });
        proc.on("error", (e) => {
            clearTimeout(_timer);
            if (!done)
                finish(1);
        });
        proc.unref();
    });
};
// ─── Grep（跨平台，有限支援） ───
export const execGrep = (pattern, filePath, includes = []) => {
    if (IS_WIN) {
        try {
            const args = ["findstr", "/s", "/n", "/i", pattern, `${filePath}\\*`];
            const proc = spawnSync(args[0], args.slice(1), {
                encoding: "utf-8",
                timeout: 10000,
            });
            return {
                stdout: proc.stdout || "",
                stderr: proc.stderr || "",
                exitCode: proc.status ?? 0,
            };
        }
        catch {
            return { stdout: "", stderr: "", exitCode: 1 };
        }
    }
    const args = ["grep", "-rn", pattern, filePath];
    for (const inc of includes)
        args.push(`--include=${inc}`);
    try {
        const proc = spawnSync(args[0], args.slice(1), {
            encoding: "utf-8",
            timeout: 10000,
        });
        return {
            stdout: proc.stdout || "",
            stderr: proc.stderr || "",
            exitCode: proc.status ?? 0,
        };
    }
    catch (e) {
        return { stdout: "", stderr: e.message, exitCode: 1 };
    }
};
// ─── Signal 安全處理（SIGHUP 不存在於 Windows） ───
const UNSAFE_SIG = new Set(["SIGHUP", "SIGQUIT", "SIGUSR1", "SIGUSR2"]);
export const onSafeSignal = (signal, handler) => {
    if (IS_WIN && UNSAFE_SIG.has(signal))
        return;
    process.on(signal, handler);
};
// ─── 硬體偵測輔助 ───
export const detectGpuMac = () => {
    if (!IS_MAC)
        return null;
    try {
        const out = execSync("system_profiler SPDisplaysDataType 2>/dev/null", {
            encoding: "utf-8",
            timeout: 10000,
        });
        for (const line of out.split("\n")) {
            const m = line.match(/Chipset Model:\s*(.+)/);
            if (m)
                return m[1].trim();
        }
        return null;
    }
    catch {
        return null;
    }
};
//# sourceMappingURL=platform.js.map