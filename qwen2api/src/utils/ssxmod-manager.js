/**
 * SSXMOD Cookie 管理器
 * 負責生成和定時重新整理 ssxmod_itna 和 ssxmod_itna2 Cookie
 */

const { generateCookies } = require("./cookie-generator");
const { logger } = require("./logger");

// 全域性 Cookie 儲存
let currentCookies = {
  ssxmod_itna: "",
  ssxmod_itna2: "",
  timestamp: 0,
};

// 重新整理間隔 (15分鐘)
const REFRESH_INTERVAL = 15 * 60 * 1000;

// 定時器引用
let refreshTimer = null;

/**
 * 重新整理 SSXMOD Cookie
 */
function refreshCookies() {
  try {
    const result = generateCookies();
    currentCookies = {
      ssxmod_itna: result.ssxmod_itna,
      ssxmod_itna2: result.ssxmod_itna2,
      timestamp: result.timestamp,
    };
    logger.debug(`SSXMOD Cookie 已重新整理`, "SSXMOD");
  } catch (error) {
    logger.error("SSXMOD Cookie 重新整理失敗", "SSXMOD", "", error.message);
  }
}

/**
 * 初始化 SSXMOD 管理器
 * 啟動時生成一次 Cookie，並設定定時重新整理
 */
function initSsxmodManager() {
  // 立即生成一次
  refreshCookies();

  // 設定定時重新整理 (每15分鐘)
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  refreshTimer = setInterval(refreshCookies, REFRESH_INTERVAL);

  logger.debug(
    `SSXMOD 管理器已啟動，重新整理間隔: ${REFRESH_INTERVAL / 1000 / 60} 分鐘`,
    "SSXMOD",
  );
}

/**
 * 獲取當前 ssxmod_itna
 * @returns {string} ssxmod_itna 值
 */
function getSsxmodItna() {
  return currentCookies.ssxmod_itna;
}

/**
 * 獲取當前 ssxmod_itna2
 * @returns {string} ssxmod_itna2 值
 */
function getSsxmodItna2() {
  return currentCookies.ssxmod_itna2;
}

/**
 * 獲取完整的 Cookie 物件
 * @returns {Object} 包含 ssxmod_itna 和 ssxmod_itna2 的物件
 */
function getCookies() {
  return { ...currentCookies };
}

/**
 * 停止定時重新整理
 */
function stopRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
    logger.info("SSXMOD 定時重新整理已停止", "SSXMOD");
  }
}

module.exports = {
  initSsxmodManager,
  getSsxmodItna,
  getSsxmodItna2,
  getCookies,
  refreshCookies,
  stopRefresh,
};
