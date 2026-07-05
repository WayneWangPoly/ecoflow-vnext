# EcoFlow Ordermentum Master Data View Array Fix v1

This patch fixes Supabase query errors like:

```text
ERROR: 2202E: multidimensional arrays must have array expressions with matching dimensions
```

The issue comes from previous workbench view definitions that used nested text-array path lists for JSON extraction. PostgreSQL treats mismatched nested arrays as invalid multidimensional arrays.

This patch does **not** change raw data. It only recreates the app-facing master-data workbench views using explicit JSON path expressions.

## Apply

Run this migration in Supabase SQL Editor:

```text
supabase/migrations/20260707_fix_ordermentum_master_data_views_array_error_v1.sql
```

## Then test

```sql
select *
from public.v_ecoflow_ordermentum_master_data_sync_health
order by resource_type;

select *
from public.v_ecoflow_ordermentum_customer_master_v1
limit 50;

select *
from public.v_ecoflow_ordermentum_sku_master_v1
limit 50;

select *
from public.v_ecoflow_ordermentum_price_groups_v1
limit 50;

select *
from public.v_ecoflow_ordermentum_price_tier_matrix_v1
limit 100;

select *
from public.v_ecoflow_ordermentum_customer_price_group_audit_v1
order by audit_status, customer_or_store_name
limit 100;
```

`v_ecoflow_ordermentum_price_tier_matrix_v1` may return zero rows if the synced price-group list payload does not embed product/variant prices. That is not a failure; it means we need price-group detail or product/variant detail sync for tier prices.
