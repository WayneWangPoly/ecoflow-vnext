# EcoFlow Release Process

## The one rule

**Database-compatible first, frontend second.** When a change spans schema and
UI, the migration must be backwards-compatible with the live frontend. Merging
a migration into protected `main` does not itself authorize production database
mutation.

## What happens on push to main

1. **Vercel** builds and deploys the frontend on every push (free plan has a
   daily build quota — see runbook).
2. If the push touches `supabase/**` or the Supabase release-control files,
   GitHub Actions runs the production-schema **shadow gate**:
   - a no-secret preflight confirms this is a protected-main push;
   - `shadow-verify` reads production migration history/schema, loads the schema
     into throwaway Postgres 17, and applies every pending migration there;
   - the production `deploy` job is required to be `skipped` on a push;
   - `Supabase migrations` becomes green only when shadow verification passed
     and production deployment remained deferred;
   - trusted `Release sync` reports that the production database is unchanged.

A green push therefore means **merge-safe / shadow-verified**, not "migration
already applied to production".

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

After a successful manual deployment, `Supabase migrations` records production
completion and trusted `Release sync` checks any frontend/database skew for that
same commit.

## Before merge

- `npx tsc -b` and `npm run build` locally or in trusted CI.
- New migration files: `YYYYMMDDHHMMSS_name.sql`, idempotent where possible,
  never modify an already-deployed migration file.
- Contract tests: add the applicable DB/authority contract and wire it into the
  matching check workflow.
- Migration-bearing changes need exact-head Verification before merge.

## After merge

For a migration-bearing main commit, confirm:

- `Supabase migrations` ✅ says shadow verification passed and production deploy
  is deferred;
- `Release sync` ✅ says the production database is unchanged;
- the workflow's `deploy` job is `skipped`.

Do not infer production application from a migration file being present on
`main`.

## After separately authorized production deployment

Confirm the manual workflow targeted the authorized exact main SHA and that:

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
