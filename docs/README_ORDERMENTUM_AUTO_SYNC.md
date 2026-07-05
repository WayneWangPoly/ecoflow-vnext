# EcoFlow Ordermentum Auto Sync

This local Windows scheduled-task wrapper runs the existing legacy Ordermentum sync flow without printing or storing bearer tokens.

## Required local env file

Create `set-local-env.ps1` in the project root and never commit it:

```powershell
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
$env:ORDERMENTUM_USERNAME="your-ordermentum-email"
$env:ORDERMENTUM_PASSWORD="your-ordermentum-password"
$env:ORDERMENTUM_SUPPLIER_ID="your-supplier-id"
$env:ORDERMENTUM_BASE_URL="https://app.ordermentum.com"
$env:NODE_OPTIONS="--dns-result-order=ipv4first"
$env:ORDERMENTUM_FETCH_TIMEOUT_MS="60000"
$env:SUPABASE_FETCH_TIMEOUT_MS="60000"
$env:ORDERMENTUM_FETCH_RETRIES="3"
```

Add it to `.gitignore`:

```powershell
Add-Content .gitignore "`nset-local-env.ps1"
```

## Import today

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ordermentum-sync-local.ps1 -Mode today -PageSize 20 -MaxPages 10
```

## Incremental dry-run

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ordermentum-sync-local.ps1 -Mode incremental -WindowMinutes 1440 -OverlapMinutes 60 -PageSize 20 -MaxPages 10 -DryRun
```

## Incremental run

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ordermentum-sync-local.ps1 -Mode incremental -WindowMinutes 1440 -OverlapMinutes 60 -PageSize 20 -MaxPages 10
```

## Install hourly scheduled sync

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-ordermentum-sync-task.ps1 -IntervalMinutes 60 -RunNow
```

## Remove scheduled sync

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-ordermentum-sync-task.ps1
```

Logs are written to `logs/ordermentum-sync-*.log`.
