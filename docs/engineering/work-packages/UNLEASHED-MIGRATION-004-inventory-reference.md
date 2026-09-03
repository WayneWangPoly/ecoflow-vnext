# Work Package: `UNLEASHED-MIGRATION-004 / 339A Inventory Reference`

## Objective

Preserve one bounded Unleashed `stock_on_hand` source set as immutable,
warehouse-level reference evidence with deterministic mapping readiness and no
inventory authority effect.

## Owner and reviewers

- Implementation role: Platform/Data
- Verification role: independent inventory/concurrency/RLS verification
- Chief Engineer: required before merge or release
- Dependencies: ADR-0001, ADR-0002, ADR-0009; deployed #328/#329 Product
  Identity bridge; deployed #338 master-mapping schema
- Planned merge order: 339A schema/contracts, independent Verification, Chief
  Engineer approval; 339B remains a later work package

## In scope

- Allowed paths:
  - `supabase/migrations/20260903170435_unleashed_inventory_reference.sql`
  - `scripts/unleashed-inventory-reference-db-contract-test.sql`
  - `scripts/unleashed-inventory-reference-contract.test.mjs`
  - `scripts/audit-unleashed-inventory-reference.mjs`
  - `.github/workflows/unleashed-inventory-reference-check.yml`
  - this work package and the matching `package.json` audit entry
- Allowed behaviour changes:
  - service-role staging of already-governed `stock_on_hand` snapshots into an
    immutable reference batch;
  - Owner/Admin seal, reject, and supersede commands;
  - read-only mapping/readiness and batch-summary views.

## Out of scope

- Unleashed provider/API calls or any acquisition cadence change.
- #338 PLAN, asset authorization, or image copy.
- Physical SKU creation, barcode publication, or Product Identity mutation.
- Writes to `ecoflow_warehouse_location_items`,
  `ecoflow_warehouse_movements`, `ecoflow_inventory_movements`, or any other
  inventory authority.
- Starting, submitting, approving, or modifying an INITIAL stocktake.
- Assigning a warehouse total to a preferred Physical SKU, rack, bin, or
  fabricated location.
- Opening-balance authority, cutover, Ordermentum authority change, or work from
  #340/#345/#341/#342.
- Edge Functions: the DB/RPC contract is sufficient for 339A.

## Behaviour contract

### Immutable boundary

Each batch fixes `T = as_at`, `source_run_id`, a canonical source-set SHA-256,
and the exact durable row count. A row retains its raw snapshot UUID as a value,
not as a foreign key, so later raw-retention deletion cannot erase provenance.

The canonical source-set hash includes the source run, normalized UTC boundary,
external key, source payload hash, Product GUID/code, Warehouse ID/code, all
four quantity fields, source timestamps, and a deterministic row order.

### Stage command

`ecoflow_stage_unleashed_inventory_reference(command, requested_by, source_run,
as_at, reason)` is granted only to `service_role`. It accepts only a `SUCCEEDED`
bounded run whose declared resources and successful batch include
`stock_on_hand`. Empty, malformed, duplicate ProductGuid/WarehouseId, missing
identity, or post-boundary observations fail closed.

The command takes transaction advisory locks for both command identity and the
source-run/boundary. Same command and payload returns the recorded result; the
same command with changed payload raises `COMMAND_REPLAY_PAYLOAD_MISMATCH`.
Different commands cannot create the same source set because locking is backed
by a unique source-set hash.

### Lifecycle commands

Owner/Admin may seal, reject, or supersede through revisioned, payload-bound
RPCs. Seal recomputes the count and hash from durable rows before transitioning
`STAGED -> SEALED`. `SEALED` means accepted reference evidence only; it does not
commission inventory. Reject and supersede preserve all rows and command
history. Revision conflicts fail closed.

### Quantity semantics

- `QtyOnHand`: non-authoritative opening/reference anchor.
- `AllocatedQty`: reservation evidence, not an extra inventory deduction.
- `OnPurchase`: expected inbound evidence, never opening on-hand.
- `AvailableQty`: source comparison evidence, never writable authority.
- `source_available_formula_delta = AvailableQty - (QtyOnHand - AllocatedQty)`
  is surfaced, never silently repaired.

The future ownership boundary remains: inventory-effect events `< T` belong in
the Unleashed opening reference; events `>= T`, including equality, belong to
the WAYNX ledger. 339A records `T` but does not activate that boundary.

### Mapping/readiness

The row view resolves exact #338 Product GUID and Warehouse ID mappings. It
returns only one Commercial SKU or warehouse when exactly one current MATCHED
target exists. Ambiguous and missing mappings remain visible and fail closed.
An ACTIVE Commercial-to-Family contract supplies Physical Identity context,
but the reference quantity remains explicitly `UNLEASHED_WAREHOUSE_TOTAL` and
both assigned Physical SKU and assigned location stay null.

Readiness values are:

- `PENDING_PRODUCT_MAPPING`
- `AMBIGUOUS_PRODUCT_MAPPING`
- `PENDING_WAREHOUSE_MAPPING`
- `AMBIGUOUS_WAREHOUSE_MAPPING`
- `PENDING_PHYSICAL_IDENTITY`
- `READY_FOR_LOCATION_EVIDENCE`

`READY_FOR_LOCATION_EVIDENCE` permits only later 339B evidence work. It is not
quantity authority and does not select a Physical SKU or location.

### Access and audit

All three tables use RLS. Authenticated browser roles have SELECT only when the
existing application role is OWNER, ADMIN, or WAREHOUSE; browser DML is revoked.
All privileged functions fix `search_path`, revoke PUBLIC execution, and grant
only the declared caller. Every accepted command stores actor, expected
revision, payload hash, result, reason/status evidence, and an application audit
event.

Offline operation is not supported for lifecycle changes. A caller must receive
the server result before showing a stage/seal/reject/supersede transition as
accepted.

## Acceptance criteria

- [x] Exact source values and durable provenance survive raw snapshot deletion.
- [x] Stage/lifecycle replay is payload-bound and revision conflicts fail closed.
- [x] Database uniqueness and advisory locks prevent duplicate source sets.
- [x] Malformed/missing/duplicate/post-boundary source evidence is rejected.
- [x] Mapping states remain explicit; names never create mappings or Physical SKUs.
- [x] Source Available variance is reported without changing any quantity.
- [x] Allocated and OnPurchase produce no movement.
- [x] RLS and grants prohibit browser table writes.
- [x] Warehouse cannot seal/reject/supersede; Owner/Admin can.
- [x] No location item, stocktake, or movement is created by 339A.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | `node --test scripts/unleashed-inventory-reference-contract.test.mjs` | schema, privilege, hash, non-authority, and workflow contracts pass |
| DB/RLS | `psql -v ON_ERROR_STOP=1 -f scripts/unleashed-inventory-reference-db-contract-test.sql` | exact values, replay, drift, invalid-source, transitions, views, RLS, and zero-effect assertions pass on PostgreSQL 17 |
| Audit | `node scripts/audit-unleashed-inventory-reference.mjs` | bounded authority audit passes |
| Regression | `npm run audit:unleashed-master-data` | #338 contract remains unchanged |
| Build | `npm run build` | existing application compiles and builds |

## Required evidence

- Changed files: limited to the declared paths.
- Build and test output: attach exact local/CI commands and results to handoff.
- Migration/shadow result: PostgreSQL 17 DB contract plus protected trusted
  migration workflow; no production apply in this package.
- Screenshots: not applicable; no UI change.
- Risks: the current production bounded stock row is not a valid 339A source set
  if its run is not `SUCCEEDED` or Warehouse ID/code is absent. The stage RPC
  intentionally rejects it rather than weakening provenance.
- Known limitations: 339A does not turn a warehouse total into Physical SKU or
  location authority and cannot commission an opening balance.
- Deferred findings: 339B/339C commissioning, variance acceptance, straddle
  event evidence, and real warehouse golden path.

## Rollback

Before deployment, discard this branch. After migration deployment but before
any batches exist, use a separately reviewed forward migration to revoke the
RPCs/views and drop the empty 339A objects. Once reference evidence exists, do
not delete or rewrite it: revoke new staging, reject/supersede affected batches
through governed commands, and use a forward compensating migration. No
inventory reversal is required because 339A creates no inventory effect.

## Decision log

### Decisions

- Reuse #338 mappings and the existing Product Identity/INITIAL stocktake
  authorities; create no new mapping or inventory ledger.
- Keep `source_snapshot_id` as a durable UUID value without a raw-snapshot FK.
- Require exact warehouse identity in every source row; `warehouse:all` is not a
  commissionable warehouse reference.

### Assumptions

- A valid source run records `stock_on_hand` in `resource_set`, has a successful
  stock batch, and stores each exact row with `last_seen_run_id=source_run_id`.
- #338 and Product Identity objects remain deployed before 339A.

### Risks

- Future acquisition must retain real Warehouse ID/code instead of an aggregate
  `all` scope before a complete reference set can be staged.

### Deferred

- 339B location evidence/INITIAL commissioning bridge.
- 339C reconciliation, boundary invalidation, and cutover acceptance.
