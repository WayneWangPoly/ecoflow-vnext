# Ordermentum Full Sync Network Resilience V3

This patch improves the full-sync scripts for local Windows/network testing.

## Changes

- Adds fetch timeout environment variables:
  - `SUPABASE_FETCH_TIMEOUT_MS` default `30000`
  - `ORDERMENTUM_FETCH_TIMEOUT_MS` default `30000`
  - `ORDERMENTUM_FETCH_RETRIES` default `2`
- Adds network retries for Supabase and Ordermentum fetch calls.
- Adds API-only dry run mode:
  - `--dry-run --no-supabase-log`
  - or set `$env:ORDERMENTUM_DRY_RUN_NO_SUPABASE="true"`
- In API-only dry run, the script does not create or finish a Supabase sync run and does not write orders.

## Test command

```powershell
$env:NODE_OPTIONS="--dns-result-order=ipv4first"
$env:SUPABASE_FETCH_TIMEOUT_MS="45000"
$env:ORDERMENTUM_FETCH_TIMEOUT_MS="45000"
$env:ORDERMENTUM_FETCH_RETRIES="2"

node scripts/ordermentum-backfill-window.mjs --from 2026-06-27T00:00:00Z --to 2026-06-28T00:00:00Z --page-size 20 --max-pages 1 --dry-run --fetch-detail false --no-supabase-log
```

If API-only dry run succeeds, remove `--dry-run --no-supabase-log` for real write mode after Supabase connectivity is healthy.
