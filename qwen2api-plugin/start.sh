#!/bin/bash
# start.sh — 獨立啟動 qwen2api-plugin（Chat Proxy）
# 用法: bash start.sh

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUN="$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"
[ ! -x "$BUN" ] && { echo "❌ 找不到 bun（嘗試: curl -fsSL https://bun.sh/install | bash）"; exit 1; }

PORT="${PROXY_PORT:-3456}"

# 偵測 Tailscale
if ! command -v tailscale &>/dev/null; then
  echo "   ⚠️  未安裝 Tailscale（建議: curl -fsSL https://tailscale.com/install.sh | sh）"
fi

# 自動清除舊佔用（port $PORT）— 只殺屬於本專案目錄的 process，不碰系統行程
PID="$(lsof -ti :$PORT -sTCP:LISTEN 2>/dev/null)"
if [ -n "$PID" ]; then
  # 檢查 PID 的 cwd 是否隸屬本專案（避免誤殺系統行程）
  OUR=""
  for p in $PID; do
    cwd="$(readlink /proc/$p/cwd 2>/dev/null || true)"
    case "$cwd" in
      "$ROOT"*) OUR="$OUR $p" ;;
    esac
  done
  OUR="${OUR# }"
  if [ -n "$OUR" ]; then
    echo "   ⚠️  埠 $PORT 被舊有 Process (PID $OUR) 佔用，正在終止..."
    kill $OUR 2>/dev/null
    sleep 1
    for p in $OUR; do
      kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
    done
    echo "      ✅ 已釋放"
  else
    echo "   ℹ️  埠 $PORT 被非本專案行程 (PID $PID) 佔用，跳過不殺"
  fi
fi

echo "🟢 qwen2api-plugin (Chat Proxy)"
echo "---"
echo ""
echo "   📍 $ROOT"
echo "      ▶️  bash start.sh"
echo ""
cd "$ROOT"
export PROXY_PORT="$PORT"
export PROXY_LOG_LEVEL="${PROXY_LOG_LEVEL:-warn}"
export FOREGROUND=true
exec "$BUN" src/start-proxy.js