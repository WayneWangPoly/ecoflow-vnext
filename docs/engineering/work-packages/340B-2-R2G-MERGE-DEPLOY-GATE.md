# ECOFLOW-340B-2-R2G — Merge / production deploy authority split

## Objective

Make a migration-bearing merge to protected `main` non-mutating by default.
A `main` push may inspect production migration history/schema and apply pending
migrations only to a disposable shadow Postgres instance. Applying migrations
or deploying Edge Functions to production requires a separate, explicit,
exact-head manual authority event.

## Canonical baseline

- protected `main`: `0f1c20c4ad6bdbbbf6d895c23156da44b292aac2`
- triggering discovery: PR #420 is independently verified and merge-ready, but
  its formal migration would cause the previous push-triggered workflow to run
  `supabase db push --yes` automatically.
- R2G does not modify PR #420, the R2 migration SQL, Customer/Site evidence, or
  any production business row.

## In scope

- `.github/workflows/deploy-supabase-migrations.yml`
- `.github/workflows/release-sync-authority.yml`
- `scripts/supabase-deploy-gate-contract.test.mjs`
- release/runbook/ADR documentation describing the split

## Out of scope

- applying any migration to production;
- deploying any Supabase Edge Function;
- executing Customer/Site promotion RPCs;
- provider traffic;
- inventory / #339 mutation;
- Product Identity / #338 mutation;
- changing the reviewed R2 SQL or formal migration;
- merging R2G or #420 in this engineering task.

## Behaviour contract

### Protected-main push

A push to `main` matching the Supabase release paths:

1. passes a no-secret event-authority preflight;
2. may read production migration history/schema;
3. applies pending migrations only to the disposable shadow database;
4. must leave the production database and Edge Functions unchanged;
5. posts `Supabase migrations = success` only when the shadow gate passed and
   the production `deploy` job is `skipped`;
6. posts `Release sync = success` through trusted release-sync authority with
   wording that production was unchanged and deployment remains deferred.

### Manual production deployment

Production mutation is reachable only from `workflow_dispatch` when all of the
following are true before production credentials are used:

- dispatch ref is `refs/heads/main`;
- `expected_main_sha` is supplied and equals the workflow SHA;
- a fresh fetch of `origin/main` still equals that exact SHA;
- confirmation input is exactly `DEPLOY_SUPABASE_PRODUCTION`.

Only after those checks and a successful production-schema shadow gate may the
existing migration/application and Edge Function deployment steps run.

### Fail closed

Unsupported triggers, stale SHAs, wrong refs, missing/mismatched confirmation,
shadow failures, or skipped/failed manual deploys publish failure rather than
claiming a production release.

## Acceptance criteria

- automated contract proves production-mutating commands are below a
  `workflow_dispatch`-only deploy job;
- automated contract proves push completion explicitly says production deploy
  is deferred;
- release-sync authority distinguishes upstream `push` from
  `workflow_dispatch` and never describes a push-only run as database deployed;
- existing transient retry, migration isolation, IPv4 pooler, migration apply,
  Edge Function deploy, deployment-log artifact, and Vercel skew checks remain
  available on the manually authorized production path;
- repository CI / TypeScript / production build remain green;
- independent Verification is required on the exact head before merge.

## Required evidence

- exact changed-file list;
- `node --test scripts/supabase-deploy-gate-contract.test.mjs` PASS;
- existing release-sync contract PASS;
- exact-head GitHub checks PASS;
- independent review bound to the exact head;
- durable #340 / #335 checkpoint recording zero production deployment/mutation.

## Merge order

1. R2G engineering PR → exact-head CI → independent Verification.
2. Separate authorization to merge R2G.
3. Confirm the post-merge `main` run is shadow-only and production deploy job
   is skipped.
4. Revalidate PR #420 against the new protected `main`; refresh/rebase only if
   Git ancestry requires it.
5. Separate #420 merge authorization.
6. Separate production migration deployment authorization using exact protected
   `main` SHA.
7. Separate Customer 82 / Site 71 promotion authority.

## Rollback / compensating action

Before any manually authorized production deployment, R2G is control-plane only
and can be reverted by restoring the prior workflows. Once a manual production
deployment has occurred, do not roll back by rewriting migration history;
follow the migration-specific forward/compensating plan instead.
