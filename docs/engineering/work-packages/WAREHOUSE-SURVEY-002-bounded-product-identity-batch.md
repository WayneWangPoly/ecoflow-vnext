# Work Package: `WAREHOUSE-SURVEY-002 bounded Product Identity batch repair`

## Objective

Unblock one real Barcode Survey golden path without replacing the merged Survey → Product Identity bridge or weakening Product Identity authority. An Owner/Admin starts a batch for an explicit list of unresolved Commercial SKU IDs; all capture, submit, publish and canonical resolution continue through the existing functions.

## Failure evidence and root cause

- Production read-only verification on 2026-09-03 found 25 `READY_TO_RECONCILE` Survey observations.
- Candidate observation `8b562522-6b56-4a04-8db9-d7cee12a4dee` resolves deterministically to Commercial SKU `6946f415-68ea-484a-91f4-848b7ec048ec` (`R-360Y`).
- Production has 163 blocking `OPEN` Product Identity tasks.
- `ecoflow_start_product_identity_batch` intentionally attaches every unresolved catalog task to the new batch.
- `ecoflow_submit_product_identity_batch` and `ecoflow_publish_product_identity_batch` reject a batch while any attached blocking task is `OPEN` or `CONFLICT`.
- Consequently, reconciling this one candidate can create a DRAFT but cannot submit or publish independently. The bridge itself, Commercial SKU resolver, capture authority and barcode resolver are present and do not need reimplementation.

## Scope

- Add immutable `ecoflow_product_identity_batch_scope_items` command evidence.
- Add Owner/Admin-only `ecoflow_start_bounded_product_identity_batch(text,uuid[],uuid)`.
- Attach only explicitly selected unresolved Commercial SKU tasks.
- Reject command replay when actor, name or SKU scope changes.
- Reject a Product Identity observation whose Commercial SKU is outside a bounded batch scope.
- Keep legacy unscoped batches compatible.
- Exercise the existing capture → submit → publish → canonical resolver path in PostgreSQL 17.

## Explicit exclusions

- No second Product Identity, barcode, Commercial SKU or inventory authority.
- No name-similarity matching or automatic Physical SKU creation.
- No change to `ecoflow_reconcile_barcode_survey_observation_v1`, `ecoflow_capture_product_identity`, submit, publish or resolver semantics.
- No production mutation, Receiving, Stocktake, Pick, inventory/location movement, Unleashed acquisition, #338 PLAN, asset authorization or image copy.
- No UI or Edge Function change.

## Contract

- Scope is 1–25 distinct explicit Commercial SKU UUIDs.
- Each SKU must exist, have an active Ordermentum mapping, not be a service item, and have no active Commercial-family identity contract.
- One open Product Identity batch remains the global invariant.
- Same command UUID + same actor/name/sorted scope returns `REPLAYED`; changed payload fails closed.
- Scope rows are append-only, RLS protected and browser read-only.
- The observation guard applies only when scope rows exist, preserving existing legacy batch behaviour.
- Publishing a bounded batch resolves only its attached tasks; unrelated OPEN evidence remains unattached and unchanged.

## Acceptance

- [ ] Existing #328 static and DB contracts remain green.
- [ ] Bounded batch DB contract proves unrelated OPEN evidence does not block the selected SKU.
- [ ] Out-of-scope observation fails and rolls back the existing capture transaction.
- [ ] Existing capture, Owner/Admin submit, publish and canonical barcode resolver complete in the fixture.
- [ ] Resolver returns exactly one ACTIVE Physical SKU for the published barcode.
- [ ] Direct browser DML, Warehouse start, changed replay and second open batch fail closed.
- [ ] Inventory movement sentinel remains unchanged.
- [ ] Typecheck and production build pass.

## Production authorization gate

Deployment of this migration is separate from business mutation. After deployment, Chat must explicitly approve the exact candidate fields and bounded command IDs before start/reconcile/submit/publish. Receiving, Stocktake and Pick remain separately gated after canonical publication.

## Rollback

Before deployment, revert this package. After deployment, use a forward migration to revoke the new RPC and observation trigger; retain scope evidence. Existing Product Identity authority remains intact.
