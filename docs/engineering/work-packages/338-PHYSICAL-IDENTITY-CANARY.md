# Work package: #338 Physical Identity canary evidence and contract

Status: EVIDENCE HOLD. No production start, reconcile, submit or publish authorized.

## Objective and baseline

Prepare one explicit Product Identity canary after Identity Unlock Batch 1B,
without inferring physical identity from Commercial promotion.
Baseline: `fdb29a9d5295e069d865b7fe62ccb793c8884a0e`, PR #386,
[#338 checkpoint 5578030418](https://github.com/WayneWangPoly/ecoflow-vnext/issues/338#issuecomment-5578030418).
Branch: `agent/product-identity/338-physical-canary`.

## Owner, scope and boundaries

- Implementation: Domain contract/evidence audit; independent Verification required.
- Chief Engineer review and explicit production authorization remain pending.
- In scope: this evidence package plus a synthetic PostgreSQL contract over the incumbent authority only.
- No application, migration, RPC, workflow or production business-behaviour change.
- Do not repeat #338 images, #359, CCSA8-90 or Commercial promotions.
- CCSB6-80 stays conflict and outside the batch.
- #339B, SOH/opening balance, inventory/location authority and cutover stay HOLD.
- No inferred preferred-package or substitution authority.

## Production read-only audit, 2026-09-08

All 21 codes have one direct OBSERVED_NOW observation, one physical signature,
zero active carton barcode bindings, zero active Commercial-family links and
zero reconciliation records. There are no open DRAFT/SUBMITTED batches.
CCSKBM8-90 and KSB16 each also retain one DEFERRED_INACCESSIBLE observation;
those historical rows must not be promoted or discarded.

| Commercial code | Observed carton barcode | Sleeve evidence |
|---|---|---|
| BPB8 | 19348045005009 | NO_SEPARATE_BARCODE |
| CCEA16-90 | 757953138426 | SCANNED: 757953138754 |
| CCLGPLA-90 | 757953139751 | SCANNED: 757953139768 |
| CCLWPLA-62 | 757953139737 | SCANNED: 757953139744 |
| CCSA8-80 | 757953138358 | SCANNED: 757953138280 |
| CCSB12-80 | 757953138624 | SCANNED: 757953138853 |
| CCSB8-80 | 757953138600 | SCANNED: 757953138822 |
| CCSKBM12-80 | 757953139676 | SCANNED: 757953139690 |
| CCSKBM12-90 | 757953139683 | SCANNED: 757953139706 |
| CCSKBM8-90 | 757953139652 | SCANNED: 757953139669 |
| FL115PLABOX | 19348045010188 | NO_SEPARATE_BARCODE |
| KRC500 | (01)19348045026301 | SCANNED: 9348045026304 |
| KRC650 | (01)19348045026318 | SCANNED: 9348045026311 |
| KRCL | 19348045026424 | SCANNED: 9348045026342 |
| KSB16 | 19348045021092 | SCANNED: 9348045021095 |
| Q404S0001 | 19310707018139 | SCANNED: 9310707018132 |
| Q514S0001 | 19310707072803 | SCANNED: 9310707072806 |
| SB24/32/40LBOX | 19348045022914 | NO_SEPARATE_BARCODE |
| SB24/32/40SLBOX | 19348045024383 | SCANNED: 9348045024386 |
| SB32BOX | 19348045022860 | SCANNED: 9348045022863 |
| WRC750 | 19348045026400 | SCANNED: 9348045026403 |

These are barcode observations, not verified pack quantities or brand/family
authority. Survey notes are null. Product names are catalog context, not
physical conversion evidence. Preserve raw GS1-looking strings; do not silently
normalize them in this package.

A production read of the already-published `R-360Y` golden path makes the
conversion boundary concrete: its Commercial description says `1000pcs`, while
its canonical Product Identity package is `CARTON` with `units_in_base_unit=1`.
That precedent does not define BPB8; it proves catalog piece counts cannot be
copied into `units_in_base_unit`. The BPB8 package level and units-per-package /
base-unit conversion value must be explicitly confirmed under the incumbent
Product Identity semantics.

## Proposed minimum canary: BPB8 only

- Commercial SKU: `ec67ca0a-67b5-437f-96a8-81e6268faa44`.
- Survey observation: `5a5a63e4-2b52-43e0-b96b-6129415585ee`.
- Carton barcode: `19348045005009`.
- Observed at: `2026-08-20 03:21:05.321852+00`.
- Evidence: OBSERVED_NOW / NO_SEPARATE_BARCODE, no duplicate signature.
- Request fingerprint: `cd289f2498d732150c6fa4286cc26cef` (not the bridge source fingerprint).
- No existing physical code/name match found for BPB8 / 8oz soup; exact canonical
  collision checks must be repeated once proposed physical/family codes exist.
- Reason: one carton barcode, no sleeve publication or barcode normalization
  needed. The other 20 remain outside the proposed batch.

Missing before production executable preparation: explicit Physical SKU code and
physical name, family code/name, package level, units-per-package/base-unit
conversion value, substitution policy and the first preferred Commercial-family
link decision. Brand and supplier are nullable under the incumbent RPC and may
remain unknown. The catalog string's `1000pcs` is not accepted as conversion or
measurement authority. No production command IDs or mutation payload are
generated while these required inputs are unknown.

## Existing server contract and material limitation

Reuse `ecoflow_start_bounded_product_identity_batch(text,uuid[],uuid)` with a
single explicit Commercial UUID. It accepts 1-25 distinct eligible SKUs,
enforces one open batch globally, binds replay to actor/name/sorted scope, and
guards observations against out-of-scope capture. Scope evidence is immutable.

Reuse `ecoflow_reconcile_barcode_survey_observation_v1`: Owner/Admin only,
locks the observation, checks direct evidence, duplicate signatures, unique
Commercial identity and active barcode collisions, then invokes existing
capture. It creates DRAFT physical/family/package/barcode rows, not just an
inert staging note. The bridge captures the carton barcode only; the scanned
sleeve is evidence and is not automatically published.

First identity capture also requires a Commercial-family preferred link:
`is_preferred=false` raises `PREFERRED_PHYSICAL_SKU_REQUIRED_BEFORE_ALTERNATIVE`
when no active family link exists. `true` creates a DRAFT preferred link and
records substitution policy. All 21 currently have no active family link.
Therefore a claim that the existing first-capture path creates only
physical/package/barcode rows would be false. Do not use defaults to cross this
boundary. The eventual reviewed payload must explicitly cover this link, or
a separately bounded contract change is required. No such change is made here.

Replay limitation: the reconciliation bridge checks observation/source
fingerprint but returns existing results before comparing every caller field
(batch/physical/family/units/policy). Preflight and postflight must verify the
stored batch and complete capture payload; a REPLAYED label alone is not proof
that a changed request was accepted. Do not opportunistically change the RPC.

Submit and publish must use the existing Owner/Admin RPCs, current revision and
separate command IDs. OPEN/CONFLICT tasks block transition. After an explicit
authorization, verify every actual output row, audit/provenance, canonical
barcode resolution and unaffected scope before expanding beyond one item.
Offline or uncertain outcomes do not count as success.

## Required gates and acceptance

- [x] Base SHA verified against fetched main.
- [x] Read-only physical observation inventory for 21 codes.
- [x] Single proposed candidate; no production mutation.
- [x] Synthetic executable fixture covers bounded capture/submit/publish, first-link denial, replay immutability, revision checks and unchanged inventory sentinel.
- [ ] Required production BPB8 physical facts and link/policy scope explicitly resolved.
- [ ] Fresh exact-head applicable CI completed after the final evidence/contract edit; record SHA and run IDs.
- [ ] Fresh independent Verification and Chief Engineer contract approval on that same exact head.
- [ ] Trusted production-schema shadow executed only if an actual migration becomes necessary.
- [ ] Explicit production authorization of exact fields and command IDs.

A trusted schema workflow may correctly return NOT_APPLICABLE for this
zero-migration PR; that is not a production-schema shadow execution or canary
PASS. Do not add a no-op migration merely to produce a green badge.

## Rollback and recovery

This package has no database mutation to reverse; close/revert the package if
rejected. Before future production start, re-run read-only checks and bind exact
observation/source fingerprint, Commercial mapping, actor, payload, scope and
command IDs. If drift or conflict appears, stop. Never delete survey history,
override conflicts, or broaden the other 20 items during recovery.
