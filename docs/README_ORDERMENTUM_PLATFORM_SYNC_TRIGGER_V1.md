# EcoFlow Ordermentum Platform Sync Trigger v1

This overlay changes Ordermentum cloud sync from always-running full master sync to a production-style split:

- Scheduled GitHub Actions run: `orders_only` every hour.
- Master data sync: triggered manually from EcoFlow Settings -> Ordermentum integration by OWNER / ADMIN.
- Manual GitHub Actions modes remain available: `orders_only`, `master_only`, `standard`, `catchup`.

## Files added/changed

- `.github/workflows/ordermentum-cloud-sync.yml`
- `supabase/functions/trigger-ordermentum-sync/index.ts`
- `scripts/deploy-trigger-ordermentum-sync-function.ps1`
- `src/features/team/ordermentumSync.ts`
- `src/features/settings/OrdermentumIntegrationSettingsPanel.tsx`
- `src/app/App.tsx` is patched by `apply-ordermentum-sync-trigger-overlay.ps1` to add the Settings panel.

## GitHub Action schedule

Only hourly order sync is scheduled:

```yaml
schedule:
  - cron: "17 * * * *"
```

Master data sync is intentionally not scheduled because it can take around 30 minutes. It is triggered on demand from the EcoFlow platform.

## GitHub token for Supabase Edge Function

Create a GitHub token with permission to dispatch workflows for `WayneWangPoly/ecoflow-vnext`, then store it in Supabase Edge Function secrets as:

- `ECOFLOW_GITHUB_ACTIONS_TOKEN`
- `ECOFLOW_GITHUB_REPOSITORY=WayneWangPoly/ecoflow-vnext`
- `ECOFLOW_GITHUB_WORKFLOW_ID=ordermentum-cloud-sync.yml`
- `ECOFLOW_GITHUB_REF=main`

Do not put this token in Vercel frontend env variables and do not put it in GitHub source files.

## Deploy Edge Function

```powershell
cd C:\dev\ecoflow-vnext
$env:SUPABASE_PROJECT_REF="your-project-ref"
$env:ECOFLOW_GITHUB_ACTIONS_TOKEN="your-github-token"
$env:ECOFLOW_GITHUB_REPOSITORY="WayneWangPoly/ecoflow-vnext"
$env:ECOFLOW_GITHUB_WORKFLOW_ID="ordermentum-cloud-sync.yml"
$env:ECOFLOW_GITHUB_REF="main"

powershell -ExecutionPolicy Bypass -File .\scripts\deploy-trigger-ordermentum-sync-function.ps1
```

## Owner/Admin UX

Settings -> Ordermentum integration has three buttons:

- **Sync orders now** -> `orders_only`
- **Sync master data** -> `master_only`
- **Full standard sync** -> `standard`

The browser calls `trigger-ordermentum-sync`, which checks the logged-in Supabase user and only allows `OWNER` or `ADMIN` profiles.

## Verify

```powershell
npm run build
git status --short
```

Push to main, deploy the Edge Function, then test with an OWNER account from Settings.
