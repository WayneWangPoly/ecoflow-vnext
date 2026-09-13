# ECOFLOW-R3-P3 — Wave 2 canary verification-only carrier

## Objective

Provide one authenticated, repeatable production read boundary that independently verifies the completed P2B canary `140010`, its bounded Commercial SKU, active Ordermentum mapping, source provenance, promotion lineage, audit evidence, negative space, and unchanged side-effect sentinels without any production business mutation.

## Owner and reviewers

- Implementation role: Engineering (frontend + existing Edge carrier pattern)
- Verification role: Independent Verification on the reviewed exact head
- Chief Engineer: required for the new Edge function and final merge/release gate
- Dependencies: P2B durable completion checkpoint `5653034892`
- Planned merge order: contract/test → read repository → UI → deployment → authenticated production read

## Canonical baseline

- protected `main`: `f57870c93b75acd041804ef17fd076d66d51341c`
- P2B command: `7900f15b-bdae-444f-b22c-04000730e260`
- P2B commit time: `2026-09-13T11:35:14.960842Z`
- Commercial SKU: `140010` / `4710bb98-2706-42e5-866b-8788e36e1acc`
- active Ordermentum mapping: `1995b15c-7ee7-466b-ba3e-daba596d71a3`
- source mapping: `3001d0f1-6c1b-4b15-98a0-91443ca6b525`, revision `0`
- source payload SHA-256: `016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8`
- cohort SHA-256: `79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a`

## In scope

- `supabase/functions/commercial-wave2-p3-verification/index.ts`
- `src/data/repositories/commercialWave2CanaryVerification.ts`
- `src/features/productIdentity/commercialWave2CanaryVerificationContract.ts`
- `src/features/productIdentity/CommercialWave2CanaryVerificationCarrier.tsx`
- the bounded mount in `ProductIdentityCommissioningWithSurvey.tsx`
- P3 static/contract workflow and this work package
- authenticated OWNER/ADMIN production reads and durable #338/#335 evidence

## Out of scope

- all schema, migration, RLS, grant, and data changes;
- P2B execution or replay;
- PLAN, unlock, enablement, promotion, edit, repair, reconciliation, or publication;
- Physical SKU, family, package, barcode, inventory, warehouse/location, image, #339, or #359 mutation;
- provider calls, caller/schedule changes, retirement, cutover, and all P4 work.

## Behaviour contract

The browser invokes only `P3_VERIFY_READ_ONLY` with the frozen identifiers. The Edge boundary authenticates the bearer user, requires an ACTIVE OWNER/ADMIN profile, and performs direct SELECT-only reads. It does not invoke a database RPC. The browser receives no service-role secret, and the server client neither assumes the user's database role nor changes RLS/session identity.

The result is `PASS` only when identity and mapping cardinality are exactly one, all frozen lineage and audit fields close, the initial ledger result remains `replayed=false`, the sole enabled candidate remains `140010`, P4/non-canary counts remain zero, and every frozen side-effect/provider/cutover sentinel remains unchanged. Any query error or mismatch returns or renders `HOLD_AT_P3`; the carrier offers no repair path.

## Acceptance criteria

- [ ] Authenticated ACTIVE OWNER/ADMIN can obtain a complete P3 report in a fresh session.
- [ ] SKU `140010` is unique, ID-exact, and remains `setup_status='mapping_draft'`.
- [ ] The active Ordermentum mapping is unique and links to the exact Commercial SKU.
- [ ] Revision, source SHA/key/code, command, promotion, and audit lineage are exact.
- [ ] Command/promotion cardinality is `1 / 1`; original result is `replayed=false`.
- [ ] P4 enabled and non-canary promotion counts are both zero.
- [ ] Physical/package/barcode/inventory/location/image/#339/#359/provider/caller/cutover sentinels remain unchanged.
- [ ] Static tests reject database write/RPC calls, browser secrets, mutation controls, and P4 controls.
- [ ] No migration or production business mutation occurs.

## Test plan

| Layer | Command or scenario | Expected result |
|---|---|---|
| Static | `node --test scripts/commercial-promotion-wave2-p3-verification-contract.test.mjs` | frozen lineage and zero-mutation capability pass |
| Edge | `deno check supabase/functions/commercial-wave2-p3-verification/index.ts` | read carrier type-checks |
| Regression | existing P2B contract | prior boundary stays green |
| Frontend | `npm run typecheck && npm run build` | typed carrier compiles and bundles |
| Production | fresh authenticated P3 read | exact machine report returns PASS |
| Independent | SELECT-only postflight | UI report matches durable state; no sentinel drift |

## Required evidence

- Changed files and exact reviewed head
- P3 workflow, trusted checks, typecheck/build, Independent Verification, and Chief Engineer decision
- Merge commit/signature and Vercel/Supabase deployment health
- Fresh authenticated production report timestamp and actor role
- Exact identity, mapping, provenance, ledger, audit, negative-space, and sentinel results
- Explicit no-business-mutation and P4-locked statements

## Rollback

Revert the verification-only commit and redeploy the prior frontend. Remove the P3 Edge function only through the normal deployment process if required. No database rollback or compensating data action exists because this package changes no schema and writes no business data.

## Decision log

### Decisions

- Reuse the deployed JWT/profile-authentication pattern and direct server-side SELECTs.
- Add no migration, grant, view, or RPC.
- Return a stable machine-readable report and render the same evidence in the existing React feature tree.

### Assumptions

- The frozen P2B checkpoint is authoritative and must not be recreated or replayed.

### Risks

- Any legitimate external drift after P2B causes a conservative HOLD and requires separate authorization to investigate or remediate.

### Deferred

- All P4 design, selection, unlock, enablement, and expansion execution.
