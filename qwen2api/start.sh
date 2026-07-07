#!/bin/bash
# start.sh — 啟動 qwen2api 主服務 (port 3000)
# 用法: bash start.sh

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUN="$(which bun 2>/dev/null)"
[ -z "$BUN" ] && BUN="$HOME/.bun/bin/bun"
[ -z "$BUN" ] && { echo "❌ 找不到 bun"; exit 1; }

echo "🟢 qwen2api (port 3000) — 按 Ctrl+C 停止服務"
echo ""
cd "$ROOT" && exec $BUN src/start.js --force

