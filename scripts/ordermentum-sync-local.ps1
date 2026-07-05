param(
  [ValidateSet('incremental','today','backfill-window')]
  [string]$Mode = 'incremental',
  [string]$From,
  [string]$To,
  [int]$WindowMinutes = 1440,
  [int]$OverlapMinutes = 60,
  [int]$PageSize = 20,
  [int]$MaxPages = 10,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

$LocalEnv = Join-Path $ProjectRoot 'set-local-env.ps1'
if (Test-Path $LocalEnv) {
  . $LocalEnv
}

# Network hardening defaults. Existing environment values win.
if (-not $env:NODE_OPTIONS) { $env:NODE_OPTIONS = '--dns-result-order=ipv4first' }
if (-not $env:ORDERMENTUM_FETCH_TIMEOUT_MS) { $env:ORDERMENTUM_FETCH_TIMEOUT_MS = '60000' }
if (-not $env:SUPABASE_FETCH_TIMEOUT_MS) { $env:SUPABASE_FETCH_TIMEOUT_MS = '60000' }
if (-not $env:ORDERMENTUM_FETCH_RETRIES) { $env:ORDERMENTUM_FETCH_RETRIES = '3' }
if (-not $env:ORDERMENTUM_BASE_URL) { $env:ORDERMENTUM_BASE_URL = 'https://app.ordermentum.com' }

$required = @('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ORDERMENTUM_USERNAME','ORDERMENTUM_PASSWORD','ORDERMENTUM_SUPPLIER_ID')
foreach ($name in $required) {
  if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
    throw "Missing required environment variable: $name. Put it in set-local-env.ps1 or the current PowerShell session."
  }
}

New-Item -ItemType Directory -Force 'logs' | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logFile = Join-Path $ProjectRoot "logs/ordermentum-sync-$stamp.log"

function Invoke-NodeLogged {
  param([string[]]$NodeArgs)
  $display = 'node ' + ($NodeArgs -join ' ')
  "[$(Get-Date -Format o)] START $display" | Tee-Object -FilePath $logFile -Append
  & node @NodeArgs 2>&1 | Tee-Object -FilePath $logFile -Append
  $code = $LASTEXITCODE
  "[$(Get-Date -Format o)] EXIT $code" | Tee-Object -FilePath $logFile -Append
  if ($code -ne 0) { throw "Node command failed with exit code $code. See $logFile" }
}

if ($Mode -eq 'today') {
  # Australia/Adelaide local day → UTC window. July uses UTC+09:30; this formula uses Windows timezone conversion.
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('Cen. Australia Standard Time')
  $todayLocal = [System.TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $tz).Date
  $fromUtc = [System.TimeZoneInfo]::ConvertTimeToUtc($todayLocal, $tz).ToString('yyyy-MM-ddTHH:mm:ssZ')
  $toUtc = [System.TimeZoneInfo]::ConvertTimeToUtc($todayLocal.AddDays(1), $tz).ToString('yyyy-MM-ddTHH:mm:ssZ')
  $args = @('scripts/ordermentum-sync-now-legacy.mjs','--script','scripts/ordermentum-backfill-window.mjs','--from',$fromUtc,'--to',$toUtc,'--page-size',[string]$PageSize,'--max-pages',[string]$MaxPages)
  if ($DryRun) { $args += '--dry-run' }
  Invoke-NodeLogged $args
  exit 0
}

if ($Mode -eq 'backfill-window') {
  if (-not $From -or -not $To) { throw 'Mode backfill-window requires -From and -To ISO timestamps.' }
  $args = @('scripts/ordermentum-sync-now-legacy.mjs','--script','scripts/ordermentum-backfill-window.mjs','--from',$From,'--to',$To,'--page-size',[string]$PageSize,'--max-pages',[string]$MaxPages)
  if ($DryRun) { $args += '--dry-run' }
  Invoke-NodeLogged $args
  exit 0
}

# Default: incremental sync. Uses high_watermark_updated_at from Supabase with overlap.
$incArgs = @('scripts/ordermentum-sync-now-legacy.mjs','--window-minutes',[string]$WindowMinutes,'--overlap-minutes',[string]$OverlapMinutes,'--page-size',[string]$PageSize,'--max-pages',[string]$MaxPages)
if ($DryRun) { $incArgs += '--dry-run' }
Invoke-NodeLogged $incArgs
