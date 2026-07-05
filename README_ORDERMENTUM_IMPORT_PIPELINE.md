# EcoFlow Ordermentum Import Pipeline

This patch combines these layers:

1. Release Gate V2 views.
2. Bulk import control tables.
3. Missing invoice refresh queue.
4. Safe API backfill script with date windows, checkpoints, payload hashes, and rate-limit handling.
5. Incremental sync script.
6. Import control audit script.

## Required Supabase env

Use server-side/local env only. Do not expose these in the browser.

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
```

## Required Ordermentum env

The API endpoints are intentionally configurable because the previous temporary API role may have used a specific endpoint shape.

```powershell
$env:ORDERMENTUM_API_TOKEN="YOUR_ORDERMENTUM_TOKEN"
$env:ORDERMENTUM_SEARCH_URL="https://..."
$env:ORDERMENTUM_SEARCH_METHOD="POST"
$env:ORDERMENTUM_ORDER_DETAIL_URL_TEMPLATE="https://.../{id}"
$env:ORDERMENTUM_INVOICE_DETAIL_URL_TEMPLATE="https://.../{invoiceNumber}"
```

If the search endpoint already returns full detail, omit `ORDERMENTUM_ORDER_DETAIL_URL_TEMPLATE`.

## Run migrations

Run these in Supabase SQL Editor in order:

1. `supabase/migrations/20260629_ordermentum_release_gate_v2.sql`
2. `supabase/migrations/20260630_ordermentum_import_control_and_bulk_backfill.sql`

## Audit current state

```powershell
npm run audit:import-control
```

## Refresh the two missing invoice details

This only fetches invoice rows that appear in `v_ecoflow_ordermentum_invoice_gap_queue` as `FETCH_REQUIRED`.

```powershell
npm run import:ordermentum:missing-invoices
```

## Backfill all historical orders safely

Start with dry-run and small windows.

```powershell
npm run import:ordermentum:backfill -- --from 2026-04-01 --to 2026-06-30 --window-days 1 --dry-run
```

Then run live:

```powershell
npm run import:ordermentum:backfill -- --from 2026-04-01 --to 2026-06-30 --window-days 1
```

For very large history, expand month by month. The script writes `ordermentum_api_jobs`, `ordermentum_sync_batches`, `ordermentum_raw_orders`, `ordermentum_order_versions`, and `ordermentum_import_errors`.

## Incremental sync

```powershell
npm run import:ordermentum:incremental
```

The incremental script starts from the latest `external_updated_at` in `ordermentum_raw_orders` minus 10 minutes.

## Safety principles

- No script writes directly into internal fulfilment `orders`.
- All Ordermentum data first lands in canonical raw tables.
- Same external order ID is idempotent.
- Same payload hash is unchanged.
- Changed payload hash creates a version record.
- Rate limits create import errors and pause before retrying.
