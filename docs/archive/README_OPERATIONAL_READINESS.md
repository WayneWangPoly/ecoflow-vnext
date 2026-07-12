# EcoFlow Ordermentum Operational Readiness Patch

This patch adds the next data layer after Supabase raw inbox:

- `v_ecoflow_ordermentum_order_lines` — exposes real `om_order_items` lines to the front end.
- `v_ecoflow_ordermentum_release_queue` — classifies each Ordermentum order as `READY_TO_RELEASE`, `REVIEW_PAYMENT`, or `BLOCKED_DATA`.
- `v_ecoflow_ordermentum_readiness_summary` — one-row health/readiness summary.
- Front end now tries to load real line items from Supabase; if the new line view is missing, it falls back safely to the existing summary line.
- Adds `npm run audit:ordermentum` to check release readiness from the command line.

## Apply

Copy files into the project:

```powershell
Copy-Item "$env:TEMP\ecoflow-readiness\src\data\repositories\supabaseOrdermentumViews.ts" ".\src\data\repositories\supabaseOrdermentumViews.ts" -Force
Copy-Item "$env:TEMP\ecoflow-readiness\package.json" ".\package.json" -Force

New-Item -ItemType Directory -Force ".\supabase\migrations"
Copy-Item "$env:TEMP\ecoflow-readiness\supabase\migrations\20260629_ordermentum_operational_readiness_views.sql" ".\supabase\migrations\20260629_ordermentum_operational_readiness_views.sql" -Force

New-Item -ItemType Directory -Force ".\scripts"
Copy-Item "$env:TEMP\ecoflow-readiness\scripts\audit-ordermentum-operational-readiness.mjs" ".\scripts\audit-ordermentum-operational-readiness.mjs" -Force
```

Run the SQL migration in Supabase SQL Editor before relying on real line-level display.

## Build

```powershell
npm install
npm run build
npm run dev
```

## Audit

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
npm run audit:ordermentum
```

Use the service role key only locally or in trusted server environments. Do not put it in the browser or GitHub.
