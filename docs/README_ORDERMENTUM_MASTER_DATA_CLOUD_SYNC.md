# EcoFlow Ordermentum Master Data + Cloud Sync V1

This patch upgrades EcoFlow from an order-only Ordermentum integration into a broader Integration Hub foundation.

## What it adds

### Raw mirror

All readable Ordermentum master data is stored as raw JSONB first:

- products
- variants
- purchasers / customers
- price groups
- invoices
- stock locations
- leads, if the account has access

Tables:

- `ordermentum_raw_master_resources`
- `ordermentum_raw_master_resource_versions`
- `ordermentum_master_sync_runs`
- `ordermentum_api_capabilities`

### Canonical workbench views

- `v_ecoflow_ordermentum_master_data_sync_health`
- `v_ecoflow_ordermentum_customer_master_v1`
- `v_ecoflow_ordermentum_sku_master_v1`
- `v_ecoflow_ordermentum_price_groups_v1`
- `v_ecoflow_ordermentum_price_tier_matrix_v1`
- `v_ecoflow_ordermentum_customer_price_group_audit_v1`

### Controlled write-back foundation

The patch deliberately does **not** write changes back to Ordermentum automatically.

Instead it adds:

- `external_change_requests`
- `external_change_attempts`
- `external_sync_conflicts`
- `v_ecoflow_external_change_queue`

Future write-back should use this queue:

1. EcoFlow user edits a SKU / tier / invoice draft.
2. System creates a pending external change.
3. Owner/Admin reviews the diff.
4. Connector writes back to Ordermentum.
5. Request and response payloads are stored for audit.

This is safer than immediate two-way sync.

## Apply patch

From the repo root, now under `C:\dev\ecoflow-vnext`:

```powershell
Expand-Archive "$env:USERPROFILE\Downloads\ecoflow-ordermentum-master-data-cloud-sync-v1.zip" -DestinationPath "$env:TEMP\ecoflow-master-sync" -Force

Copy-Item "$env:TEMP\ecoflow-master-sync\ecoflow-ordermentum-master-data-cloud-sync-v1\supabase\migrations\20260706_ordermentum_master_data_cloud_sync_v1.sql" ".\supabase\migrations\20260706_ordermentum_master_data_cloud_sync_v1.sql" -Force

Copy-Item "$env:TEMP\ecoflow-master-sync\ecoflow-ordermentum-master-data-cloud-sync-v1\scripts\ordermentum-master-data-common.mjs" ".\scripts\ordermentum-master-data-common.mjs" -Force
Copy-Item "$env:TEMP\ecoflow-master-sync\ecoflow-ordermentum-master-data-cloud-sync-v1\scripts\ordermentum-master-data-discovery.mjs" ".\scripts\ordermentum-master-data-discovery.mjs" -Force
Copy-Item "$env:TEMP\ecoflow-master-sync\ecoflow-ordermentum-master-data-cloud-sync-v1\scripts\ordermentum-master-data-sync.mjs" ".\scripts\ordermentum-master-data-sync.mjs" -Force
Copy-Item "$env:TEMP\ecoflow-master-sync\ecoflow-ordermentum-master-data-cloud-sync-v1\scripts\ordermentum-cloud-sync.mjs" ".\scripts\ordermentum-cloud-sync.mjs" -Force

New-Item -ItemType Directory -Force ".\.github\workflows"
Copy-Item "$env:TEMP\ecoflow-master-sync\ecoflow-ordermentum-master-data-cloud-sync-v1\.github\workflows\ordermentum-cloud-sync.yml" ".\.github\workflows\ordermentum-cloud-sync.yml" -Force

New-Item -ItemType Directory -Force ".\docs"
Copy-Item "$env:TEMP\ecoflow-master-sync\ecoflow-ordermentum-master-data-cloud-sync-v1\docs\README_ORDERMENTUM_MASTER_DATA_CLOUD_SYNC.md" ".\docs\README_ORDERMENTUM_MASTER_DATA_CLOUD_SYNC.md" -Force
```

Run the SQL migration in Supabase SQL Editor:

```text
supabase/migrations/20260706_ordermentum_master_data_cloud_sync_v1.sql
```

## Local discovery

Load local secrets:

```powershell
. .\set-local-env.ps1
$env:ORDERMENTUM_API_BASE_URL="https://api.ordermentum.com"
$env:ORDERMENTUM_BASE_URL="https://app.ordermentum.com"
```

Discover actual endpoint access:

```powershell
node scripts/ordermentum-master-data-discovery.mjs --resources=products,variants,purchasers,price_groups,invoices,stock_locations,leads --page-size=5
```

## Local master-data sync

Dry-run:

```powershell
node scripts/ordermentum-master-data-sync.mjs --resources=products,variants,purchasers,price_groups,invoices,stock_locations --page-size=50 --max-pages=20 --dry-run
```

Real run:

```powershell
node scripts/ordermentum-master-data-sync.mjs --resources=products,variants,purchasers,price_groups,invoices,stock_locations --page-size=50 --max-pages=50
```

Catch-up with detail calls where supported:

```powershell
node scripts/ordermentum-master-data-sync.mjs --resources=products,purchasers --page-size=50 --max-pages=100 --detail --delay-ms=500
```

## Verify in Supabase

```sql
select *
from public.v_ecoflow_ordermentum_master_data_sync_health
order by resource_type;
```

```sql
select *
from public.v_ecoflow_ordermentum_customer_price_group_audit_v1
order by audit_status, customer_or_store_name
limit 100;
```

```sql
select *
from public.v_ecoflow_ordermentum_sku_master_v1
order by external_sku_code nulls last, external_product_name
limit 100;
```

```sql
select *
from public.v_ecoflow_ordermentum_price_tier_matrix_v1
limit 100;
```

## Cloud auto-update with GitHub Actions

This is the cloud replacement for the old local Windows scheduled task.

In GitHub repo settings:

`Settings → Secrets and variables → Actions → New repository secret`

Add:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ORDERMENTUM_USERNAME`
- `ORDERMENTUM_PASSWORD`
- `ORDERMENTUM_SUPPLIER_ID`
- `ORDERMENTUM_BASE_URL` = `https://app.ordermentum.com`
- `ORDERMENTUM_API_BASE_URL` = `https://api.ordermentum.com`

The workflow file is:

```text
.github/workflows/ordermentum-cloud-sync.yml
```

It runs hourly and can also be started manually from GitHub Actions.

Manual modes:

- `standard`: orders incremental + master data sync
- `catchup`: larger order window + more master detail calls
- `master_only`: master data only

## Recommended sync cadence

- Orders: hourly, 48-hour overlap.
- Invoices: hourly with the master sync.
- Products / variants: hourly is acceptable at current size; later reduce to 6-hourly if needed.
- Purchasers / customers: hourly or 6-hourly.
- Price groups: hourly, because tier pricing is operationally important.
- Daily full reconciliation: run `catchup` manually until x-api-key/webhook is ready.

## Notes on write-back

Do not enable automatic write-back yet.

First write-back candidates:

1. price-group / tier-price change request
2. invoice draft creation
3. product availability / visibility, only after endpoint behaviour is confirmed

Do not write back these automatically in V1:

- historical order contents
- customer identity data
- SKU code / unit / tax fields
- bulk price changes without approval

## C:\dev migration note

Because the repo is now under `C:\dev`, install local scheduled tasks only from the new path. If a previous Windows Task Scheduler job still points to OneDrive, remove it:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-ordermentum-sync-task.ps1
```

After GitHub Actions cloud sync is working, the local Windows task is optional and should be treated as a manual fallback only.

## Safe overlay note for current repo

This v2 package is intentionally additive. It does not modify:

- `src/app/App.tsx`
- `src/data/repositories/supabaseOrdermentumViews.ts`
- `src/domain/types.ts`
- `src/domain/ecoflowData.ts`
- `supabase/migrations/20260706_seed_sku_master_and_store_sites.sql`

It should be applied after the app-facing store/SKU seed migration has been pushed and before enabling the GitHub Actions cloud sync.
