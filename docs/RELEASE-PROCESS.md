# EcoFlow Release Process

## The one rule

**Database-compatible first, frontend second.** When a change spans schema and
UI, push the migration (backwards-compatible with the live frontend) before or
together with the frontend that depends on it — never a frontend that requires
schema the database does not have yet.

## What happens on push to main

1. **Vercel** builds and deploys the frontend on every push (free plan has a
   daily build quota — see runbook).
2. If the push touches `supabase/**` or the deploy workflow, GitHub Actions
   runs:
   - `shadow-verify`: dumps the production schema into a throwaway Postgres 17
     and applies every pending migration there. Failure blocks production.
   - `deploy`: applies pending migrations via the IPv4 pooler (CLI pinned to
     2.107.0, 3 retries) and deploys all edge functions.
   - `finalize`: posts the `Supabase migrations` commit status, then the
     `Release sync` status — failure means the DB moved but the frontend for
     the same commit did not ship (skew).

## Before you push

- `npx tsc -b` and `npm run build` locally.
- New migration files: `YYYYMMDDHHMMSS_name.sql`, idempotent where possible,
  never modify an already-deployed migration file.
- Contract tests: add a `scripts/*-contract-test.sql` + fixture for new DB
  contracts; wire it into the matching check workflow.

## After you push

Green means: `Supabase migrations` ✅ and `Release sync` ✅ on the commit.
Anything else — read the status description; it names the failure mode.

## UI verification without production credentials

Legacy passcode mode exists only in dev builds. To smoke-test UI flows:

```
# temporary file, delete afterwards
.env.legacytest:  VITE_SUPABASE_URL=  /  VITE_SUPABASE_ANON_KEY=
node ./node_modules/vite/bin/vite.js --mode legacytest --port 5174
# passcodes: owner/account 0000, warehouse 4444, driver 6666
```
