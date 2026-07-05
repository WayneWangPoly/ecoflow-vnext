# EcoFlow SKU Intelligence + Barcode Master Data

This patch is intended to run after the Ordermentum historical backfill has completed.

It separates four concepts that should not be collapsed into one field:

1. Ordermentum SKU: external selling/platform code.
2. EcoFlow internal SKU: internal product master identity.
3. Packaging level: carton, sleeve, each, pallet, inner, case.
4. Barcode: scan code attached to a specific packaging level.

## Migration

Run:

```sql
supabase/migrations/20260704_sku_intelligence_barcode_master.sql
```

## Main views

- `v_ecoflow_ordermentum_sku_library_dashboard`
- `v_ecoflow_sku_activity_summary`
- `v_ecoflow_sku_abc_analysis`
- `v_ecoflow_sku_barcode_gap_report`
- `v_ecoflow_top_skus_for_barcode_confirmation`
- `v_ecoflow_sku_packaging_barcode_matrix`
- `v_ecoflow_ordermentum_listed_skus`

## First checks

```sql
select * from public.v_ecoflow_ordermentum_sku_library_dashboard;
```

```sql
select
  barcode_priority_rank,
  external_sku_code,
  external_product_name,
  abc_sales_class,
  movement_class,
  lifetime_order_count,
  lifetime_quantity,
  lifetime_sales_value,
  ordermentum_barcode_candidate,
  ordermentum_barcode_candidate_type,
  barcode_status,
  required_action
from public.v_ecoflow_top_skus_for_barcode_confirmation
limit 50;
```

```sql
select
  external_sku_code,
  external_product_name,
  lifetime_order_count,
  lifetime_sales_value,
  orders_30d,
  orders_60d,
  orders_90d,
  abc_sales_class,
  movement_class,
  barcode_status
from public.v_ecoflow_sku_abc_analysis
where sku_classification <> 'SERVICE_ITEM'
order by lifetime_sales_value desc
limit 50;
```

## Confirm a real barcode

Carton example:

```powershell
node scripts/confirm-sku-barcode.mjs --sku CCSB8-80 --barcode 19312345678928 --level CARTON --qty 1000 --type GTIN_14 --source supplier_carton
```

Sleeve example:

```powershell
node scripts/confirm-sku-barcode.mjs --sku CCSB8-80 --barcode 09312345678921 --level SLEEVE --qty 50 --type EAN_13 --source supplier_inner_pack
```

Mark a service item:

```powershell
node scripts/mark-sku-service-item.mjs --sku FC-01 --notes "Freight charge / non-stock service line"
```

## Audit

```powershell
node scripts/audit-sku-intelligence.mjs
```

## Export CSV

```powershell
node scripts/export-sku-activity-csv.mjs
```

The CSV files are written to `exports/`.

## Recommended workflow

1. Run the dashboard.
2. Confirm the top A/FAST SKUs first.
3. For each SKU, scan carton barcode first.
4. Add sleeve barcode only when split picking is required.
5. Keep Ordermentum `x...` pseudo barcodes as candidates only, not warehouse scan barcodes.
6. Do not block low-frequency dormant SKUs at the beginning.
