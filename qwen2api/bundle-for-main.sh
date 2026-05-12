#!/usr/bin/env bash
# ═══════════════════════════════════════════
# 打包 qwen2api + qwen2api-plugin → 主力機同步用
# ═══════════════════════════════════════════
# 用法:
#   ./bundle-for-main.sh              # 產生 qwen2api-bundle.tar.gz
#   ./bundle-for-main.sh /tmp/out     # 指定輸出目錄
# ═══════════════════════════════════════════

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$ROOT")/qwen2api-plugin"
OUTDIR="${1:-$ROOT}"
BUNDLE="$OUTDIR/qwen2api-bundle-$(date +%Y%m%d).tar.gz"

echo "═══════════════════════════════════"
echo "  Qwen2API + Proxy 主力機同步包"
echo "═══════════════════════════════════"
echo "來源:"
echo "  qwen2api:       $ROOT"
echo "  qwen2api-plugin: $PLUGIN_DIR"
echo "輸出: $BUNDLE"
echo ""

# 確認目錄存在
[ ! -d "$ROOT" ] && echo "❌ 找不到 qwen2api: $ROOT" && exit 1
[ ! -d "$PLUGIN_DIR" ] && echo "❌ 找不到 plugin: $PLUGIN_DIR" && exit 1

mkdir -p "$OUTDIR"

# 建立暫存目錄
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

# 複製 qwen2api（排除 node_modules / log / data）
echo "[1/3] 複製 qwen2api..."
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='data/data.json' \
  --exclude='*.log' \
  --exclude='package-lock.json' \
  --exclude='bun.lock' \
  "$ROOT/" "$TMPDIR/qwen2api/"

# 複製 plugin
echo "[2/3] 複製 qwen2api-plugin..."
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='*.log' \
  --exclude='package-lock.json' \
  --exclude='bun.lock' \
  --exclude='.env' \
  "$PLUGIN_DIR/" "$TMPDIR/qwen2api-plugin/"

# 複製 Windows 部署指令碼
echo "[3/3] 加入 Windows PowerShell 部署指令碼..."
cp "$ROOT/setup-main-machine.ps1" "$TMPDIR/qwen2api/setup-main-machine.ps1"

# 打包
echo ""
echo "打包中..."
tar -czf "$BUNDLE" -C "$TMPDIR" qwen2api qwen2api-plugin

echo ""
echo "═══════════════════════════════════"
echo "  ✅ 打包完成！"
echo "═══════════════════════════════════"
echo ""
echo "同步到主力機 (scp):"
echo "  scp $BUNDLE USER@MAIN_IP:~/"
echo ""
echo "同步到主力機 (rsync):"
echo "  rsync -avzP --delete $BUNDLE USER@MAIN_IP:~/"
echo ""
echo "在主力機 (Windows) 上解壓縮:"
echo "  用 7-Zip / WinRAR 解壓縮 tar.gz 到目標目錄"
echo "  或 (WSL): tar -xzf ~/qwen2api-bundle-*.tar.gz"
echo "  然後以 PowerShell 7 執行:"
echo "    cd qwen2api"
echo "    pwsh -ExecutionPolicy Bypass -File setup-main-machine.ps1"
echo ""

ls -lh "$BUNDLE"
