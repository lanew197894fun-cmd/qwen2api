/**
 * resolve-deps.js — 跨平台共享依賴解析模組
 *
 * 解決問題：
 * - Linux 符號連結 (symlink) 在 Windows 上無法解析
 * - shared-deps 目錄可能不存在或路徑不對
 * - npm install 後 node_modules 結構不一致
 *
 * 策略（由上到下）：
 * 1. 嘗試原始路徑（符號連結或直接引用）
 * 2. 嘗試解析符號連結真實路徑
 * 3. 嘗試從 shared-deps 加載
 * 4. 嘗試從本地 node_modules 加載
 * 5. 回傳 null（呼叫方處理降級）
 */

import path from "node:path";
import fs from "node:fs";
import process from "node:process";

// ─── 環境偵測 ───
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";

// ─── 路徑計算 ───
// 從插件 src 目錄往上推到專案根目錄
const PLUGIN_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
);
const PROJECT_ROOT = path.resolve(PLUGIN_DIR, "../../../");
const SHARED_DEPS_DIR = path.join(PROJECT_ROOT, "shared-deps", "node_modules");
const PLUGIN_NODE_MODULES = path.join(PLUGIN_DIR, "..", "node_modules");

// ─── 日誌 ───
const log = {
  debug: (...a) => {},
  info: (...a) => console.log("[resolve-deps]", ...a),
  warn: (...a) => console.warn("[resolve-deps] ⚠️", ...a),
  error: (...a) => console.error("[resolve-deps] ❌", ...a),
};

// ─── 工具函數 ───

/** 安全解析符號連結 */
function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** 檢查路徑是否存在且為目錄 */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 檢查路徑是否存在（檔案或目錄） */
function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** 統一路徑分隔符（Windows → /） */
function normalizePath(p) {
  if (!p) return p;
  return p.replace(/\\/g, "/");
}

// ─── 核心解析邏輯 ───

/**
 * 解析單個依賴包
 * @param {string} pkgName - 包名，如 "effect"、"zod"、"@opencode-ai/plugin"
 * @returns {string|null} - 包的實際路徑，或 null
 */
function resolvePackage(pkgName) {
  const candidates = [];

  // 策略 1：嘗試標準 node_modules 解析
  const standardPath = path.join(PLUGIN_NODE_MODULES, pkgName);
  if (exists(standardPath)) {
    const realpath = safeRealpath(standardPath);
    if (realpath && isDir(realpath)) {
      candidates.push({
        source: "node_modules",
        path: normalizePath(realpath),
      });
    }
  }

  // 策略 2：嘗試 shared-deps 目錄
  const sharedPath = path.join(SHARED_DEPS_DIR, pkgName);
  if (exists(sharedPath) && isDir(sharedPath)) {
    candidates.push({ source: "shared-deps", path: normalizePath(sharedPath) });
  }

  // 策略 3：嘗試從專案根目錄的 node_modules
  const rootNodeModules = path.join(PROJECT_ROOT, "node_modules", pkgName);
  if (exists(rootNodeModules) && isDir(rootNodeModules)) {
    candidates.push({
      source: "root-node_modules",
      path: normalizePath(rootNodeModules),
    });
  }

  // 策略 4：嘗試解析符號連結
  const symlinkPath = path.join(PLUGIN_NODE_MODULES, pkgName);
  if (exists(symlinkPath)) {
    const real = safeRealpath(symlinkPath);
    if (real && isDir(real)) {
      candidates.push({
        source: "symlink-resolved",
        path: normalizePath(real),
      });
    }
  }

  // 選擇最優結果
  if (candidates.length === 0) {
    log.warn(`找不到依賴包: ${pkgName}`);
    log.warn(`  搜尋路徑:`);
    log.warn(`    - ${standardPath}`);
    log.warn(`    - ${sharedPath}`);
    log.warn(`    - ${rootNodeModules}`);
    return null;
  }

  // 優先級：symlink-resolved > shared-deps > node_modules > root-node_modules
  const priority = {
    "symlink-resolved": 0,
    "shared-deps": 1,
    node_modules: 2,
    "root-node_modules": 3,
  };
  candidates.sort(
    (a, b) => (priority[a.source] ?? 99) - (priority[b.source] ?? 99),
  );

  const best = candidates[0];
  log.debug(`解析 ${pkgName}: ${best.source} → ${best.path}`);
  return best.path;
}

/**
 * 批量解析依賴包
 * @param {string[]} packages
 * @returns {Record<string, string|null>}
 */
function resolvePackages(packages) {
  const result = {};
  for (const pkg of packages) {
    result[pkg] = resolvePackage(pkg);
  }
  return result;
}

/**
 * 動態載入解析後的模組
 * @param {string} pkgName
 * @param {string} [subpath] - 子路徑，如 "./dist/index.js"
 * @returns {Promise<any|null>}
 */
async function importResolved(pkgName, subpath = "") {
  const basePath = resolvePackage(pkgName);
  if (!basePath) {
    log.error(`無法載入 ${pkgName}: 找不到套件`);
    return null;
  }

  const fullPath = subpath ? path.join(basePath, subpath) : basePath;
  const normalized = normalizePath(fullPath);

  try {
    // 嘗試載入 package.json 的 exports
    const pkgJsonPath = path.join(basePath, "package.json");
    if (exists(pkgJsonPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      const exports = pkgJson.exports;

      if (exports) {
        if (typeof exports === "string") {
          const exportPath = path.join(basePath, exports);
          return await import(normalizePath(exportPath));
        }
        if (typeof exports === "object") {
          // 優先 import
          const importEntry = exports.import || exports.default || exports["."];
          if (importEntry) {
            const exportPath = path.join(
              basePath,
              typeof importEntry === "string"
                ? importEntry
                : importEntry.default,
            );
            return await import(normalizePath(exportPath));
          }
        }
      }
    }

    // fallback: 直接載入
    return await import(normalized);
  } catch (e) {
    log.error(`載入 ${pkgName} 失敗: ${e.message}`);
    return null;
  }
}

// ─── 自動修復功能 ───

/**
 * 檢查並修復共享依賴
 * 如果 shared-deps 不存在或符號連結斷開，嘗試自動修復
 */
function checkAndRepair() {
  const issues = [];
  const repairs = [];

  // 檢查 shared-deps 目錄
  if (!exists(SHARED_DEPS_DIR)) {
    issues.push(`shared-deps 目錄不存在: ${SHARED_DEPS_DIR}`);
  }

  // 檢查符號連結
  const expectedSymlinks = ["effect", "zod"];
  for (const dep of expectedSymlinks) {
    const linkPath = path.join(PLUGIN_NODE_MODULES, dep);
    if (exists(linkPath)) {
      const real = safeRealpath(linkPath);
      if (!real || !isDir(real)) {
        issues.push(`符號連結斷開: ${dep} → ${linkPath}`);
      }
    }
  }

  // 檢查 @opencode-ai/plugin 是否存在
  const pluginPath = path.join(PLUGIN_NODE_MODULES, "@opencode-ai", "plugin");
  if (!exists(pluginPath)) {
    issues.push("@opencode-ai/plugin 未安裝");
  }

  // 檢查 @opencode-ai/sdk 是否存在
  const sdkPath = path.join(PLUGIN_NODE_MODULES, "@opencode-ai", "sdk");
  if (!exists(sdkPath)) {
    issues.push("@opencode-ai/sdk 未安裝");
  }

  return { issues, repairs, ok: issues.length === 0 };
}

// ─── 匯出 ───

export {
  resolvePackage,
  resolvePackages,
  importResolved,
  checkAndRepair,
  safeRealpath,
  isDir,
  exists,
  IS_WIN,
  IS_MAC,
  IS_LINUX,
  PLUGIN_DIR,
  PROJECT_ROOT,
  SHARED_DEPS_DIR,
  PLUGIN_NODE_MODULES,
};
