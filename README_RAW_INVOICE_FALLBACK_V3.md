# Raw invoice fallback v3

This patch fixes Postgres view replacement errors by preserving the existing numeric(12,4) column types in `v_ecoflow_ordermentum_order_lines`.

Run the SQL migration in Supabase SQL Editor after the missing-invoice refresh script has created raw invoice rows.
