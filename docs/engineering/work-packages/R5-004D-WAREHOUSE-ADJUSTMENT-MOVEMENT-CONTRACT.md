# Work Package: `ECOFLOW-R5-004D Warehouse adjustment movement contract hotfix`

## Objective

Make the existing stocktake approval command compatible with the production `ecoflow_warehouse_movements` movement-type constraint by admitting the already-used directional adjustment types `ADJUST_IN` and `ADJUST_OUT`, without changing stocktake business logic or approving any stocktake.

## Owner and reviewers

- Implementation role: Platform/Data
- Verification role: independent verification required before merge/deploy
- Chief Engineer: required for protected migration review
- Dependencies: protected main `1abdc2e6540228c37372675b5368d50f20038087`; production failure evidence in #339 comment `5706997713`
- Planned merge order: migration contract + regression test -> exact-head CI -> verification -> merge -> separately authorized exact-head Supabase deployment -> postflight -> only then reconsider BPB8 approval

## In scope

- Allowed paths:
  - `supabase/migrations/20260917013000_r5_004d_warehouse_adjustment_movement_contract.sql`
  - `scripts/r5-004d-warehouse-adjustment-movement-contract.test.mjs`
  - `.github/workflows/r5-004d-warehouse-adjustment-movement-contract.yml`
  - this work-package file
- Allowed behaviour change: `ecoflow_warehouse_movements.movement_type` additionally accepts `ADJUST_IN` and `ADJUST_OUT` while retaining every currently accepted value.

## Out of scope

- No edits to `ecoflow_approve_stocktake_session` or any other stocktake RPC.
- No BPB8 approval retry in this package.
- No inventory quantity, location-item, warehouse movement, inventory movement, provider, Product Identity/#338, or unrelated production mutation.
- No Vercel deployment.

## Behaviour contract

- Existing warehouse movement types remain accepted: `RECEIVE`, `MOVE_IN`, `MOVE_OUT`, `ADJUST`, `PICK`, `COUNT`.
- Directional stocktake adjustment types become accepted: `ADJUST_IN`, `ADJUST_OUT`.
- The migration performs schema-only constraint replacement; it does not insert, update, or delete business data.
- Existing stocktake approval semantics, revision checks, role checks, idempotency, audit, and movement generation are unchanged.
- Production deployment remains a separate exact-head authority gate.

## Acceptance criteria

- [ ] Forward migration drops and recreates only the named movement-type check constraint with the superset contract.
- [ ] Static regression test proves all eight accepted movement types are present and proves the approval RPC still emits `ADJUST_IN` / `ADJUST_OUT`.
- [ ] Exact-head CI passes the R5-004D contract test, typecheck, and production build.
- [ ] Production-schema shadow verification applies the pending migration cleanly.
- [ ] Production deployment applies only the new migration.
- [ ] Postflight confirms the production constraint contains the two new directional types and the BPB8 session is still `REVIEW / rev3` with no approval effects.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | `node --test scripts/r5-004d-warehouse-adjustment-movement-contract.test.mjs` | Exact superset constraint contract and no DML in hotfix migration |
| Build | `npm run typecheck && npm run build` | PASS |
| Migration | Supabase production-schema shadow gate | Pending migration applies cleanly |
| Production postflight | SELECT constraint/session/movement state | New types present; BPB8 remains unapproved until separate retry |

## Required evidence

- Changed files: exact PR diff only.
- Build and test output: GitHub Actions exact-head run.
- Migration/shadow result: protected `Supabase migrations` status after merge.
- Screenshots: not applicable; no UI change.
- Risks: a constraint replacement briefly acquires table lock during migration; the table contract is widened, never narrowed.
- Known limitations: this package does not exercise production approval.
- Deferred findings: none; approval retry remains a separate action after migration postflight.

## Rollback

If undeployed, revert the PR. If deployed, use a forward compensating migration only after proving no `ADJUST_IN` / `ADJUST_OUT` rows exist; never edit migration history. Do not narrow the constraint while directional rows are present.

## Decision log

### Decisions

- Preserve directional adjustment semantics instead of degrading warehouse movements to generic `ADJUST`.
- Widen the old warehouse-movement constraint because the newer inventory-movement contract already treats `ADJUST_IN` / `ADJUST_OUT` as first-class types.

### Assumptions

- Existing rows use only the old accepted subset, so widening is backward compatible.

### Risks

- Future consumers that hard-code the old six-value enum must tolerate the two new values; current repository search found no conflicting application enum.

### Deferred

- Retrying BPB8 INITIAL approval is explicitly deferred until production migration postflight passes.