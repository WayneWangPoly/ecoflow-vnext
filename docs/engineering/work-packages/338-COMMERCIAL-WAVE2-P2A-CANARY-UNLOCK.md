# #338 Commercial Promotion Wave 2 P2A canary-unlock carrier

Status: ENGINEERING ONLY. Merge, deployment and production unlock remain separately gated.

## Objective

Expose an authenticated, post-P1 SELECT-only P2A preflight and a single command-bound canary eligibility unlock. Reuse the incumbent database authority without exposing Commercial promotion.

## Owner and reviewers

- Implementation: Platform/Data + Frontend
- Verification: independent Verification agent on the immutable PR head
- Chief Engineer: required for migration, Edge Function and deployment workflow scope
- Dependency: protected main `46a59b10e1846d9cd35c0bae83e93f81f5344218`, merged/deployed PR #398, completed P1 command `18dc00fd-ffe5-4d96-9e91-830d2686ff8e`
- Merge order: forward preflight/wrapper RPC → authenticated Edge modes → typed repository/contract → existing Wave2 carrier → tests/documentation

## In scope

- A forward migration containing post-P1 P2A evidence, SELECT-only preflight and a thin wrapper around the incumbent unlock function.
- `WAVE2_CANARY_UNLOCK_PREFLIGHT` and `WAVE2_CANARY_UNLOCK` authenticated Edge modes.
- OWNER/ADMIN-only UI with P0/P1 as read-only history, separate P2A preflight/unlock actions and locked P2B/P3/P4 stages.
- Static and PostgreSQL 17 contracts for auth, drift, replay, concurrency and side-effect fencing.

## Out of scope

- Merging or deploying this carrier.
- Executing command `61b13a7c-18d1-48f0-b317-96d23607ddfb` in production.
- Commercial promotion, expansion, Product Identity, Physical SKU, package, barcode, image or inventory/location/movement mutation.
- Provider traffic, #339, #359, scheduled caller/auth changes and cutover.

## Frozen P2A input

- carrier base: `46a59b10e1846d9cd35c0bae83e93f81f5344218`
- completed PLAN command: `18dc00fd-ffe5-4d96-9e91-830d2686ff8e`
- unlock command: `61b13a7c-18d1-48f0-b317-96d23607ddfb`
- candidate count / distinct normalized codes: `164 / 164`
- cohort SHA-256: `79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a`
- canary: `140010`
- mapping: `3001d0f1-6c1b-4b15-98a0-91443ca6b525`, revision `0`
- source payload SHA-256: `016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8`
- source key: `guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b`

## Behaviour contract

P2A preflight authenticates an active OWNER/ADMIN and recomputes the incumbent 164-row evidence after P1. It requires exactly one completed exact PLAN ledger/audit, 164 eligible disabled candidates, one exact canary, 163 expansion rows, exact component hashes, no HOLD rows, and zero unlock/promotion state. `P0 ready=false` after P1 is expected and is not reused as the P2A predicate.

The command wrapper accepts only the frozen command and cohort hash. On first use it requires P2A readiness, then delegates the only write to `ecoflow_unlock_commercial_wave2_canary`. On replay it delegates to that same incumbent authority so its payload hash remains decisive. No second command ledger or transition implementation is introduced.

Expected future command effect is exactly one enabled candidate (`140010`), one CANARY phase unlock and one unlock command. Expansion remains disabled; promotions remain zero; no Commercial SKU or Physical/inventory/image authority is created.

## Acceptance criteria

- [ ] Exact candidate count/hash, component evidence and canary are required.
- [ ] Missing auth, wrong role/input, stale mapping/source/cohort evidence, prior promotion or unexpected unlock fail closed.
- [ ] Same command/same evidence safely replays; changed evidence conflicts.
- [ ] Concurrent calls result in exactly one unlock ledger and one enabled canary.
- [ ] P2A does not call the promotion function and P2B/P4 remain locked in the browser.
- [ ] P0/P1 contracts, PostgreSQL 17 contract, typecheck, production build and diff hygiene pass.
- [ ] Trusted production-schema shadow, independent Verification and Chief Engineer review pass on the exact head.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | P2A contract test | Exact frozen values, Edge separation, no provider/authority leakage |
| PostgreSQL 17 | P2A DB contract | Post-P1 READY, drift/role failures, replay conflict and side-effect sentinels |
| Concurrency | Two `dblink` calls with the same command/evidence | Both return safely; one enabled canary and one incumbent unlock ledger |
| Frontend/build | Typecheck and production build | Typed carrier compiles; P2B/P3/P4 remain locked |
| Trusted shadow | Production schema + candidate migration | Forward migration applies cleanly in isolated PostgreSQL 17 |

## Required evidence

- Changed files and exact branch head recorded on the PR.
- Exact-head workflow runs and trusted shadow status recorded on the PR.
- Independent Verification and Chief Engineer review recorded without representing them as native approvals.
- Production SELECT-only evidence remains `1 PLAN / 0 unlock / 0 promotion / 0 enabled` because this package does not deploy or execute P2A.

## Rollback

Before deployment, close the PR or revert its commit. After deployment, use a forward compensating migration to revoke and remove only the new P2A preflight/wrapper functions, and redeploy the prior Edge/frontend artifact. Never edit the deployed Wave2 migrations or delete incumbent ledgers.

## Decision log

### Decisions

- Preserve the incumbent unlock ledger, advisory lock, role check and transition logic.
- Add a thin wrapper only to bind the completed P1 prerequisite and frozen P2A command.
- Keep P2A unlock and P2B promotion in separate UI and server modes.

### Risks

- A deployed P2A button is a production mutation boundary; deployment and use require separate authorization.
- Any cohort, plan-ledger, mapping/source, unlock or promotion drift blocks first execution.

### Deferred

- P2B canary promotion, P3 verification and P4 expansion are separate packages.
- Image closure remains a separate #338 track.
