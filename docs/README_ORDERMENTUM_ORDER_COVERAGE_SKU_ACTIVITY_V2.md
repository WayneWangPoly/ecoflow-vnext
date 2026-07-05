# Ordermentum Order Coverage + SKU Activity V2

This patch adds audit views that use the canonical `ordermentum_raw_orders` history sync data and raw order detail lines. It is designed to catch cases where older SKU reports only read the legacy `om_order_items` staging tables.

Key views:

- `v_ecoflow_ordermentum_all_orders_audit_v2`
- `v_ecoflow_ordermentum_order_monthly_summary_v2`
- `v_ecoflow_ordermentum_order_lines_v2`
- `v_ecoflow_sku_activity_summary_v2`
- `v_ecoflow_sku_abc_analysis_v2`
- `v_ecoflow_ordermentum_sku_library_dashboard_v2`
- `v_ecoflow_top_skus_for_barcode_confirmation_v2`

Scripts:

- `node scripts/audit-ordermentum-order-coverage.mjs`
- `node scripts/export-ordermentum-orders-csv.mjs`
- `node scripts/export-ordermentum-orders-csv.mjs --sku`
