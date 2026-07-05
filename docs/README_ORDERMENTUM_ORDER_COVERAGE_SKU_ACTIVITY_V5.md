# Ordermentum Order Coverage + SKU Activity V5

Fixes the V4 SQL error where `max(l.external_product_name)` was used inside a non-aggregated CTE.

Run `supabase/migrations/20260704_ordermentum_order_coverage_sku_activity_v5_group_by_fix.sql` in Supabase SQL Editor.
