# Work package: #338 Physical Identity canary evidence and contract

Status: BATCH 2 P2 FRESH-SESSION RESUME / SUBMIT CARRIER IN REVIEW. Production execution remains HOLD.

## Batch 2 P2 fresh-session resume / SUBMIT carrier

This bounded repair starts from canonical `main`
`47ae33a29a6786c03937c7af4e9d138bdbdb344b`, production Batch 2
`97fd2036-d0ff-492d-8ae7-1c9c0e09e526` at `DRAFT` revision `2`, the no-write
HOLD checkpoint in
[#338 comment 5596588638](https://github.com/WayneWangPoly/ecoflow-vnext/issues/338#issuecomment-5596588638),
and the frozen Chief Engineer contract in
[#338 comment 5596684303](https://github.com/WayneWangPoly/ecoflow-vnext/issues/338#issuecomment-5596684303).

The independent Owner/Admin carrier works after a refresh or re-login and does
not recreate client-side P1 results. Its single action first calls the incumbent
authenticated current-batch read, then hydrates the exact batch, scope,
reconciliation, observation, family, Physical SKU, package, barcode and
Commercial-family link rows using RLS-governed `select` queries. The contract
requires the frozen batch/name/start command, `DRAFT` revision `2`, task counts
`0/2/0`, `canSubmit=true`, the exact two-SKU scope, both frozen reconciliation
and survey command mappings, both complete `CARTON x 1` DRAFT payloads, null
brand/supplier, `PROHIBITED`, preferred Physical links, and null submit/publish
fields. Missing, additional or mismatched evidence stops before the command.

Only after the complete server gate passes does the carrier build the immutable
SUBMIT input: batch `97fd2036-d0ff-492d-8ae7-1c9c0e09e526`, expected revision
`2`, command `bc5538d2-73e0-4aaf-987f-4b53fd8aa75d`, and the frozen #338 note.
The incumbent `submitProductIdentityBatch` remains the sole write call and its
acknowledgement must be the same batch at `SUBMITTED` revision `3` with
`APPLIED` or `REPLAYED`. The carrier then stops and states that publication
requires a separate execution.

There is no START or reconciliation import/call, command-ID generator, reopen,
generic fallback, publication authority, direct table write, service role/JWT
path, RPC/migration/schema/Edge Function addition, or inventory/SOH/location/
cutover authority. The existing Batch 2 lifecycle carrier, BPB8 carrier and
generic Product Identity workspace remain byte-identical to the baseline.
Trusted production-schema shadow is N/A because no migration changes. This
engineering package does not execute a production command and does not merge.
Rollback is a code-only revert of the independent carrier, SELECT repository,
contract tests, mount and documentation.

## Batch 2 authenticated explicit two-SKU carrier

This follow-up starts from production `main`
`28b7db0f58c883b42c6d995f145820a3b4e426b7` and the frozen Batch 2 evidence in
[#338 comment 5587798073](https://github.com/WayneWangPoly/ecoflow-vnext/issues/338#issuecomment-5587798073).
It adds an independent Owner/Admin carrier for exactly two Commercial SKUs:
`FL115PLABOX` (`16be45a8-a98d-4b15-af2e-1846817e8d98`) followed by
`SB24/32/40LBOX` (`7cb8c724-35cb-4132-9437-db4c15e13fde`). The frozen START
name, ordered scope and command ID are required exactly; no queue read or command
ID generator can expand or replace them.

Each reconciliation is a separate operator action bound to the actual START
batch ID. The contract requires the exact survey observation, command ID,
barcode acknowledgement, Physical/family code and name, nullable brand and
supplier, `CARTON x 1`, `PROHIBITED`, preferred link and audit note. The first
server read must prove the same batch at DRAFT revision 1 after FL115PLABOX. The
second must prove DRAFT revision 2, while the retained START and reconciliation
acknowledgements prove scope 2 and both exact identities. Catalog strings
`50pcs` and `125pcs` are not conversion evidence and are never mapped to units.

SUBMIT remains a separate explicit action. It reads the authenticated current
batch first and stops unless the actual START batch is DRAFT revision 2 with
`canSubmit=true`, then uses only the frozen SUBMIT command and note. PUBLISH is
likewise separate and requires a fresh read of the same batch at SUBMITTED
revision 3 with `canPublish=true`. The publish acknowledgement is accepted only
at PUBLISHED revision 4 with exactly 2 families, 2 Physical SKUs, 2 barcodes, 2
Commercial-family links, and a non-null publication timestamp.

The carrier reuses only the incumbent authenticated repositories and server
authority. It adds no RPC, migration, schema, Edge Function, raw DML, service
role, generic or reopen fallback, inventory/SOH/location mutation, or automatic
continuation. The existing BPB8 carrier and generic commissioning workspace are
unchanged. This engineering task does not execute START, RECONCILE, SUBMIT or
PUBLISH and does not merge. No migration is required; trusted production-schema
shadow is N/A. Rollback is a code-only revert of this independent carrier.

## P3 authenticated explicit PUBLISH carrier

This follow-up starts from production `main`
`a2f05e06207837a9241aacf4302727beee7432e8` after the BPB8 P2 SUBMIT canary
reached `SUBMITTED` revision `2`. The existing Owner/Admin bounded carrier gains
one independent P3 section hard-fenced to the BPB8 batch, expected revision `2`,
reserved PUBLISH command ID and reviewed publish note.

Before any write, the section calls the incumbent authenticated current-batch
read and fails closed unless the exact batch is `SUBMITTED` revision `2` with
`canPublish=true`. Only then does it call the existing
`publishProductIdentityBatch`, which maps the four frozen inputs to
`ecoflow_publish_product_identity_batch`. The acknowledgement must return the
same batch, `PUBLISHED` revision `3`, `APPLIED` or `REPLAYED`, exactly one
published family, Physical SKU, barcode and Commercial-family link, plus a
non-null publication timestamp.

The P3 path contains no command-ID generator, generic-publish fallback, reopen,
START, RECONCILE or SUBMIT fallback, raw DML, service-role path, inventory, SOH
or location authority. P1, P2 and the generic workspace keep their existing
semantics. This implementation task does not merge or execute production
PUBLISH. No migration is required; trusted production-schema shadow is N/A.
Rollback is the code-only revert of this bounded UI/contract change.

## P2 authenticated explicit SUBMIT carrier

This follow-up starts from production `main`
`532789fc71e319daff9ad7a58196b9eb4c95a5e9`, the P1 production PASS recorded
in [#338 comment 5582721390](https://github.com/WayneWangPoly/ecoflow-vnext/issues/338#issuecomment-5582721390),
and the Chief Engineer review in
[#338 comment 5582759072](https://github.com/WayneWangPoly/ecoflow-vnext/issues/338#issuecomment-5582759072).

The existing Owner/Admin bounded carrier gains one independent P2 section. It
accepts the explicit BPB8 P1 batch ID, expected revision, frozen SUBMIT command
ID and note. Before any write, it calls the incumbent authenticated current-batch
read and fails closed unless the returned batch ID matches exactly, status is
`DRAFT`, revision is `1`, and `canSubmit=true`. Only then does it call the
existing `submitProductIdentityBatch`, which maps to
`ecoflow_submit_product_identity_batch` with the four operator-supplied values.
The server's revision, replay and Owner/Admin checks remain authoritative.

The acknowledgement must contain the same batch ID, `SUBMITTED`, revision `2`,
and `APPLIED` or `REPLAYED`; every other result is surfaced as a stop condition.
The carrier contains no command-ID generator, generic-submit fallback, publish
call, reserved PUBLISH command ID, raw DML, service-role path, inventory, SOH or
location-quantity authority. The existing generic Product Identity submit flow
is unchanged.

The P2 implementation task did not merge or execute production SUBMIT. P2 later
completed under its separate production authorization. No migration was
required; trusted production-schema shadow was N/A.

## P1 bounded Owner/Admin execution carrier (completed)

This follow-up is based on production `main`
`be57699fe554fa73c0da1a2aa0ebf3c2e6cf63d6` and durable checkpoint
[#338 comment 5581533864](https://github.com/WayneWangPoly/ecoflow-vnext/issues/338#issuecomment-5581533864).
It adds one independent Owner/Admin UI action that uses the existing authenticated
Supabase client and incumbent server authority. It does not change the generic
`Start commissioning` behavior.

The carrier accepts an operator-supplied batch name, exactly one explicit
Commercial SKU UUID and an operator-supplied START command ID. It calls only
`ecoflow_start_bounded_product_identity_batch`, displays the returned batch ID,
status, revision, command status and scoped count, and unlocks reconciliation
only for a one-SKU DRAFT acknowledged as `APPLIED` or `REPLAYED`.

Reconciliation accepts the frozen BPB8 payload and calls only
`ecoflow_reconcile_barcode_survey_observation_v1` through the same authenticated
client. The actual bounded START response supplies `batch_id`. Blank brand and
supplier fields map to the incumbent nullable arguments. There is no queue read,
command-ID generation, generic START fallback, raw DML, service-role substitution,
submit, publish, inventory, SOH or location-quantity call in this carrier.

The UI role gate hides the action from non-Owner/Admin sessions. Authentication,
role authorization, eligibility, replay and Product Identity writes remain
enforced by the incumbent RPCs; an absent or invalid session fails at that server
boundary. The carrier stops after RECONCILE creates DRAFT state.

No migration was required. Trusted production-schema shadow: N/A. P1 later
completed through DRAFT under its separate production authorization and did not
consume the reserved SUBMIT/PUBLISH command IDs.

## Objective and baseline

Prepare one explicit Product Identity canary after Identity Unlock Batch 1B,
without inferring physical identity from Commercial promotion.
Baseline: `fdb29a9d5295e069d865b7fe62ccb793c8884a0e`, PR #386,
[#338 checkpoint 5578030418](https://github.com/WayneWangPoly/ecoflow-vnext/issues/338#issuecomment-5578030418).
Evidence branch: `agent/product-identity/338-physical-canary`.
Carrier branch: `agent/product-identity/338-bounded-execution-carrier`.

## Owner, scope and boundaries

- Implementation: Domain contract/evidence audit; independent Verification required.
- Chief Engineer review and explicit production authorization remain pending.
- In scope: the evidence package, existing synthetic PostgreSQL contract and the
  authenticated bounded START/RECONCILE UI carrier described above.
- No migration, RPC, schema, workflow or incumbent authority change.
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
- [x] Required BPB8 DRAFT payload, preferred link and substitution policy explicitly frozen.
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
