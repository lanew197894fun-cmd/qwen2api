/**
 * 解析單個依賴包
 * @param {string} pkgName - 包名，如 "effect"、"zod"、"@opencode-ai/plugin"
 * @returns {string|null} - 包的實際路徑，或 null
 */
export function resolvePackage(pkgName: string): string | null;
/**
 * 批量解析依賴包
 * @param {string[]} packages
 * @returns {Record<string, string|null>}
 */
export function resolvePackages(packages: string[]): Record<string, string | null>;
/**
 * 動態載入解析後的模組
 * @param {string} pkgName
 * @param {string} [subpath] - 子路徑，如 "./dist/index.js"
 * @returns {Promise<any|null>}
 */
export function importResolved(pkgName: string, subpath?: string): Promise<any | null>;
/**
 * 檢查並修復共享依賴
 * 如果 shared-deps 不存在或符號連結斷開，嘗試自動修復
 */
export function checkAndRepair(): {
    issues: string[];
    repairs: any[];
    ok: boolean;
};
/** 安全解析符號連結 */
export function safeRealpath(p: any): string | null;
/** 檢查路徑是否存在且為目錄 */
export function isDir(p: any): boolean;
/** 檢查路徑是否存在（檔案或目錄） */
export function exists(p: any): boolean;
export const IS_WIN: boolean;
export const IS_MAC: boolean;
export const IS_LINUX: boolean;
export const PLUGIN_DIR: string;
export const PROJECT_ROOT: string;
export const SHARED_DEPS_DIR: string;
export const PLUGIN_NODE_MODULES: string;
//# sourceMappingURL=resolve-deps.d.mts.map