# Work Package: `TRANSFORM-007 Shadow Bootstrap`

## Objective

Install one trusted-main, no-deploy verification path that can prove the fixed
`TRANSFORM-007A` migration against a read-only production-schema snapshot while
keeping the production database credential and write-capable GitHub token away
from pull-request-controlled code.

This package is release infrastructure for the Phase 5 migration-shadow exit
criterion. It adds no product surface, business command, database migration or
production write.

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
    and truthfully decide whether the fixed `007A` migration is in scope;
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
  - unrelated PRs receive a truthful non-applicable success;
  - PR `#274` stays draft and unmerged until its live gate and exact-SHA reviews
    pass; `007B` and `007C` do not start.

## Behaviour contract

- Input: a completed `TRANSFORM-007 shadow request` run associated with an open
  pull request targeting `main`.
- Accepted result: an unrelated PR receives a non-applicable success; a
  same-repository PR containing the exact
  `supabase/migrations/20260811020000_transform_007_operational_records.sql`
  blob receives success only after the live production-schema shadow passes.
- Conflict result: the resolver compares GitHub's authoritative `changed_files`
  count with the complete enumerated list, rejects the API's 3,000-file ceiling,
  and re-reads the PR snapshot after pagination. A changed head or test-merge
  SHA cannot inherit an older scope result.
- Rejected result: fork provenance, missing/closed PR, non-`main` base, changed
  trust-boundary file, unexpected additional migration, reader mismatch,
  already-deployed target, schema-load error or shadow failure produces failure
  or no status; none may be converted to success.
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
  ref, and fetches only the fixed candidate SQL path as untrusted bytes.
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
  synchronize races, additional migration edits, stale/deployed target state
  and missing credentials all fail closed.
- [ ] No Supabase deploy/link/push/migration-up/function-deploy command exists.
- [ ] PR `#274` receives a successful live result on its exact final SHA before
  it can merge; independent Verification then Chief Engineer review that SHA.
- [ ] After this bootstrap is merged and before `#274` can merge, the `main`
  ruleset requires PRs, the exact status from its expected source, strict
  up-to-date heads and no bypass. Under the authorised single-maintainer
  exception it does not claim an impossible author/code-owner self-approval;
  the two role reviews are retained as external exact-SHA evidence.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | `node --test scripts/transform-007-shadow-bootstrap.test.mjs` | trigger, permission, secret isolation, incomplete/oversize file lists, synchronize race, fixed-path fetch, no-deploy and dual-status contracts pass |
| Syntax | YAML parse plus `bash -n scripts/transform-007-shadow-runner.sh` | both workflows and the runner parse |
| Integration | trusted run with missing environment secret | fixed target fails closed without executing the local candidate job |
| Integration | trusted run with dedicated reader and PR `#274` | production schema/history are read, candidate applies only to PostgreSQL 17 and the same context succeeds on exact head and current test-merge SHA |
| Regression | all existing PR workflows on updated `#274` | application and repository gates remain green |

## Required evidence

- Changed files: only the six declared bootstrap paths.
- Build and test output: static contract, YAML/shell syntax and repository diff
  integrity; existing application build is not changed by this package.
- Migration/shadow result: bootstrap PR contains no migration. Live shadow is a
  mandatory post-bootstrap gate for PR `#274`, not evidence for this branch.
- Post-bootstrap `#274` release evidence (not bootstrap merge evidence): GitHub
  environment deployment-branch rule (`main` only), secret name without value,
  trusted run graph and exact-SHA PR status.
- Risks: GitHub environment configuration is external state and cannot be
  proven by repository text alone; evidence is mandatory before adding the
  secret.
- Known limitations: the gate is deliberately fixed to `TRANSFORM-007A`; it is
  not a general migration service.
- Deferred findings: Ordermentum sync failures and all `007B`/`007C` commands.

## Rollback

Before removing or renaming the workflows, remove or replace the matching
required-check/ruleset configuration so other PRs are not orphan-blocked. Then
revert the bootstrap commit and delete the environment secret. No database or
business-data rollback exists because the package is read-only and no-deploy.

## Decision log

### Decisions

- Use `workflow_run` because the trusted workflow definition comes from the
  default branch and is isolated from the pull-request workflow definition.
- Use an environment restricted externally to `main`, not a fictitious human
  reviewer, because this repository has one maintainer.
- Record the scoped single-maintainer exception in `FILE-OWNERSHIP.md`. The
  bootstrap uses existing CI + strict up-to-date + no bypass + external
  exact-SHA reviews; only after it reaches `main` does the ruleset add the exact
  trusted status for `#274`. The role reviews are evidence, not fictitious
  native approvals.
- Treat candidate SQL as untrusted bytes: never checkout the PR in the trusted
  workflow and execute the bytes only in a no-secret job under a local
  non-superuser.
- Validate direct persistent mutation privileges, ownership and reachable role
  membership on the reader. Do not require an impossible per-role denial of
  functions granted through PostgreSQL `PUBLIC`; the trusted-main workflow never
  invokes candidate-selected production routines.
- Keep the gate fixed to the one `007A` migration so the bootstrap does not
  expand the product work package into a general deployment platform.

### Assumptions

- GitHub's environment deployment-branch rule is configured to allow only
  `main` before `TRANSFORM_007_SHADOW_READ_DB_URL` is stored.
- The dedicated PostgreSQL role can read schema metadata and
  `supabase_migrations.schema_migrations` but cannot mutate persistent objects.

### Risks

- A missing required-check rule would make the status advisory rather than a
  merge gate; repository-setting evidence is required before `#274` release.
- Production schema can drift after a successful run; the final live gate is
  rerun on the exact feature SHA immediately before review and merge.

### Deferred

- Generalising the trusted path for future migrations requires a separate work
  package and review after `007A` is complete.
