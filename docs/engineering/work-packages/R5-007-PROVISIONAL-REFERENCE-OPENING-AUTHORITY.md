# ECOFLOW-R5-007 — Provisional reference planning evidence

## Purpose

#339 has two already-started positive-stock R5-005B commissionings that remain DRAFT while ADL1 is relocating inventory.

The Owner's accepted operating decision is precise:

- the frozen Unleashed QtyOnHand may be retained as a **provisional migration/reference baseline**;
- the planned shelf may be retained as migration planning evidence;
- neither value is a physical count;
- warehouse staff will later provide the truthful location(s) and counted cartons.

R5-007 encodes that decision without manufacturing physical evidence and without creating operational inventory authority.

## Why this package is evidence-only

An earlier R5-007 engineering draft considered placing the provisional quantity into `ecoflow_warehouse_location_items` with `HOLD` status.

That approach was rejected during second-layer review because existing historical warehouse/analytics paths are not uniform about status filtering. Some rollups sum location quantity or treat any non-`ZEROED` row as occupied. A provisional quantity in the live location ledger could therefore leak into stock totals even if picking itself filtered `ACTIVE`.

The final R5-007 design writes **no operational quantity at all**.

## Frozen scope

Exactly two existing DRAFT rev0 commissionings:

| SKU | Commissioning | Immutable reference | Planned location |
| --- | --- | ---: | --- |
| R-360Y | `44f09191-85f6-4682-8934-98c459cc4d88` | 3 cartons | `A2-03-02A` |
| SB24/32/40LBOX | `2124ea46-765f-488a-8442-baf9dbd268d0` | 5 cartons | `A2-03-03A` |

Frozen upstream evidence:

- reference batch: `4cdb85d3-06d8-44bf-96bb-93660e10c3c9`;
- source run: `5cd0e73b-956d-4c80-9e70-6d841d27b163`;
- source-set SHA-256: `215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d`;
- exact source-row SHA-256 per frozen target;
- exact existing Physical SKU / CARTON package / barcode binding per target;
- planned locations must still exist and be ACTIVE.

No third SKU or commissioning can enter the authority.

## Authority semantics

The authenticated apply RPC:

1. requires Warehouse Control mutation authority and records `auth.uid()`;
2. serializes per commissioning;
3. verifies the latest SEALED reference and every frozen reference/Physical/package/barcode/planned-location identity;
4. requires the commissioning to remain `DRAFT rev0` with no physical location evidence or stocktake session;
5. requires zero pre-existing non-zero warehouse quantity and zero inventory movements for the Physical SKU;
6. records exactly one immutable provisional reference row containing the frozen quantity and planned location;
7. binds replay to command ID + actor + payload hash;
8. explicitly reports `inventoryMutationCreated=false`, `physicalCountClaimed=false`, `operationalInventoryAuthorityCreated=false`, and `requiresLaterPhysicalStocktake=true`.

The apply RPC does **not** insert/update:

- `ecoflow_warehouse_location_items`;
- `ecoflow_warehouse_movements`;
- `ecoflow_inventory_movements`;
- commissioning location evidence;
- commissioning status;
- stocktake sessions or observations.

## Later field reconciliation

R5-007 does not change the existing R5-005B physical evidence path.

When warehouse staff obtain truthful evidence, the operator still uses:

`RECORD_LOCATION(real location + counted cartons) -> FINALIZE -> MATERIALIZE(INITIAL/REVIEW) -> separately governed stocktake APPROVE`.

Only that path can create operational warehouse quantity and adjustment movements.

After the commissioning-linked stocktake reaches `APPROVED`, an internal trigger marks the R5-007 provisional evidence `RECONCILED`. The original reference/planned-location record remains durable history; it is never rewritten to pretend it was a physical count.

## Explicit non-scope

This engineering package does not authorize or perform merge, production SQL deployment, production R5-007 evidence recording, warehouse/inventory quantity mutation, stocktake approval, Product Identity mutation, provider traffic, barcode reassignment/retirement, or #342 cutover.

## Migration materialisation

Formal materialisation is complete.

Repository-pinned Supabase CLI version:

`2.107.0`

CLI command:

`supabase migration new r5_007_provisional_inventory_reference_evidence`

CLI-generated migration:

`supabase/migrations/20260921093607_r5_007_provisional_inventory_reference_evidence.sql`

The formal migration content is byte-for-byte identical to the reviewed carrier:

`scripts/r5-007-provisional-reference-opening-authority.sql`

No migration timestamp was manually invented.

Exact-head CI and trusted Supabase shadow must pass on the post-materialisation head before merge authority is considered.

## Acceptance focus

R5-007 succeeds only if reference quantity and planned placement are durable while physical-count claims and operational quantity mutation remain zero, later field stocktake remains mandatory, and reconciliation remains traceable.

Current disposition:

`MIGRATION_MATERIALISED / PROVISIONAL_REFERENCE_EVIDENCE_ONLY / ZERO_INVENTORY_MUTATION / HOLD_BEFORE_MERGE_AND_PRODUCTION_EXECUTION`
