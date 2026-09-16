# EcoFlow Release Process

## The one rule

**Merge is not deployment authority.** Database and frontend production mutation
are separately authorized from protected `main`. When a change spans schema and
UI, the migration must remain backwards-compatible with the currently live
frontend until both explicit production gates have completed.

## What happens on push to main

1. **Vercel Git auto-production is disabled for `main`.** A protected-main push
   does not itself authorize or create a Vercel production deployment. Feature
   and PR branches may still create Preview deployments.
2. If the push touches `supabase/**` or the Supabase release-control files,
   GitHub Actions runs the production-schema **shadow gate**:
   - a no-secret preflight confirms this is a protected-main push;
   - `shadow-verify` reads production migration history/schema, loads the schema
     into throwaway Postgres 17, and applies every pending migration there;
   - the production `deploy` job is required to be `skipped` on a push;
   - `Supabase migrations` becomes green only when shadow verification passed
     and production deployment remained deferred;
   - trusted `Release sync` reports that the production database is unchanged.

A green main push therefore means **merge-safe / verified**, not "frontend and
migration already deployed to production".

## Production Vercel deployment

Production frontend deployment requires a separate manual run of
`Deploy Vercel production` from protected `main`. The operator must supply:

- `expected_main_sha`: the exact protected-main SHA carrying separate frontend
  production deployment authority;
- `confirmation`: exactly `DEPLOY_VERCEL_PRODUCTION`.

Before production credentials are used, the workflow verifies that the selected
ref is `main`, the input SHA equals the workflow SHA, a fresh `origin/main`
still points at that SHA, and `vercel.json` still disables automatic `main` Git
deployment. Any drift fails closed.

The production job uses the pinned Vercel CLI, builds the authorized exact SHA,
deploys the prebuilt artifact with exact-SHA metadata, waits for deployment
readiness, verifies the deployment can be found by that SHA, and only then
publishes the `Vercel` success status for the commit. The job requires the
`VERCEL_TOKEN` production secret; a missing credential fails closed.

## Production Supabase deployment

Production migration application and Edge Function deployment require a
separate manual run of `Deploy Supabase migrations` from protected `main`.
The operator must supply:

- `expected_main_sha`: the exact protected-main SHA that has separate production
  deployment authority;
- `confirmation`: exactly `DEPLOY_SUPABASE_PRODUCTION`.

Before production credentials are used, the workflow verifies that the selected
ref is `main`, the input SHA equals the workflow SHA, and a fresh `origin/main`
still points at that same SHA. Any drift fails closed.

After a successful manual database deployment, `Supabase migrations` records
production completion and trusted `Release sync` checks any frontend/database
skew for that same commit.

## Release order when frontend and database both changed

1. Merge the reviewed exact-head change to protected `main`.
2. Confirm the main push is Vercel-production-deploy-free and any migration is
   shadow-verified only.
3. Explicitly authorize and run `Deploy Vercel production` for the exact main
   SHA if the commit changed frontend-bearing paths.
4. Explicitly authorize and run `Deploy Supabase migrations` for the same exact
   main SHA when production database/Edge deployment is required.
5. Confirm `Release sync` is green for the exact SHA.

For migration-only commits with no frontend-bearing changes, step 3 is omitted.

## Before merge

- `npx tsc -b` and `npm run build` locally or in trusted CI.
- New migration files: `YYYYMMDDHHMMSS_name.sql`, idempotent where possible,
  never modify an already-deployed migration file.
- Contract tests: add the applicable DB/authority contract and wire it into the
  matching check workflow.
- Migration-bearing changes need exact-head Verification before merge.
- Release-control changes must prove that `main` cannot silently regain an
  automatic production deployment path.

## After merge

Confirm:

- there is no Vercel production deployment created merely because `main` moved;
- for a migration-bearing commit, `Supabase migrations` ✅ says shadow
  verification passed and production deploy is deferred;
- `Release sync` ✅ says the production database is unchanged;
- the Supabase workflow's production `deploy` job is `skipped` on push.

Do not infer production application from files being present on `main`.

## After separately authorized production deployment

For Vercel, confirm the manual workflow targeted the authorized exact main SHA,
the deployment reached READY, and the `Vercel` commit status points to that
verified deployment.

For Supabase, confirm:

- `Supabase migrations` ✅ reports authorized production deployment completed;
- `Release sync` ✅ confirms frontend/database synchronization when relevant.

Anything else — read the status description; it names the failure mode.

## UI verification without production credentials

Legacy passcode mode exists only in dev builds. To smoke-test UI flows:

```
# temporary file, delete afterwards
.env.legacytest:  VITE_SUPABASE_URL=  /  VITE_SUPABASE_ANON_KEY=
node ./node_modules/vite/bin/vite.js --mode legacytest --port 5174
# passcodes: owner/account 0000, warehouse 4444, driver 6666
```
