# ECOFLOW-R5-007 — Provisional reference opening authority

## Purpose

#339 remains blocked by a deliberate evidence distinction:

- the SEALED ADL1 Unleashed StockOnHand reference is immutable migration evidence;
- warehouse relocation means the two already-started R5-005B commissionings do not yet have truthful physical counts;
- the Owner explicitly accepted the frozen Unleashed QtyOnHand as a **provisional migration/reference baseline only**, with later warehouse stocktake/location correction.

R5-007 encodes that decision without pretending reference quantity is a physical count.

## Frozen scope

Exactly two already-started DRAFT commissionings:

| SKU | Commissioning | Immutable reference | Planned location |
| --- | --- | ---: | --- |
| R-360Y | `44f09191-85f6-4682-8934-98c459cc4d88` | 3 cartons | `A2-03-02A` |
| SB24/32/40LBOX | `2124ea46-765f-488a-8442-baf9dbd268d0` | 5 cartons | `A2-03-03A` |

The scope is bound to reference batch `4cdb85d3-06d8-44bf-96bb-93660e10c3c9`, source run `5cd0e73b-956d-4c80-9e70-6d841d27b163`, and source-set SHA-256 `215e9abeef4f291ac4324c07e968bb6f6c6d065e34eaed726750ce61e312d77d`.

No other SKU or commissioning is admitted.

## Authority semantics

The apply RPC:

1. requires authenticated Warehouse Control authority with mutation capability;
2. re-verifies the frozen commissioning/reference/Physical SKU/package/barcode/location bindings;
3. requires DRAFT rev0 and zero prior non-zero warehouse quantity / inventory movement;
4. writes the immutable Unleashed reference quantity to the frozen planned location as `HOLD`;
5. records one warehouse `ADJUST_IN` movement and one inventory `ADJUST_IN` movement with provenance `PROVISIONAL_OPENING_REFERENCE` / `UNLEASHED_REFERENCE_BASELINE`;
6. records immutable exactly-once command provenance;
7. explicitly reports:
   - `physicalCountClaimed=false`;
   - `operationalInventoryAuthorityCreated=false`;
   - `requiresLaterPhysicalStocktake=true`.

HOLD is intentional. Existing pick/read paths consume ACTIVE quantity; R5-007 does not make the provisional reference pickable.

## Later field reconciliation

R5-007 leaves the incumbent R5-005B commissioning in DRAFT.

When truthful field evidence becomes available, operators continue through the existing path:

`RECORD_LOCATION -> FINALIZE -> MATERIALIZE -> separately governed stocktake APPROVE`.

A database trigger prevents DRAFT -> FINALIZED when a provisional opening exists unless the field-evidence set includes the provisional location. This guarantees the later stocktake approval has an observation for the old HOLD location, so approval can overwrite/zero it instead of leaving duplicate quantity behind.

The field evidence may show:

- all stock is still at the provisional location;
- some remains there and some moved;
- none remains there and the provisional location is counted as zero.

Normal stocktake approval then creates only the required compensating ADJUST movements. Historical provisional movement evidence is never deleted or overwritten.

After the linked stocktake session reaches APPROVED, R5-007 provenance becomes `RECONCILED`.

## Explicit non-scope

This engineering package does not authorize or perform:

- production SQL/migration deployment;
- production provisional opening application;
- physical-count fabrication;
- stocktake approval;
- Product Identity mutation;
- provider traffic;
- barcode reassignment/retirement;
- any SKU outside the two frozen targets;
- #342 cutover.

## Migration materialisation

The reviewed SQL is intentionally held under `scripts/` at this stage.

Before production deployment, create the formal migration using the repository-pinned Supabase CLI with:

`supabase migration new <approved-r5-007-name>`

Then copy the reviewed SQL byte-for-byte into that generated migration file and rerun exact-head CI plus the required trusted Supabase shadow gate. Do not invent a timestamped migration filename.

## Current gate

`ENGINEERING_ONLY / PROVISIONAL_REFERENCE_NOT_PHYSICAL_COUNT / HOLD_BEFORE_MIGRATION_MATERIALISATION_AND_PRODUCTION_MUTATION`
