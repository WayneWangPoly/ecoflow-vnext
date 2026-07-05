# Ordermentum Order Coverage + SKU Activity V4

Fixes V3 migration failure caused by referencing `v_ecoflow_ordermentum_order_lines_v2` inside its own `CREATE VIEW` statement.

Run migration:

```sql
supabase/migrations/20260704_ordermentum_order_coverage_sku_activity_v4_self_reference_fix.sql
```

Then check:

```sql
select * from public.v_ecoflow_ordermentum_sku_library_dashboard_v2;
select * from public.v_ecoflow_ordermentum_order_monthly_summary_v2 order by order_month desc;
```
