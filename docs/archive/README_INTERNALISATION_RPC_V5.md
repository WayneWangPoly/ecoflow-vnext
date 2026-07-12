# EcoFlow Ordermentum Internalisation RPC v5 Fix

This patch replaces only `public.ecoflow_internalise_ordermentum_orders(...)`.

Fixes:
- PL/pgSQL ambiguity between the RETURNS TABLE column `raw_order_id` and table columns.
- PL/pgSQL ambiguity between the RETURNS TABLE column `internal_order_id` and inserted line table columns.
- Keeps the named unique constraint on `ecoflow_ordermentum_internal_orders(raw_order_id)`.

Apply:
1. Run `supabase/migrations/20260702_fix_internalise_ordermentum_orders_internal_order_id_ambiguous_v5.sql` in Supabase SQL Editor.
2. Re-run:
   `node scripts/internalise-ordermentum-orders.mjs --limit 20 --execute`
