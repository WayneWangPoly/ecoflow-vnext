# Blocked Order Detail Refresh

This patch lets the current missing-invoice refresh use the legacy Bearer-token path more safely and lets the SQL views count raw fetched details immediately.

## Apply

```powershell
Copy-Item "$env:TEMP\ecoflow-blocked-fix\scripts\ordermentum-auth.mjs" ".\scripts\ordermentum-auth.mjs" -Force
Copy-Item "$env:TEMP\ecoflow-blocked-fix\supabase\migrations\20260630_ordermentum_blocked_order_raw_detail_fallback.sql" ".\supabase\migrations\20260630_ordermentum_blocked_order_raw_detail_fallback.sql" -Force
```

Run the SQL migration in Supabase SQL Editor.

Then run missing invoice refresh using the token already obtained from `/v1/auth`:

```powershell
$env:ORDERMENTUM_AUTH_MODE="legacy-bearer"
$env:ORDERMENTUM_BASE_URL="https://app.ordermentum.com"
$env:ORDERMENTUM_BEARER_TOKEN=$token
$env:ORDERMENTUM_MISSING_INVOICE_REFRESH_MODE="order-detail-then-invoice-search"
$env:ORDERMENTUM_MAX_INVOICE_DETAIL_PER_MINUTE="6"
npm run import:ordermentum:missing-invoices
```

Check:

```sql
select * from public.v_ecoflow_ordermentum_sync_health;
select order_number, invoice_number, invoice_detail_missing, line_items_missing, line_count, invoice_total
from public.v_ecoflow_ordermentum_inbox
where order_number in ('OMO2434','OMO2435');
select * from public.v_ecoflow_ordermentum_import_control;
```
