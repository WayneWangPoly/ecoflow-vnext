# EcoFlow Ordermentum Master Data Safe Overlay Runbook

This package is additive only. It must not overwrite the current store-site seed, SKU app master, App.tsx, or repository layer.

## Files added

- `supabase/migrations/20260707_ordermentum_master_data_cloud_sync_v2_safe_overlay.sql`
- `scripts/ordermentum-master-data-common.mjs`
- `scripts/ordermentum-master-data-discovery.mjs`
- `scripts/ordermentum-master-data-sync.mjs`
- `scripts/ordermentum-cloud-sync.mjs`
- `scripts/audit-ordermentum-master-data-cloud-sync.mjs`
- `.github/workflows/ordermentum-cloud-sync.yml`
- `docs/README_ORDERMENTUM_MASTER_DATA_CLOUD_SYNC.md`

## Local apply

```powershell
Expand-Archive "$env:USERPROFILE\Downloads\ecoflow-ordermentum-master-data-cloud-sync-safe-overlay-v2.zip" -DestinationPath "$env:TEMP\ecoflow-master-safe" -Force
powershell -ExecutionPolicy Bypass -File "$env:TEMP\ecoflow-master-safe\ecoflow-ordermentum-master-data-cloud-sync-safe-overlay-v2\apply-safe-overlay.ps1" -ProjectRoot "C:\dev\ecoflow-vnext"
cd C:\dev\ecoflow-vnext
npm run build
```

Expected changed files after applying:

```text
.github/workflows/ordermentum-cloud-sync.yml
docs/README_ORDERMENTUM_MASTER_DATA_CLOUD_SYNC.md
docs/RUNBOOK_ORDERMENTUM_MASTER_DATA_SAFE_OVERLAY.md
scripts/audit-ordermentum-master-data-cloud-sync.mjs
scripts/ordermentum-cloud-sync.mjs
scripts/ordermentum-master-data-common.mjs
scripts/ordermentum-master-data-discovery.mjs
scripts/ordermentum-master-data-sync.mjs
supabase/migrations/20260707_ordermentum_master_data_cloud_sync_v2_safe_overlay.sql
```

If `App.tsx`, `supabaseOrdermentumViews.ts`, `ecoflowData.ts`, or `types.ts` appear in `git status`, stop and inspect before committing.

## Supabase SQL order

Run these in Supabase SQL Editor, in this order:

1. Your current seed/app-facing master migration if not already run:
   `supabase/migrations/20260706_seed_sku_master_and_store_sites.sql`
2. This overlay migration:
   `supabase/migrations/20260707_ordermentum_master_data_cloud_sync_v2_safe_overlay.sql`

## Local discovery

```powershell
cd C:\dev\ecoflow-vnext
. .\set-local-env.ps1
$env:ORDERMENTUM_API_BASE_URL="https://api.ordermentum.com"
$env:ORDERMENTUM_BASE_URL="https://app.ordermentum.com"

node scripts/ordermentum-master-data-discovery.mjs --resources=products,variants,purchasers,price_groups,invoices,stock_locations,leads --page-size=5
node scripts/audit-ordermentum-master-data-cloud-sync.mjs
```

## Local sync

```powershell
node scripts/ordermentum-master-data-sync.mjs --resources=products,variants,purchasers,price_groups,invoices,stock_locations --page-size=50 --max-pages=50
node scripts/audit-ordermentum-master-data-cloud-sync.mjs
```

## Cloud sync

Add GitHub Actions repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ORDERMENTUM_USERNAME`
- `ORDERMENTUM_PASSWORD`
- `ORDERMENTUM_SUPPLIER_ID`
- `ORDERMENTUM_BASE_URL` = `https://app.ordermentum.com`
- `ORDERMENTUM_API_BASE_URL` = `https://api.ordermentum.com`

Optional later:

- `ORDERMENTUM_API_KEY`

Push to GitHub. Use the `EcoFlow Ordermentum Cloud Sync` workflow manually first with `master_only`, then `standard`.
