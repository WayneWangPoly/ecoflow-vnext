# EcoFlow Ordermentum Mapping + Internal Draft Layer

This patch adds SKU mapping functions, a bulk SKU mapping script, mapping health views, and internal order draft views.

Run the migration in Supabase SQL Editor:

```sql
supabase/migrations/20260701_ordermentum_mapping_and_internal_drafts.sql
```

Audit current mapping state:

```powershell
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
node scripts/audit-ordermentum-mapping.mjs
```

Preview mapping the top 20 unmapped Ordermentum SKUs:

```powershell
node scripts/map-ordermentum-top-skus.mjs --limit 20 --dry-run
```

Create internal SKU drafts and external mappings for the top 20 candidates:

```powershell
node scripts/map-ordermentum-top-skus.mjs --limit 20
```

Check release gate after mapping:

```sql
select * from public.v_ecoflow_ordermentum_import_control;
select * from public.v_ecoflow_ordermentum_mapping_progress;
select * from public.v_ecoflow_ordermentum_order_readiness_board;
```
