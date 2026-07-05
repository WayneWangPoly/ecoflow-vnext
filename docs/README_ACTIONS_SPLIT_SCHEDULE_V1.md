# EcoFlow Actions split schedule v1

This replaces the single heavy standard schedule with a production-friendlier cadence:

- `orders_only` every hour for Ordermentum order updates.
- `master_only` once per day for products, variants, purchasers, price groups, invoices, and leads.
- Manual `workflow_dispatch` still allows `orders_only`, `master_only`, `standard`, or `catchup`.

The workflow keeps one concurrency group so hourly jobs do not overlap with a daily master-data run.

Required GitHub Actions repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ORDERMENTUM_USERNAME`
- `ORDERMENTUM_PASSWORD`
- `ORDERMENTUM_SUPPLIER_ID`
- `ORDERMENTUM_BASE_URL` = `https://app.ordermentum.com`
- `ORDERMENTUM_API_BASE_URL` = `https://app.ordermentum.com` for legacy master data until x-api-key access is enabled

Optional future secret:

- `ORDERMENTUM_API_KEY`

After applying, run manually once with `orders_only`, then once with `master_only`. Keep `standard` as a manual diagnostic/catch-up option rather than the scheduled default.
