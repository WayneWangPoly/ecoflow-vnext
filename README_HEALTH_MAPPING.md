# EcoFlow Ordermentum Health + SKU Mapping Workbench

This patch adds safe read-only Supabase views for checking the Ordermentum import pipeline and prioritising SKU mapping.

## Files

- `supabase/migrations/20260630_ordermentum_health_and_mapping_workbench.sql`
- `scripts/audit-ordermentum-health.mjs`

## Apply

Run the SQL migration in Supabase SQL Editor.

Then run locally:

```powershell
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
node scripts/audit-ordermentum-health.mjs
```

## Views

- `v_ecoflow_ordermentum_system_health_checks`
- `v_ecoflow_ordermentum_sku_mapping_workbench`
- `v_ecoflow_ordermentum_daily_workbench`
- `v_ecoflow_ordermentum_internal_order_drafts`
