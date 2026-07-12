# EcoFlow Ordermentum Full Sync Layer

This patch adds a safe full-sync control layer:

- sync run audit table
- sync error table
- raw order/invoice upsert RPCs
- sync dashboard views
- backfill window script
- incremental sync script
- audit script

It does not create warehouse pick waves and does not bypass barcode gates.

## Required env

```powershell
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

For API key mode:

```powershell
$env:ORDERMENTUM_AUTH_MODE="api-key"
$env:ORDERMENTUM_BASE_URL="https://api.ordermentum.com"
$env:ORDERMENTUM_API_KEY="your-x-api-key"
```

For temporary legacy bearer mode:

```powershell
$env:ORDERMENTUM_AUTH_MODE="legacy-bearer"
$env:ORDERMENTUM_BASE_URL="https://app.ordermentum.com"
$env:ORDERMENTUM_BEARER_TOKEN="your-short-lived-token"
```

## Optional endpoint config

If Ordermentum's search endpoint differs from the defaults, configure:

```powershell
$env:ORDERMENTUM_SEARCH_METHOD="GET"
$env:ORDERMENTUM_SEARCH_URL="https://api.ordermentum.com/v2/orders"
$env:ORDERMENTUM_FROM_PARAM="updatedFrom"
$env:ORDERMENTUM_TO_PARAM="updatedTo"
$env:ORDERMENTUM_PAGE_PARAM="page"
$env:ORDERMENTUM_LIMIT_PARAM="limit"
$env:ORDERMENTUM_ORDER_DETAIL_URL_TEMPLATE="{{baseUrl}}/v1/orders/{{id}}"
```

For POST search:

```powershell
$env:ORDERMENTUM_SEARCH_METHOD="POST"
$env:ORDERMENTUM_SEARCH_URL="https://api.ordermentum.com/v2/orders"
$env:ORDERMENTUM_SEARCH_BODY_TEMPLATE='{"updatedFrom":"{{from}}","updatedTo":"{{to}}","page":{{page}},"limit":{{limit}}}'
```

## First test

```powershell
node scripts/audit-ordermentum-sync.mjs
node scripts/ordermentum-backfill-window.mjs --from 2026-06-27T00:00:00Z --to 2026-06-28T00:00:00Z --page-size 20 --max-pages 1 --dry-run
```

If dry-run works:

```powershell
node scripts/ordermentum-backfill-window.mjs --from 2026-06-27T00:00:00Z --to 2026-06-28T00:00:00Z --page-size 20 --max-pages 1
node scripts/audit-ordermentum-sync.mjs
```

## Incremental test

```powershell
node scripts/ordermentum-incremental-sync.mjs --window-minutes 180 --page-size 20 --max-pages 1 --dry-run
```

Remove `--dry-run` after validating the API response shape.
