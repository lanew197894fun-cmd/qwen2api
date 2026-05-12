# ═══════════════════════════════════════════════
# Qwen2API + Proxy + 硬體偵測 — 主力機快速部署 (PowerShell 7)
# ═══════════════════════════════════════════════
# 用法:
#   1. 解壓縮 bundle 到目標目錄
#   2. 以 PowerShell 7 執行:
#      pwsh -ExecutionPolicy Bypass -File setup-main-machine.ps1
# ═══════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$PLUGIN_DIR = Join-Path (Split-Path -Parent $ROOT) "qwen2api-plugin"
$OPENCODE_DIR = "$env:USERPROFILE\opencode-manager\projects\independent\.opencode"
$LOG_DIR = "$env:TEMP\qwen2api"

Write-Host "═══════════════════════════════════" -ForegroundColor Cyan
Write-Host "  主力機 Qwen2API + Proxy 部署" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ─── 1. 檢查依賴 ───
Write-Host "[1/6] 檢查依賴..." -ForegroundColor Yellow

$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
  Write-Host "  ❌ 未安裝 bun" -ForegroundColor Red
  Write-Host "  安裝: irm bun.sh/install.ps1 | iex"
  exit 1
}
Write-Host "  ✅ bun $(bun --version)" -ForegroundColor Green

# 安裝 qwen2api 依賴 (npm)
if (-not (Test-Path "$ROOT\node_modules")) {
  Write-Host "  ⏳ 安裝 qwen2api 依賴..." -ForegroundColor Yellow
  Push-Location $ROOT
  npm install --omit=dev 2>&1 | Out-Null
  Pop-Location
}
Write-Host "  ✅ qwen2api 依賴就緒" -ForegroundColor Green

# 安裝 plugin 依賴 (bun)
if (Test-Path $PLUGIN_DIR) {
  if (-not (Test-Path "$PLUGIN_DIR\node_modules")) {
    Write-Host "  ⏳ 安裝 plugin 依賴..." -ForegroundColor Yellow
    Push-Location $PLUGIN_DIR
    bun install 2>&1 | Out-Null
    Pop-Location
  }
  Write-Host "  ✅ plugin 依賴就緒" -ForegroundColor Green
} else {
  Write-Host "  ⚠️  找不到 plugin 目錄: $PLUGIN_DIR" -ForegroundColor Yellow
}

# ─── 2. 環境設定 ───
Write-Host ""
Write-Host "[2/6] 環境設定..." -ForegroundColor Yellow
$ENV_FILE = "$ROOT\.env"

# DATA_SAVE_MODE
$envContent = Get-Content $ENV_FILE -ErrorAction SilentlyContinue
$hasFileMode = $envContent -match 'DATA_SAVE_MODE=file'
if (-not $hasFileMode) {
  Write-Host "  ⚠️  需設定 DATA_SAVE_MODE=file" -ForegroundColor Yellow
  $envContent = $envContent -replace 'DATA_SAVE_MODE=.*', 'DATA_SAVE_MODE=file'
  Set-Content $ENV_FILE $envContent
}

# API_KEY
$hasApiKey = $envContent -match 'API_KEY=sk-123456'
if ($hasApiKey) {
  Write-Host "  ✅ API_KEY 已設定" -ForegroundColor Green
} else {
  Write-Host "  ⚠️  請確認 API_KEY 設為 sk-123456" -ForegroundColor Yellow
}

# PROXY_URL (主力機可能需要代理)
$currentProxy = ($envContent -match '^PROXY_URL=(.*)') ? $Matches[1] : $null
if ([string]::IsNullOrEmpty($currentProxy) -or $currentProxy -eq 'http://127.0.0.1.v1') {
  Write-Host ""
  Write-Host "  ⚠️  PROXY_URL 目前為空或有誤" -ForegroundColor Yellow
  Write-Host "  若主力機需要代理才能連外網，請輸入代理位址 (留空跳過):" -ForegroundColor Yellow
  $newProxy = Read-Host "  PROXY_URL"
  if ($newProxy) {
    if ($envContent -match '^PROXY_URL=') {
      $envContent = $envContent -replace '^PROXY_URL=.*', "PROXY_URL=$newProxy"
    } else {
      $envContent += "`nPROXY_URL=$newProxy"
    }
    Set-Content $ENV_FILE $envContent
    Write-Host "  ✅ PROXY_URL 已設定" -ForegroundColor Green
  }
}
Write-Host "  ✅ .env 就緒" -ForegroundColor Green

# ─── 3. Token 狀態 ───
Write-Host ""
Write-Host "[3/6] Token 狀態..." -ForegroundColor Yellow
$DATA_FILE = "$ROOT\data\data.json"
if (Test-Path $DATA_FILE) {
  $data = Get-Content $DATA_FILE -Raw | ConvertFrom-Json
  $token = $data.accounts[0].token
  if ($token) {
    Write-Host "  ✅ 已有 Token: $($token.Substring(0, [Math]::Min(20, $token.Length)))..." -ForegroundColor Green
  } else {
    Write-Host "  ⚠️  data.json 存在但無 Token" -ForegroundColor Yellow
    Write-Host "  執行: cd $ROOT && bun auto-get-token.js" -ForegroundColor Yellow
  }
} else {
  Write-Host "  ⚠️  無 data.json，需取得 Token" -ForegroundColor Yellow
  Write-Host "  執行: cd $ROOT && bun auto-get-token.js" -ForegroundColor Yellow
}

# ─── 4. opencode 設定檢查 ───
Write-Host ""
Write-Host "[4/6] opencode provider 設定..." -ForegroundColor Yellow
$OPENCODE_JSON = "$OPENCODE_DIR\opencode.json"
if (Test-Path $OPENCODE_JSON) {
  $oc = Get-Content $OPENCODE_JSON -Raw | ConvertFrom-Json
  Write-Host "  ✅ opencode.json 已存在，請確認 apiKey 為 sk-123456" -ForegroundColor Green
} else {
  Write-Host "  ℹ️  opencode.json 不在預設路徑 ($OPENCODE_DIR)" -ForegroundColor Yellow
  Write-Host "  請確認 provider 的 apiKey 設為 sk-123456" -ForegroundColor Yellow
}

# ─── 5. 建立啟動/停止指令碼 ───
Write-Host ""
Write-Host "[5/6] 建立啟動/停止指令碼..." -ForegroundColor Yellow

# 啟動指令碼
@"
# start-services.ps1 — 啟動 Qwen2API + Proxy
`$ROOT = "$($ROOT -replace '\\', '\\')"
`$PLUGIN_DIR = "$($PLUGIN_DIR -replace '\\', '\\')"
`$LOG_DIR = "$LOG_DIR"

if (-not (Test-Path `$LOG_DIR)) { New-Item -ItemType Directory -Path `$LOG_DIR -Force | Out-Null }

# 清理舊程式
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id `$_.OwningProcess -Force } catch {}
}
Get-NetTCPConnection -LocalPort 3456 -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id `$_.OwningProcess -Force } catch {}
}
Start-Sleep 1

Write-Host "🚀 啟動 Qwen2API (背景)..."
`$qProc = Start-Process -NoNewWindow -FilePath "bun" -ArgumentList "`"`$ROOT\src\start.js`"" -RedirectStandardOutput "`$LOG_DIR\qwen2api.log" -RedirectStandardError "`$LOG_DIR\qwen2api.err" -PassThru

Write-Host "🚀 啟動 Chat Proxy (背景)..."
`$pProc = Start-Process -NoNewWindow -FilePath "bun" -ArgumentList "`"`$PLUGIN_DIR\src\start-proxy.js`"" -RedirectStandardOutput "`$LOG_DIR\proxy.log" -RedirectStandardError "`$LOG_DIR\proxy.err" -PassThru

Start-Sleep 3

Write-Host ""
Write-Host "══════════ 服務狀態 ══════════"
try {
  `$qHealth = Invoke-RestMethod -Uri "http://localhost:3000/health" -ErrorAction Stop
  Write-Host "Qwen2API: `$(`$qHealth.status)" -ForegroundColor Green
} catch {
  Write-Host "Qwen2API: ❌ 連線失敗" -ForegroundColor Red
}
try {
  `$pHealth = Invoke-RestMethod -Uri "http://localhost:3456/health" -ErrorAction Stop
  Write-Host "Proxy:    `$(`$pHealth.proxy)" -ForegroundColor Green
  Write-Host "硬體等級: `$(`$pHealth.hardware.level)" -ForegroundColor Cyan
} catch {
  Write-Host "Proxy: ❌ 連線失敗" -ForegroundColor Red
}
Write-Host "═══════════════════════════════"
Write-Host ""
Write-Host "檢視日誌:"
Write-Host "  Get-Content `"`$LOG_DIR\qwen2api.log`" -Tail 20"
Write-Host "  Get-Content `"`$LOG_DIR\proxy.log`" -Tail 20"
Write-Host ""
Write-Host "停止服務:"
Write-Host "  .\stop-services.ps1"
"@ | Set-Content "$ROOT\start-services.ps1"

# 停止指令碼
@"
# stop-services.ps1 — 停止 Qwen2API + Proxy
Write-Host "🛑 停止 Qwen2API..."
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id `$_.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host "  ✅ Port 3000 已釋放" } catch {}
}

Write-Host "🛑 停止 Chat Proxy..."
Get-NetTCPConnection -LocalPort 3456 -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id `$_.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host "  ✅ Port 3456 已釋放" } catch {}
}

Write-Host ""
Write-Host "  ✅ 服務已停止" -ForegroundColor Green
"@ | Set-Content "$ROOT\stop-services.ps1"

Write-Host "  ✅ start-services.ps1 已建立" -ForegroundColor Green
Write-Host "  ✅ stop-services.ps1 已建立" -ForegroundColor Green

# ─── 6. 開機自動啟動 (Task Scheduler) ───
Write-Host ""
Write-Host "[6/6] 開機自動啟動 (Task Scheduler)..." -ForegroundColor Yellow
$ans = Read-Host "  是否設定開機自動啟動？(y/N)"
if ($ans -eq 'y' -or $ans -eq 'Y') {
  $taskName = "Qwen2API-Services"
  $scriptPath = "$ROOT\start-services.ps1"

  $action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited

  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
  Write-Host "  ✅ 已建立排程工作: $taskName (登入時自動啟動)" -ForegroundColor Green

  # 立即啟動
  Start-ScheduledTask -TaskName $taskName
  Write-Host "  ✅ 服務已啟動" -ForegroundColor Green
} else {
  Write-Host "  ℹ️  略過自動啟動設定" -ForegroundColor Yellow
  Write-Host "  手動啟動: .\start-services.ps1"
}

# ─── 硬體偵測 ───
Write-Host ""
Write-Host "══════════ 硬體偵測 ══════════" -ForegroundColor Cyan
$hwCli = "$PLUGIN_DIR\src\hardware-detect-cli.js"
if (Test-Path $hwCli) {
  bun $hwCli
} else {
  Write-Host "  (plugin 目錄完整複製後即可使用硬體偵測)"
}
Write-Host "═══════════════════════════════" -ForegroundColor Cyan

# ─── 完成 ───
Write-Host ""
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ✅ 部署完成！" -ForegroundColor Green
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "管理服務:"
Write-Host "  啟動:  .\start-services.ps1"
Write-Host "  停止:  .\stop-services.ps1"
Write-Host ""
if (-not (Test-Path $DATA_FILE) -or -not $token) {
  Write-Host "若無 Token:"
  Write-Host "  cd $ROOT && bun auto-get-token.js"
  Write-Host "  (會開啟 Chrome 用 GitHub 登入 chat.qwen.ai)"
  Write-Host ""
}
Write-Host "驗證:"
Write-Host "  curl.exe -s http://localhost:3000/v1/models"
Write-Host "  curl.exe -s http://localhost:3456/health | ConvertFrom-Json"
