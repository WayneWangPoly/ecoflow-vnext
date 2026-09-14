# Work Package: `ECOFLOW-R5-002A Owner/Admin acquisition carrier`

## Objective

Add a fresh-main, Owner/Admin-only, one-shot production UI carrier for the
separately governed `ECOFLOW-R5-002` ADL1 StockOnHand acquisition. This package
only makes the exact request available to an authenticated operator; it does
not execute the acquisition or authorize a retry.

## Owner and review

- Implementation role: Codex implementation agent
- Verification role: independent PR verification
- Chief Engineer: WayneWangPoly
- Base revision: `9307bd891afdcf1a8ffab15c7bcf4d51c4d0cd68`
- Branch: `agent/unleashed/r5-002a-auth-carrier`

## In scope

- A parameter-frozen client request for `stock_on_hand`, warehouse `ADL1`,
  `bounded_snapshot`, page size 200, at most five pages, starting at page 1,
  with no continuation or modified-since cursor.
- An explicit Owner/Admin UI acknowledgement and single-attempt control.
- Server-side validation of the frozen `ECOFLOW-R5-002` request shape.
- An atomic request-key uniqueness fence that rejects reload, concurrent, and
  later replay attempts before any Unleashed request.
- Static, TypeScript/build, and PostgreSQL contract verification.

## Out of scope

- Executing `ECOFLOW-R5-002` during development, CI, verification, deployment,
  or post-deployment inspection.
- Any STAGE, opening-balance, stocktake, inventory movement, Product Identity,
  Commercial Wave 2, provider write, or inventory-authority change.
- Browser-side Unleashed credentials, raw provider payloads, automatic retry,
  continuation, or pagination beyond the frozen five-page window.
- Changes to existing generic probe and four-resource acceptance semantics.

## Behaviour contract

- The UI is available only through the existing Owner/Admin operational
  settings surface and requires a task-specific acknowledgement.
- The client sends exactly one authenticated Edge Function invocation with
  `requestKey: ECOFLOW-R5-002` and the frozen request parameters.
- The Edge Function remains the authority for active Owner/Admin role checks.
- Any shape drift for the reserved request key returns HTTP 400 before a run is
  created or Unleashed is contacted.
- A unique partial index over `unleashed_sync_runs.metadata.request_key` makes
  the first run creation the atomic one-shot claim. A duplicate returns HTTP
  409 `UNLEASHED_REQUEST_KEY_REPLAY_BLOCKED` before provider traffic.
- The request key remains in run metadata through finalization so successful,
  partial, failed, and interrupted first attempts all remain non-retryable.
- The response and UI expose only run identifiers, counts, hashes, status, and
  pagination evidence; raw StockOnHand records remain server-side.
- The UI disables the control as soon as an attempt begins and directs the
  operator to verify the production ledger rather than retrying after any
  ambiguous or failed response.

## Acceptance criteria

- [ ] Frozen request constants and response validation have executable tests.
- [ ] Server rejects reserved-key parameter drift before run creation.
- [ ] PostgreSQL proves that two rows cannot claim `ECOFLOW-R5-002`.
- [ ] Duplicate-key handling returns 409 without reaching the fetch loop.
- [ ] Final run metadata, audit evidence, and response retain the request key.
- [ ] Owner/Admin acknowledgement and single-attempt UI states are covered.
- [ ] Existing connector contract tests, typecheck, and production build pass.
- [ ] PR checks and independent verification pass at the exact head SHA.
- [ ] Production deployment is verified without invoking the carrier.
- [ ] A fresh post-merge R5-002 binding is recorded and execution remains held.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | `node --experimental-strip-types --test scripts/r5-002a-authenticated-acquisition-carrier-contract.test.mjs` | Frozen client, server fence, UI lock, workflow, and response contracts pass. |
| Database | Apply the new migration twice, then run `scripts/r5-002a-authenticated-acquisition-carrier-db-contract-test.sql` | Migration is replay-safe and the second request-key claim raises `unique_violation`. |
| Regression | `npm run audit:unleashed` | Existing GET-only, bounded, credential, and target contracts pass. |
| Compile | `npm run typecheck && npm run build` | TypeScript and production bundle pass. |
| Production | Open the deployed Owner/Admin surface without acknowledgement or invocation | Frozen scope is visible; acquisition remains unexecuted. |

## Rollback and recovery

Revert the UI, client, Edge Function, workflow, and work-package changes. Drop
only the named request-key unique index in a forward migration if the carrier
must be fully removed. Existing run and audit evidence is retained. A failed or
ambiguous first attempt is a HOLD condition, not retry permission; recovery
requires a newly approved task and request key.
