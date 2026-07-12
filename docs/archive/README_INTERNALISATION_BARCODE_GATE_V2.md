# EcoFlow / Ordermentum internalisation + barcode gate v2

This v2 migration fixes the column reference in `external_product_mappings`.
The mapping table uses `internal_sku_id`, not `sku_id`.

Run `supabase/migrations/20260702_ordermentum_internalisation_barcode_gate_v2.sql` in Supabase SQL Editor.
