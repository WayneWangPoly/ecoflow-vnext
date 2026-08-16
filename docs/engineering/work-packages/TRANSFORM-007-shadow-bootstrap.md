# Work Package: `TRANSFORM-007 Shadow Bootstrap`

## Objective

Install one trusted-main, no-deploy verification path that can prove the fixed
`TRANSFORM-007A` migration against a read-only production-schema snapshot while
keeping the production database credential and write-capable GitHub token away
from pull-request-controlled code.

This package is release infrastructure for the Phase 5 migration-shadow exit
criterion. It adds no product surface, business command, database migration or
production write.

## 2026-08-16 scope amendment

The original bootstrap below was deliberately fixed to the TRANSFORM-007A
migration because it was introduced to unblock PR #274. That historical scope
was correct for the bootstrap release, but it is no longer a truthful contract
for the repository-wide required status.

Production-gate inspection for WAREHOUSE-SURVEY-001 PR #319 found a new forward
migration at
`supabase/migrations/20260816061000_warehouse_survey_001_sku_context.sql`, while
`Supabase shadow gate (required)` reported success as not applicable. Trusted
run `31907934552` confirmed that both the production-schema read and the local
PostgreSQL 17 candidate apply were skipped. The required status had therefore
outgrown its historical TRANSFORM-007 filename scope.

The bounded follow-up control-plane change in PR #320 generalises only candidate
recognition:

- a PR with no `supabase/migrations/*.sql` change may be truthfully not
  applicable;
- a PR that changes migrations must contain exactly one newly added migration
  named `YYYYMMDDHHMMSS_lowercase_slug.sql`;
- multiple migration changes, malformed filenames and edits/renames of deployed
  migrations fail closed;
- the trusted-main `workflow_run` architecture, same-repository provenance,
  full file enumeration, immutable candidate blob binding, dedicated read-only
  production-schema reader, credential-free PostgreSQL 17 execution,
  non-superuser migrator, psql meta-command rejection and exact-head plus
  test-merge status publication remain unchanged.

This amendment does **not** turn the shadow path into a deployment service and
adds no production write authority. It also does **not** renew the expired
single-maintainer merge exception that was scoped only to the original bootstrap
and PR #274. A trust-boundary change such as PR #320 is expected to be blocked
by the currently deployed gate with `TRUST_BOUNDARY_CHANGED` and requires its
own explicit merge disposition before it may reach `main`.

## Owner and reviewers

- Implementation role: Platform/Release on
  `agent/platform/transform-007-shadow-bootstrap`
- Verification role: independent exact-SHA Verification review required
- Chief Engineer: workflow trust boundary, merge order and rollback review
  required
- Dependencies: merged `TRANSFORM-006`; existing empty
  `transform-007-shadow-read` GitHub environment
- Planned order: bootstrap draft PR, its independent Verification and Chief
  Engineer reviews, explicit merge authorisation, then rebase/update PR `#274`,
  then live shadow on its exact head and current test-merge commit, then final
  Verification and Chief Engineer review. `007B` remains forbidden throughout.

## In scope

- Allowed paths:
  - `.github/workflows/transform-007-shadow-request.yml`
  - `.github/workflows/transform-007-shadow-trusted.yml`
  - `scripts/transform-007-shadow-runner.sh`
  - `scripts/transform-007-shadow-bootstrap.test.mjs`
  - `docs/engineering/FILE-OWNERSHIP.md`
  - `docs/engineering/work-packages/TRANSFORM-007-shadow-bootstrap.md`
- Allowed behaviour changes:
  - emit a no-secret request run for every pull request targeting `main`;
  - let a default-branch `workflow_run` resolve the current same-repository PR
    and truthfully decide whether a migration is in scope;
  - read production migration history and `public` schema through a dedicated,
    default-read-only PostgreSQL role;
  - transfer only the schema-only dump, migration history, fixed candidate SQL
    and a hash manifest between isolated jobs;
  - execute candidate SQL only in a local PostgreSQL 17 service under a
    non-superuser role with no production secret or write-capable GitHub token;
  - publish `Supabase shadow gate (required)` to both the exact current PR head
    SHA and its validated current test-merge SHA, with evidence still bound to
    the immutable head.

## Out of scope

- Forbidden paths:
  - `src/**`;
  - `supabase/migrations/**` and `supabase/functions/**`;
  - existing production deployment workflows;
  - Ordermentum workflows;
  - PR `#274` application, route, repository or migration files.
- Behaviour that must remain unchanged:
  - this package never deploys, links, repairs or applies SQL to production;
  - the existing `Production` environment and write-capable PostgreSQL
    credential remain forbidden;
  - forks and PRs that modify the bootstrap trust-boundary files or the scoped
    single-maintainer ownership policy fail closed;
  - unrelated migration-free PRs receive a truthful non-applicable success;
  - migration-bearing PRs cannot receive not-applicable success merely because
    their migration slug belongs to a different work package.

## Behaviour contract

- Input: a completed `TRANSFORM-007 shadow request` run associated with an open
  pull request targeting `main`.
- Accepted result: a migration-free PR receives a non-applicable success; a
  same-repository PR containing exactly one canonical newly added migration
  receives success only after the live production-schema shadow passes.
- Conflict result: the resolver compares GitHub's authoritative `changed_files`
  count with the complete enumerated list, rejects the API's 3,000-file ceiling,
  and re-reads the PR snapshot after pagination. A changed head or test-merge
  SHA cannot inherit an older scope result.
- Rejected result: fork provenance, missing/closed PR, non-`main` base, changed
  trust-boundary file, multiple or malformed migration changes, deployed
  migration edit/rename, reader mismatch, already-deployed target,
  schema-load error or shadow failure produces failure or no status; none may be
  converted to success.
- Authoritative checks: GitHub API supplies current PR/base/head/file metadata;
  PostgreSQL supplies reader identity, privileges, migration history and schema.
- Revision/idempotency/actor/device: no business mutation exists. GitHub
  concurrency cancels obsolete runs for the same PR. The finalizer revalidates
  the current PR, publishes `pending` to test-merge and then head before either
  final result, then writes the same final context to head and test-merge. An
  interruption after the first accepted update therefore remains blocking on
  GitHub's primary PR status source.
- Offline policy: not applicable; unavailable GitHub or PostgreSQL authority
  fails closed.
- Audit/error behaviour: the Actions run URL is attached to the commit status;
  the artifact contains hashes and schema-only evidence for one day, never a
  database URL, password or production data.

## Acceptance criteria

- [ ] The request workflow has read-only contents permission, no environment,
  no secret reference and no production action; its PR checkout has persisted
  credentials disabled and runs only the bootstrap static contract.
- [ ] The trusted workflow exists only on `workflow_run`, never checks out a PR
  ref, and fetches only the resolved immutable candidate SQL path as untrusted
  bytes.
- [ ] The credentialed job uses `transform-007-shadow-read` with
  `deployment: false`; the environment is externally restricted to the `main`
  branch before its secret is added.
- [ ] The dedicated reader is pinned to EcoFlow project
  `kauqwlzuyxcudoyognwf`, the approved session-pooler endpoint and
  `sslmode=require`, with default read-only mode and no detected direct
  persistent mutation capability.
- [ ] Candidate SQL executes in a separate job with no environment secret and
  no status/write permission, using a non-superuser local role.
- [ ] The final job alone has `statuses: write`, revalidates the open PR snapshot
  and publishes `Supabase shadow gate (required)` fail-closed to both the
  resolved current head and current test-merge SHA.
- [ ] Forks, trust-boundary edits, incomplete or over-3,000 file enumeration,
  synchronize races, multiple/malformed migration changes, deployed migration
  edits, stale/deployed target state and missing credentials all fail closed.
- [ ] No Supabase deploy/link/push/migration-up/function-deploy command exists.
- [ ] Migration-bearing product PRs receive a successful live result on their
  exact final SHA before merge.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | `node --test scripts/transform-007-shadow-bootstrap.test.mjs` | trigger, permission, secret isolation, generic canonical migration scope, incomplete/oversize file lists, synchronize race, immutable-path fetch, no-deploy and dual-status contracts pass |
| Syntax | YAML parse plus `bash -n scripts/transform-007-shadow-runner.sh` | both workflows and the runner parse |
| Integration | trusted run with missing environment secret | migration target fails closed without executing the local candidate job |
| Integration | trusted run with dedicated reader and canonical migration PR | production schema/history are read, candidate applies only to PostgreSQL 17 and the same context succeeds on exact head and current test-merge SHA |
| Regression | WAREHOUSE-SURVEY-001 PR #319 | `20260816061000_warehouse_survey_001_sku_context.sql` must require the live shadow and can no longer receive false not-applicable success |

## Required evidence

- Changed files: only declared bootstrap trust-boundary/control-plane paths.
- Build and test output: static contract, YAML/shell syntax and repository diff
  integrity; application behavior is not changed by the control-plane package.
- Migration/shadow result: the bootstrap/control-plane PR contains no migration.
  A live shadow is mandatory on each later migration-bearing PR.
- Risks: GitHub environment configuration is external state and cannot be
  proven by repository text alone; evidence remains mandatory.
- Known limitations: the gate validates one newly added migration per PR. A
  deliberate multi-migration release requires a separately reviewed extension
  rather than silently widening this path.

## Rollback

Before removing or renaming the workflows, remove or replace the matching
required-check/ruleset configuration so other PRs are not orphan-blocked. Then
revert the control-plane commit. No database or business-data rollback exists
because the package is read-only and no-deploy.

## Decision log

### Historical bootstrap decisions

- Use `workflow_run` because the trusted workflow definition comes from the
  default branch and is isolated from the pull-request workflow definition.
- Use an environment restricted externally to `main`, not a fictitious human
  reviewer, because this repository has one maintainer.
- Record the scoped single-maintainer exception in `FILE-OWNERSHIP.md`. The
  bootstrap used existing CI + strict up-to-date + no bypass + external
  exact-SHA reviews; only after it reached `main` did the ruleset add the exact
  trusted status for `#274`. The role reviews are evidence, not fictitious
  native approvals.
- Treat candidate SQL as untrusted bytes: never checkout the PR in the trusted
  workflow and execute the bytes only in a no-secret job under a local
  non-superuser.
- Validate direct persistent mutation privileges, ownership and reachable role
  membership on the reader. Do not require an impossible per-role denial of
  functions granted through PostgreSQL `PUBLIC`; the trusted-main workflow never
  invokes candidate-selected production routines.

### 2026-08-16 decision

- Generalise candidate recognition after production evidence showed that a
  repository-wide required status cannot remain tied to one historical work
  package filename without producing false-green results.
- Keep the one-migration-per-PR bound rather than turning this repair into a
  broad migration orchestration redesign.
- Preserve every existing credential and execution isolation boundary; only the
  target filename classifier changes.

### Assumptions

- GitHub's environment deployment-branch rule remains configured to allow only
  `main` for `transform-007-shadow-read`.
- The dedicated PostgreSQL role can read schema metadata and
  `supabase_migrations.schema_migrations` but cannot mutate persistent objects.

### Risks

- A missing required-check rule would make the status advisory rather than a
  merge gate; repository-setting evidence is required for protected releases.
- Production schema can drift after a successful run; the final live gate is
  rerun on the exact feature SHA immediately before review and merge.

### Deferred

- Multi-migration candidate support remains out of scope and must be designed as
  a separate fail-closed extension if ever required.
