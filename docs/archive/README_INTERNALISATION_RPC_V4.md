# EcoFlow Ordermentum Internalisation RPC v4 Fix

This patch replaces only `public.ecoflow_internalise_ordermentum_orders(...)`.

Fixes:
- PL/pgSQL ambiguity between the RETURNS TABLE column `raw_order_id` and table column `raw_order_id`.
- Uses a named unique constraint in `ON CONFLICT ON CONSTRAINT ...` instead of `ON CONFLICT (raw_order_id)`.

Apply:
1. Run `supabase/migrations/20260702_fix_internalise_ordermentum_orders_raw_order_id_ambiguous_v4.sql` in Supabase SQL Editor.
2. Re-run:
   `node scripts/internalise-ordermentum-orders.mjs --limit 20 --execute`
