param(
  [string]$ProjectRoot = "C:\dev\ecoflow-vnext"
)

$ErrorActionPreference = "Stop"
$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (!(Test-Path $ProjectRoot)) {
  throw "Project root not found: $ProjectRoot"
}
if (!(Test-Path (Join-Path $ProjectRoot "package.json"))) {
  throw "package.json not found under $ProjectRoot. Check ProjectRoot."
}

$forbidden = @(
  "src\app\App.tsx",
  "src\data\repositories\supabaseOrdermentumViews.ts",
  "src\domain\types.ts",
  "src\domain\ecoflowData.ts",
  "supabase\migrations\20260706_seed_sku_master_and_store_sites.sql"
)
foreach ($relative in $forbidden) {
  if (Test-Path (Join-Path $PackageRoot $relative)) {
    throw "Package unexpectedly contains forbidden overwrite target: $relative"
  }
}

$copyItems = @(
  "scripts\ordermentum-master-data-common.mjs",
  "scripts\ordermentum-master-data-discovery.mjs",
  "scripts\ordermentum-master-data-sync.mjs",
  "scripts\ordermentum-cloud-sync.mjs",
  "scripts\audit-ordermentum-master-data-cloud-sync.mjs",
  "supabase\migrations\20260707_ordermentum_master_data_cloud_sync_v2_safe_overlay.sql",
  ".github\workflows\ordermentum-cloud-sync.yml",
  "docs\README_ORDERMENTUM_MASTER_DATA_CLOUD_SYNC.md",
  "docs\RUNBOOK_ORDERMENTUM_MASTER_DATA_SAFE_OVERLAY.md"
)

foreach ($relative in $copyItems) {
  $source = Join-Path $PackageRoot $relative
  $target = Join-Path $ProjectRoot $relative
  if (!(Test-Path $source)) { throw "Package file missing: $relative" }
  New-Item -ItemType Directory -Force (Split-Path -Parent $target) | Out-Null
  Copy-Item $source $target -Force
  Write-Host "Copied $relative"
}

Write-Host "\nSafe overlay applied to $ProjectRoot"
Write-Host "Next: cd $ProjectRoot; npm run build; then run the SQL migrations in Supabase SQL Editor."
