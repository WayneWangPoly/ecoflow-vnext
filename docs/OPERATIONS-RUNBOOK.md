# EcoFlow Operations Runbook

What to do when production misbehaves. Written from real incidents.

## Supabase merge / deploy pipeline

The workflow is `.github/workflows/deploy-supabase-migrations.yml`, but it has
two authority modes:

- **push to protected `main`**: `authority` → `shadow-verify` → `deploy=skipped`
  → `finalize`. This may read production migration history/schema but must not
  mutate production. Green means pending migrations applied cleanly to the
  production-schema shadow copy and deployment is deferred.
- **manual `workflow_dispatch` from protected `main`**: exact-head authority
  preflight → `shadow-verify` → `deploy` (migrations + Edge Functions) →
  `finalize`. This is the production mutation path and requires separate
  authorization.

The manual run requires `expected_main_sha` equal to both the workflow SHA and a
freshly fetched `origin/main`, plus confirmation token
`DEPLOY_SUPABASE_PRODUCTION`. Never dispatch an older commit merely because it
was previously verified; re-authorize the current protected-main SHA.

`Supabase migrations` and trusted `Release sync` preserve the distinction:
shadow-only push success says production is unchanged; manual deployment success
says the authorized database deployment completed and verifies frontend skew
when relevant.

### "failed to connect to postgres: Connection timed out"
- The direct host `db.<ref>.supabase.co` is **IPv6-only**; GitHub runners have
  no IPv6. CI must use the IPv4 session pooler URL (built from the locally
  generated, Git-ignored `supabase/.temp/pooler-url` plus the
  `SUPABASE_DB_PASSWORD` secret). Never commit `.temp` link state and never
  switch the workflow back to `--linked` for db commands.
- Supabase CLI is **pinned to 2.107.0** in CI: 2.109.x ships a rewritten
  PgClient that times out against the pooler even when raw TCP is open.
  Re-test before unpinning.

### "(ECHECKOUTTIMEOUT) unable to check out connection from the pool"
Auth succeeds but the pooler cannot borrow a backend connection: the database
is not accepting new connections (slots exhausted / stuck backends). The app
keeps working on existing REST pools, so users look fine while migrations and
management operations all time out.
- Confirm: `supabase projects list` shows `ACTIVE_HEALTHY`, platform status is
  clean, yet new connections still time out ⇒ restart the instance.
- Restart: `POST https://api.supabase.com/v1/projects/<ref>/restart` with a
  personal access token (the Supabase CLI token lives in Windows Credential
  Manager under `Supabase CLI:supabase`). ~30–60s outage. Re-dispatch the
  deploy workflow afterwards only when production deployment remains authorized.

### Shadow verification failed
The pending migration does not apply to a copy of the production schema. Fix
the SQL locally — do NOT iterate against production. The shadow job log shows
the exact failing statement.

### Push run unexpectedly enters `deploy`
Treat this as a release-control incident. A push-triggered run must have
`deploy=skipped`. Do not approve environment gates or retry deployment. Stop the
run, inspect `scripts/supabase-deploy-gate-contract.test.mjs`, and restore the
R2G contract before merging another migration.

### Manual dispatch rejected before shadow verification
Check all three exact-head inputs before retrying:

1. selected workflow ref is `main`;
2. `expected_main_sha` equals the workflow SHA and current `origin/main`;
3. confirmation is exactly `DEPLOY_SUPABASE_PRODUCTION`.

A moved `main` is intentional fail-closed behaviour; verify and authorize the
new exact SHA rather than bypassing the check.

### Vercel "Deployment rate limited"
Free-plan build quota. `Release sync` matters after an authorized production
deployment when the same commit changed frontend files: failure = DB is ahead
of frontend; redeploy the frontend before operating. A shadow-only push never
moves the production DB and therefore cannot create DB-ahead skew.

## Storage retention policy

| Bucket | Policy | Enforcement |
|---|---|---|
| `pod-photos` (private) | 90 days | `storage-retention` edge function |
| `account-statements` (private) | keep forever | never purged |

Run monthly (Owner/Admin session token):

```
POST {SUPABASE_URL}/functions/v1/storage-retention
Authorization: Bearer <owner session token>
{"dryRun": true}            # preview counts
{"dryRun": false}           # actually delete (90-day default)
```

## Field device issues

- **"Device storage is full" banner on a driver phone**: old day states are
  pruned automatically; if the banner still shows, the phone is genuinely out
  of disk. Work continues syncing to the server; do not close the tab; free
  space or swap devices at the next stop.
- **Sync chip shows "No write access"**: RLS refused the write — the person is
  signed in with the wrong role for that action (see the write matrix in
  ARCHITECTURE.md). Fix the role in Settings → Team access. The change stays
  on the device and re-sends automatically after the role is fixed.
- **Driver cannot start route with no signal**: the departure declaration is
  queued locally and uploads in the background; departure is not blocked.

## Database quick facts

- Project ref: `kauqwlzuyxcudoyognwf` (region ap-southeast-2).
- Migrations: only `YYYYMMDDHHMMSS_*.sql` files deploy; date-only legacy files
  are isolated by CI and must never be renamed into the deployable pattern.
- A deployable migration on `main` may still be pending production application;
  check migration history / the authorized manual deployment run rather than
  assuming repository presence means deployed.
- Mojibake: production data audited clean (2026-07-11, 1520 text columns);
  the pair-aware repair migration `20260711150000` stays as insurance.
