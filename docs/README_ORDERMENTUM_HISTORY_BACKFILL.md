# Ordermentum historical backfill runner

This patch adds:

```text
scripts/ordermentum-backfill-history.mjs
```

It runs the existing `scripts/ordermentum-backfill-window.mjs` repeatedly across small time windows from `2024-11-01` to today.

## Recommended sequence

### 1. Summary-only backfill first

This registers all orders without calling every `/v1/orders/{id}` detail endpoint.

```powershell
node scripts/ordermentum-backfill-history.mjs --from 2024-11-01T00:00:00Z --days-per-window 7 --page-size 20 --max-pages 10 --delay-ms 8000 --retries 2 --continue-on-error
```

### 2. Detail hydration after summary succeeds

This is slower and should use smaller windows.

```powershell
node scripts/ordermentum-backfill-history.mjs --from 2024-11-01T00:00:00Z --detail --days-per-window 1 --page-size 10 --max-pages 5 --delay-ms 15000 --retries 3 --continue-on-error
```

### 3. Audit

```powershell
node scripts/audit-ordermentum-sync.mjs
```

## Environment variables

```powershell
$env:NODE_OPTIONS="--dns-result-order=ipv4first"
$env:ORDERMENTUM_FETCH_TIMEOUT_MS="60000"
$env:SUPABASE_FETCH_TIMEOUT_MS="60000"
$env:ORDERMENTUM_FETCH_RETRIES="3"

$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

$env:ORDERMENTUM_AUTH_MODE="legacy-bearer"
$env:ORDERMENTUM_BASE_URL="https://app.ordermentum.com"
$env:ORDERMENTUM_BEARER_TOKEN="your-short-token"
$env:ORDERMENTUM_SUPPLIER_ID="your-supplier-id"
```

## Notes

- Default start date is `2024-11-01T00:00:00Z`.
- Default end date is tomorrow at `00:00:00Z`, so today's orders are included.
- Default mode is summary-only.
- Add `--detail` to fetch order detail.
- Logs are written into `logs/ordermentum-history-backfill-*.jsonl`.
- If the legacy token expires, refresh it and rerun. Upserts make reruns safe.
