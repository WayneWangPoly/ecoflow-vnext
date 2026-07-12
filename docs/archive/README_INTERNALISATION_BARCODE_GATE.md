# EcoFlow Ordermentum Internalisation + Barcode Gate

This patch adds a safe internalisation layer and separates warehouse barcode readiness from Ordermentum SKU mapping.

## Files

- `supabase/migrations/20260702_ordermentum_internalisation_barcode_gate.sql`
- `scripts/audit-ordermentum-internalisation.mjs`
- `scripts/internalise-ordermentum-orders.mjs`
- `scripts/confirm-ordermentum-barcode.mjs`

## Apply

Run the SQL migration in Supabase SQL Editor.

## Audit

```powershell
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
node scripts/audit-ordermentum-internalisation.mjs
```

## Dry-run internalisation

```powershell
node scripts/internalise-ordermentum-orders.mjs --limit 20
```

## Execute internalisation

```powershell
node scripts/internalise-ordermentum-orders.mjs --limit 20 --execute
```

Then inspect:

```sql
select * from public.v_ecoflow_ordermentum_internalisation_control;
select * from public.v_ecoflow_ordermentum_account_release_queue order by queue_rank limit 20;
select * from public.v_ecoflow_ordermentum_barcode_confirmation_workbench order by priority_rank limit 30;
```

## Confirm one real warehouse barcode

```powershell
node scripts/confirm-ordermentum-barcode.mjs --external-sku CCSB6-80 --barcode 1234567890123 --by Wayne
```

Do not use Ordermentum's `x........` code as a warehouse barcode unless it is physically printed/scannable on the packaging.
