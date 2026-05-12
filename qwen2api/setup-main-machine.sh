#!/usr/bin/env bash
# ═══════════════════════════════════════════
# Qwen2API + Proxy + 硬體偵測 — 主力機快速部署
# ═══════════════════════════════════════════
# 用法:
#   1. 把整個 qwen2api + qwen2api-plugin 複製到主力機
#   2. cd qwen2api && chmod +x setup-main-machine.sh
#   3. ./setup-main-machine.sh
#
#   之後重啟只需: ./start.sh
# ═══════════════════════════════════════════

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$ROOT")/qwen2api-plugin"
OPENCODE_DIR="$HOME/opencode-manager/projects/independent/.opencode"

echo "═══════════════════════════════════"
echo "  主力機 Qwen2API + Proxy 部署"
echo "═══════════════════════════════════"

# ─── 1. 檢查依賴 ───
echo ""
echo "[1/5] 檢查依賴..."
if ! command -v bun &>/dev/null; then
  echo "  ❌ 未安裝 bun"
  echo "  安裝: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi
echo "  ✅ bun $(bun --version)"

if ! command -v python3 &>/dev/null; then
  echo "  ⚠️  無 python3，部分功能受限"
fi

if [ ! -d "$ROOT/node_modules" ]; then
  echo "  ⏳ 安裝 qwen2api 依賴..."
  cd "$ROOT" && npm install --omit=dev 2>&1 | tail -1
fi
echo "  ✅ qwen2api 依賴 $(ls "$ROOT/node_modules" 2>/dev/null | wc -l) 套件"

if [ -d "$PLUGIN_DIR" ]; then
  if [ ! -d "$PLUGIN_DIR/node_modules" ]; then
    echo "  ⏳ 安裝 plugin 依賴..."
    cd "$PLUGIN_DIR" && bun install 2>&1 | tail -1
  fi
  echo "  ✅ plugin 依賴就緒"
else
  echo "  ⚠️  找不到 plugin 目錄: $PLUGIN_DIR"
  echo "  請一併複製 qwen2api-plugin 目錄"
fi

# ─── 2. 環境設定 ───
echo ""
echo "[2/5] 環境設定..."
ENV_FILE="$ROOT/.env"
grep -q "DATA_SAVE_MODE=file" "$ENV_FILE" 2>/dev/null || {
  echo "  ⚠️  需設定 DATA_SAVE_MODE=file"
  sed -i 's/DATA_SAVE_MODE=.*/DATA_SAVE_MODE=file/' "$ENV_FILE" 2>/dev/null || true
}
grep -q "API_KEY=sk-123456" "$ENV_FILE" 2>/dev/null && echo "  ✅ API_KEY 已設定" || echo "  ⚠️  請確認 API_KEY"

# 提示 PROXY_URL（主力機可能需要代理存取 chat.qwen.ai）
CURRENT_PROXY=$(grep "^PROXY_URL=" "$ENV_FILE" 2>/dev/null | cut -d= -f2)
if [ -z "$CURRENT_PROXY" ] || [ "$CURRENT_PROXY" = "http://127.0.0.1.v1" ]; then
  echo ""
  echo "  ⚠️  PROXY_URL 目前為空或有誤"
  echo "  若主力機需要代理才能連外網，請編輯 .env 設定:"
  echo "    PROXY_URL=http://127.0.0.1:7890"
  echo "    (或你的 VPN/代理位址)"
  echo ""
  read -rp "  輸入 PROXY_URL (留空跳過): " new_proxy
  if [ -n "$new_proxy" ]; then
    if grep -q "^PROXY_URL=" "$ENV_FILE"; then
      sed -i "s|^PROXY_URL=.*|PROXY_URL=$new_proxy|" "$ENV_FILE"
    else
      echo "PROXY_URL=$new_proxy" >> "$ENV_FILE"
    fi
    echo "  ✅ PROXY_URL 已設定"
  fi
fi
echo "  ✅ .env 就緒"

# ─── 3. Token 取得 ───
echo ""
echo "[3/5] Token 狀態..."
if [ -f "$ROOT/data/data.json" ]; then
  TOKEN=$(python3 -c "
import json
d=json.load(open('$ROOT/data/data.json'))
t=d.get('accounts',[{}])[0].get('token','')[:20]
print(t if t else 'empty')
" 2>/dev/null || echo "empty")
  if [ "$TOKEN" != "empty" ]; then
    echo "  ✅ 已有 Token: ${TOKEN}..."
  else
    echo "  ⚠️  data.json 存在但無 Token"
    echo "  執行: cd $ROOT && bun auto-get-token.js"
    echo "  (會開啟 Chrome 用 GitHub 登入 chat.qwen.ai)"
  fi
else
  echo "  ⚠️  無 data.json，需取得 Token"
  echo "  執行: cd $ROOT && bun auto-get-token.js"
fi

# ─── 4. opencode 設定 ───
echo ""
echo "[4/5] opencode provider 設定..."
if [ -f "$OPENCODE_DIR/opencode.json" ]; then
  if grep -q "sk-123456" "$OPENCODE_DIR/opencode.json" 2>/dev/null; then
    echo "  ✅ opencode.json API Key 正確"
  else
    echo "  ⚠️  需更新 API Key"
  fi
else
  echo "  ℹ️  opencode.json 不在預設路徑"
  echo "  請確認 provider 的 apiKey 設為 sk-123456"
fi

# ─── 5. 建立啟動指令碼 ───
echo ""
echo "[5/5] 建立啟動指令碼..."
cat > "$ROOT/start.sh" << 'SCRIPT'
#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$ROOT")/qwen2api-plugin"

# 清理舊程式
kill -9 $(lsof -ti:3000) 2>/dev/null || true
kill -9 $(lsof -ti:3456) 2>/dev/null || true
sleep 1

echo "🚀 啟動 Qwen2API (背景)..."
nohup bun "$ROOT/src/start.js" > /tmp/qwen2api.log 2>&1 &
Q_PID=$!

echo "🚀 啟動 Chat Proxy + 硬體偵測 (背景)..."
if [ -f "$PLUGIN_DIR/src/start-proxy.js" ]; then
  nohup bun "$PLUGIN_DIR/src/start-proxy.js" > /tmp/proxy.log 2>&1 &
  P_PID=$!
else
  echo "  ⚠️  Plugin 不存在，請確認路徑"
  P_PID="N/A"
fi

sleep 3

echo ""
echo "══════════ 服務狀態 ══════════"
curl -s http://localhost:3000/health 2>/dev/null | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Qwen2API: {d.get(\"status\",\"❌\")}')
" 2>/dev/null || echo "Qwen2API: ❌ 連線失敗"

curl -s http://localhost:3456/health 2>/dev/null | python3 -c "
import sys,json; d=json.load(sys.stdin)
hw=d.get('hardware',{})
print(f'Proxy:    {d[\"proxy\"]}')
print(f'硬體等級: {hw.get(\"level\",\"?\")}')
print(f'環境:     {hw.get(\"env\",\"?\")}')
print(f'平臺:     {hw.get(\"platform\",\"?\")}')
print(f'CPU:      {hw.get(\"cpu\",\"?\")} RAM: {hw.get(\"ram\",\"?\")}')
" 2>/dev/null || echo "Proxy: ❌ 連線失敗"
echo "═══════════════════════════════"
echo ""
echo "檢視日誌:"
echo "  tail -f /tmp/qwen2api.log"
echo "  tail -f /tmp/proxy.log"
echo ""
echo "停止服務:"
echo "  kill $Q_PID $P_PID 2>/dev/null"
SCRIPT
chmod +x "$ROOT/start.sh"
echo "  ✅ start.sh 已建立"

# ─── 硬體偵測 ───
echo ""
echo "══════════ 硬體偵測 ══════════"
if [ -f "$PLUGIN_DIR/src/hardware-detect-cli.js" ]; then
  bun "$PLUGIN_DIR/src/hardware-detect-cli.js"
else
  echo "  (plugin 目錄完整複製後即可使用硬體偵測)"
fi
echo "═══════════════════════════════"

echo ""
echo "═══════════════════════════════"
echo "  ✅ 部署完成！"
echo "═══════════════════════════════"
echo ""
echo "快速啟動:  ./start.sh"
echo ""

# ─── 6. systemd 服務安裝（可選） ───
echo ""
echo "[6/6] systemd 服務安裝..."
read -rp "  是否安裝 systemd 開機自動啟動？(y/N): " setup_systemd
if [ "$setup_systemd" = "y" ] || [ "$setup_systemd" = "Y" ]; then
  USERNAME=$(whoami)
  BUN_PATH=$(which bun 2>/dev/null || echo "/home/$USERNAME/.bun/bin/bun")
  mkdir -p "$HOME/.config/systemd/user"

  cat > "$HOME/.config/systemd/user/qwen2api.service" << SYSTEMD
[Unit]
Description=Qwen2API - Local LLM API for Qwen models
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$BUN_PATH $ROOT/src/start.js
WorkingDirectory=$ROOT
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=SERVICE_PORT=3000

[Install]
WantedBy=default.target
SYSTEMD

  cat > "$HOME/.config/systemd/user/qwen-proxy.service" << SYSTEMD
[Unit]
Description=Qwen Chat Proxy - Hardware-aware model routing
After=network-online.target qwen2api.service
Wants=network-online.target
BindsTo=qwen2api.service

[Service]
Type=simple
ExecStart=$BUN_PATH $PLUGIN_DIR/src/start-proxy.js
WorkingDirectory=$PLUGIN_DIR/src
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
SYSTEMD

  systemctl --user daemon-reload
  systemctl --user enable --now qwen2api.service
  systemctl --user enable --now qwen-proxy.service
  echo "  ✅ systemd 服務已啟用並啟動"
  echo ""
  echo "  若需開機自動啟動（不需登入），請執行:"
  echo "    sudo loginctl enable-linger $USERNAME"
else
  echo "  ℹ️  略過 systemd 安裝"
fi

echo ""
echo "═══════════════════════════════════════"
echo "  ✅ 部署完成！"
echo "═══════════════════════════════════════"
echo ""
echo "若無 Token:"
echo "  cd $ROOT && bun auto-get-token.js"
echo ""
echo "驗證:"
echo "  curl http://localhost:3000/v1/models | python3 -m json.tool | head"
