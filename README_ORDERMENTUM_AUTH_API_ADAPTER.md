# EcoFlow Ordermentum API Auth Adapter

This patch updates the importer scripts so they can use the July 2026 Ordermentum API authentication model while retaining the previous temporary user-account access path.

## Supported auth modes

### 1. New API key mode

Recommended for July 2026 onward.

```powershell
$env:ORDERMENTUM_AUTH_MODE="api-key"
$env:ORDERMENTUM_API_KEY="om_api_xxxxx"
$env:ORDERMENTUM_BASE_URL="https://api.ordermentum.com"
$env:ORDERMENTUM_SUPPLIER_ID="1f26a9cc-632e-48fb-abb2-37480efaab58"
```

Requests send:

```text
x-api-key: om_api_xxxxx
```

### 2. Temporary legacy user/password mode

Matches the earlier EcoFlow temporary access approach.

```powershell
$env:ORDERMENTUM_AUTH_MODE="legacy-bearer"
$env:ORDERMENTUM_USERNAME="api user email"
$env:ORDERMENTUM_PASSWORD="password"
$env:ORDERMENTUM_BASE_URL="https://api.ordermentum.com"
$env:ORDERMENTUM_SUPPLIER_ID="1f26a9cc-632e-48fb-abb2-37480efaab58"
```

The scripts call:

```text
POST https://app.ordermentum.com/v1/auth
```

Then cache the bearer token locally under `.cache/ordermentum-token.json` for roughly 23 hours. If a request returns 401, the script refreshes once and retries.

### 3. Manual bearer token mode

For a token copied manually from a temporary access session.

```powershell
$env:ORDERMENTUM_AUTH_MODE="bearer"
$env:ORDERMENTUM_BEARER_TOKEN="ey..."
$env:ORDERMENTUM_SUPPLIER_ID="1f26a9cc-632e-48fb-abb2-37480efaab58"
```

## Test connectivity

```powershell
npm run test:ordermentum-auth
```

This calls:

```text
GET https://api.ordermentum.com/v2/orders?supplierId=...&pageSize=3&pageNo=1
```

## Backfill orders safely

Dry run:

```powershell
npm run import:ordermentum:backfill -- --from 2026-06-27 --to 2026-06-30 --window-days 1 --dry-run
```

Real run:

```powershell
npm run import:ordermentum:backfill -- --from 2026-06-27 --to 2026-06-30 --window-days 1
```

Defaults now use the documented endpoints:

```text
GET /v2/orders?supplierId=...&updatedAt[gte]=...&updatedAt[lte]=...&pageSize=50&pageNo=1
GET /v1/orders/{id}
```

## Refresh missing invoices

Default mode fetches the detailed order first:

```powershell
npm run import:ordermentum:missing-invoices
```

It calls:

```text
GET /v1/orders/{orderId}
```

If the order-detail response does not contain invoice information, try invoice search mode:

```powershell
$env:ORDERMENTUM_MISSING_INVOICE_REFRESH_MODE="invoice-search"
npm run import:ordermentum:missing-invoices
```

Invoice search mode calls:

```text
GET /v2/invoices?supplierId=...&number=OMI2434&pageSize=10&pageNo=1
GET /v1/invoices/{invoiceId}
```

If Ordermentum's invoice search does not accept `number`, provide the exact endpoint template from the supplier integration documentation later and we can override with:

```powershell
$env:ORDERMENTUM_INVOICE_SEARCH_URL="https://api.ordermentum.com/v2/invoices"
$env:ORDERMENTUM_INVOICE_DETAIL_URL_TEMPLATE="https://api.ordermentum.com/v1/invoices/{id}"
```

## Conservative rate limits

The importer stays below documented limits by default:

```powershell
$env:ORDERMENTUM_MAX_SEARCH_PER_MINUTE="30"
$env:ORDERMENTUM_MAX_DETAIL_PER_MINUTE="20"
$env:ORDERMENTUM_MAX_INVOICE_DETAIL_PER_MINUTE="12"
```

It also respects `Retry-After` on 429 responses.
