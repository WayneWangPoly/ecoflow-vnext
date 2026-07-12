# Ordermentum Full Sync RPC V4 Fix

This patch replaces `ecoflow_upsert_ordermentum_raw_order_v2` and `ecoflow_upsert_ordermentum_raw_invoice_v2` with PL/pgSQL-safe implementations.

It fixes ambiguous references such as `external_order_id` and avoids `ON CONFLICT (...)` inside functions that return columns with the same names.

It does not drop tables and does not delete any data.
