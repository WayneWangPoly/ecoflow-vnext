# Ordermentum Legacy Sync Wrapper

This wrapper logs in to Ordermentum using the legacy `/v1/auth` username/password flow, loads the returned bearer token into the child process environment, then runs the existing sync script.

It does not print the token.

## Required local environment variables

```powershell
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
$env:ORDERMENTUM_USERNAME="your-ordermentum-login-email"
$env:ORDERMENTUM_PASSWORD="your-ordermentum-password"
$env:ORDERMENTUM_SUPPLIER_ID="your-supplier-id"
$env:ORDERMENTUM_BASE_URL="https://app.ordermentum.com"
$env:NODE_OPTIONS="--dns-result-order=ipv4first"
$env:ORDERMENTUM_FETCH_TIMEOUT_MS="60000"
$env:SUPABASE_FETCH_TIMEOUT_MS="60000"
$env:ORDERMENTUM_FETCH_RETRIES="3"
```

Keep these in a local-only file such as `set-local-env.ps1` and add that file to `.gitignore`.

## Incremental sync

```powershell
node scripts/ordermentum-sync-now-legacy.mjs --window-minutes 1440 --overlap-minutes 30 --page-size 20 --max-pages 10
```

## Dry run

```powershell
node scripts/ordermentum-sync-now-legacy.mjs --window-minutes 1440 --overlap-minutes 30 --page-size 20 --max-pages 10 --dry-run
```

## Run a different sync script

Pass `--script` to run a different existing script after login:

```powershell
node scripts/ordermentum-sync-now-legacy.mjs --script scripts/ordermentum-backfill-window.mjs --from 2026-07-01T00:00:00Z --to 2026-07-04T00:00:00Z --page-size 20 --max-pages 10
```
