# EcoFlow Bulk SKU Mapping RPC Fix

This patch fixes a PostgreSQL PL/pgSQL ambiguity error in `ecoflow_bulk_map_ordermentum_skus`:

`column reference "external_sku_code" is ambiguous`

It replaces only the RPC function and does not modify order or mapping data.
