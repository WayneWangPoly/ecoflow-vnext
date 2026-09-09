# Work package: #341 Ordermentum SKU normalization hardening

Status: ENGINEERING IN PROGRESS. Production data mutation remains forbidden.

## Objective

Make the current Ordermentum release gate, barcode read lookup and internal
order line mapping use the same canonical SKU comparison as the incumbent
Commercial promotion authority: `upper(btrim(code))`. Preserve every raw source
code unchanged and fail closed if that normalization becomes ambiguous.

Baseline: protected `main`
`f780170182872077a67a986f5cea21f58cb39c0e`; frozen correctness and impact
checkpoint:
[#341 comment 5605080850](https://github.com/WayneWangPoly/ecoflow-vnext/issues/341#issuecomment-5605080850).

## Owner and reviewers

- Implementation: Platform/Data.
- Verification: independent reviewer required.
- Chief Engineer: exact-head migration, contract and release-order review.
- Dependency: none on #393; this branch starts directly from the protected
  baseline.
- Planned merge order: canonical comparator and collision evidence view,
  read-model replacements, internalisation lookup replacement, database/static
  contracts, workflow, documentation.

## In scope

- One forward-only migration; no deployed migration is edited.
- A canonical comparator defined exactly as `upper(btrim(...))`, with blank
  values remaining non-identities.
- Normalized collision detection across active Ordermentum product mappings,
  barcode confirmations and raw Ordermentum order-line codes.
- Release-gate mapping and barcode lookups that treat a collided normalized code
  as unresolved.
- Barcode workbench and internalisation line lookups using the same comparator
  and collision fence.
- Regression coverage for leading spaces, case drift, unchanged exact codes,
  mapping/barcode/raw-code collisions and canonical mapping uniqueness.

## Out of scope

- No Ordermentum raw row rewrite, trim, uppercase update or evidence deletion.
- No fuzzy matching, alias inference or similarity matching.
- No Commercial Promotion Wave 2, allowlist change or Product Identity change.
- No inventory, stock, location, opening-balance or cutover authority.
- No production data command or migration deployment in this package.

## Behaviour contract

For a non-blank Ordermentum code, canonical identity is
`upper(btrim(code))`. A line resolves only when its canonical code has exactly
one active external product mapping to exactly one internal Commercial SKU, no
normalized collision exists in the reviewed mapping/barcode/raw-line
namespaces, and barcode state (where used) likewise comes from one unambiguous
confirmation row. Exact raw codes continue to behave identically.

Leading-space and case-only drift may resolve to the unique canonical identity.
Any future normalized collision removes the code from valid mapping/barcode
lookups, keeps the release gate blocked, and prevents a non-null internal SKU
from being staged. The collision remains visible through a read-only evidence
view. No source row is modified.

## Acceptance criteria and tests

- [ ] ` BCB-F-S` resolves uniquely to `BCB-F-S`.
- [ ] ` BCB-F-XS` resolves uniquely to `BCB-F-XS`.
- [ ] ` BCB-F-L` can resolve to canonical `BCB-F-L` without a raw rewrite.
- [ ] Case drift such as `TWS64Roll` resolves to `TWS64ROLL`.
- [ ] An unchanged exact code retains identical gate and internalisation output.
- [ ] Normalized collisions in mapping, barcode or raw-line evidence fail closed.
- [ ] Active canonical mapping uniqueness is enforced by the lookup contract.
- [ ] Database contract, static audit, TypeScript/build and exact-head CI pass.

## Migration, release and rollback

The migration is forward-only and changes read semantics plus the existing
internalisation function definition; it adds no data DML. Shadow verification
must apply it against a production-shaped schema before merge. Rollback is a
new compensating migration restoring the preceding view/function definitions;
never edit the deployed migration. No production deployment is authorized by
this work package.

## Risks and deferred work

- The production impact counts are a frozen SELECT-only baseline and must be
  recomputed after deployment; they are not hard-coded into runtime logic.
- Wave-2 promotion and the downstream barcode/Physical Identity campaign remain
  separately gated.
