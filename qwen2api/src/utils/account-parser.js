/**
 * 共用帳號行解析器
 * 同時被 ENV ACCOUNTS 載入（utils/data-persistence.js）和
 * 後臺批次新增（routes/accounts.js）複用，
 * 保證兩條入口對帳號格式與代理 URL 的解析行為完全一致。
 *
 * 支援的輸入格式（向後相容）：
 *   email:password                 — 舊格式
 *   email:password|proxy_url       — 新格式，附帶帳號級代理
 *
 * 注意：使用 indexOf 而非 split，避免密碼中包含 ':' 時把後半截截斷
 */

/**
 * 解析單行帳號文本
 * @param {string} line - 單行原始文本
 * @returns {{ email: string, password: string, proxy: string|null } | null} 解析失敗返回 null
 */
const parseAccountLine = (line) => {
  if (typeof line !== 'string') return null
  const trimmed = line.trim()
  if (!trimmed) return null

  // 先按第一個 '|' 切出可選 proxy（proxy 部分自身可能含有 '|'，例如 query 引數極少見，這裡按首個分隔）
  const pipeIdx = trimmed.indexOf('|')
  const credentials = pipeIdx === -1 ? trimmed : trimmed.slice(0, pipeIdx)
  const proxyRaw = pipeIdx === -1 ? '' : trimmed.slice(pipeIdx + 1)
  const proxy = proxyRaw.trim() || null

  // credentials 部分按第一個 ':' 切分，保留密碼中可能存在的 ':'
  const colonIdx = credentials.indexOf(':')
  if (colonIdx === -1) return null

  const email = credentials.slice(0, colonIdx).trim()
  const password = credentials.slice(colonIdx + 1).trim()

  if (!email || !password) return null

  return { email, password, proxy }
}

module.exports = {
  parseAccountLine
}
