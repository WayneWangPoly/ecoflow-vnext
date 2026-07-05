# Ordermentum Order Coverage + SKU Activity V3

This patch replaces the V2 migration with a line_index-safe version.

Reason: some existing `v_ecoflow_ordermentum_order_lines` definitions do not expose `line_index`. V3 generates a fallback line index using `row_number()` for that branch while keeping the same V2 view names, so downstream queries continue to use `_v2` views.

Run:

```sql
-- supabase/migrations/20260704_ordermentum_order_coverage_sku_activity_v3_line_index_fix.sql
```
