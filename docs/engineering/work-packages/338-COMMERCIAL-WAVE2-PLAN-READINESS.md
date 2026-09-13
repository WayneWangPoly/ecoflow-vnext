# #338 Commercial Promotion Wave 2 PLAN readiness carrier

Status: ENGINEERING ONLY. Production PLAN remains a separate authorization.

## Objective

Expose an authenticated SELECT-only P0 and one command-bound P1 that reuses the incumbent master-mapping planner without invoking image planning. Keep P2–P4 visibly separate and locked.

## Owner and reviewers

- Implementation: Platform/Data + Frontend
- Verification: independent Verification agent
- Chief Engineer: required for migration, Edge Function and Product Identity route integration
- Dependency: merged/deployed PR #396 and protected main `101617435b787d4ac5f4b636e0dc8f9284ff473c`
- Merge order: migration/RPC → Edge Function → typed repository/contract → React carrier

## In scope

- Forward migration adding a closed P1 command ledger plus P0/P1 server RPCs.
- Two authenticated Edge Function modes: `WAVE2_PLAN_PREFLIGHT` and `WAVE2_PLAN`.
- Native React carrier with separately rendered P0, P1, P2, P3 and P4 stages.
- Exact frozen command/evidence contract and PostgreSQL 17 tests.

## Out of scope

- Executing production PLAN.
- Unlocking canary/expansion or promoting any Commercial SKU.
- Product Identity, Physical SKU, package, barcode, image, inventory, SOH, location or cutover mutation.
- Provider traffic and image CDN access.

## Frozen P1 input

- protected main: `101617435b787d4ac5f4b636e0dc8f9284ff473c`
- candidate count / distinct normalized codes: `164 / 164`
- cohort SHA-256: `79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a`
- component SHA-256 values: code `d57e9fe728b7d2b272a6fd33e89e6f0e5d9dc7a5d32e525c95535912a9fe32ad`; mapping UUID `3edf75311bbab34995b7beb2fba38b9715aef142f0481fa1dfe4a621b5b510d1`; revision `b3397bd903a2a9569a90c2e6217af87764641b99e4af6c1a5baf7ef630bc3131`; source payload `c852383af29ebd2dfe5713a487963ff1470a18c88646c3f448fbcac97b6aebd5`; source key `40410822604cab1b49b8d5597a387c414b974adadc30b21f4b68ac75cbcb81f6`
- canary: `140010`
- canary mapping: `3001d0f1-6c1b-4b15-98a0-91443ca6b525`, revision `0`
- canary source payload SHA-256: `016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8`
- canary source key: `guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b`
- PLAN command ID: `18dc00fd-ffe5-4d96-9e91-830d2686ff8e`

Fresh production SELECT-only evidence at `2026-09-12T23:32:59.440565+00:00` found 164/164 eligible rows, zero evidence mismatches, zero enabled candidates, zero PLAN/unlock/promotion commands and the exact recomputed cohort hash. The other 121 PRODUCT/UNMATCHED mappings remain outside the frozen cohort. `CCSB6-80` is an explicit conflict/HOLD exclusion and `CCSKBM16-90` has zero current-visible Ordermentum listings; neither appears in the cohort.

## Behaviour contract

P0 authenticates the caller, requires active OWNER/ADMIN authority and performs only SELECTs through a server-only RPC. It recomputes the bytewise cohort hash over code, mapping UUID, mapping revision, source payload hash and source key. It requires 164 eligible disabled rows, one `140010` canary, 163 expansion rows, no HOLD codes and no existing Wave-2 command, unlock or promotion.

P1 requires the same frozen evidence and exact command ID. The server stores a payload hash and returns the stored result for the same command/payload; changed payload conflicts. It calls the incumbent `ecoflow_plan_unleashed_master_mappings` authority inside the same transaction, then revalidates all 164 rows before committing its command/audit record. It never calls the Edge Function's asset planner.

Expected post-P1 state is one PLAN command and audit record, with all 164 candidates still disabled, zero phase unlocks, zero promotions, and no Product Identity/Physical/package/barcode/image/quantity authority.

P2, P3 and P4 are separate locked stage panels. They contain no callable command in this carrier.

## Acceptance evidence

- Frozen count/hash/canary and exact source evidence fail closed on drift.
- Viewer, stale revision, wrong canary and changed replay payload are rejected.
- The incumbent planner is called exactly once across identical retries.
- Batch-1 allowlist state has no effect on Wave-2 gates.
- `CCSB6-80` and `CCSKBM16-90` remain excluded.
- PLAN creates no Commercial SKU or external product mapping and changes no Physical/package/barcode/inventory/SOH/location rows.
- Browser P1 cannot bypass the service-only RPC; P0 cannot write a rejection audit.
- P2/P3/P4 remain separate and disabled.

## Rollback

Before merge, close the PR. After deployment, use a forward compensating migration to revoke the two P0/P1 RPCs and Edge modes. Preserve any command/audit rows; never edit the deployed migration or delete ledger evidence.

## Production fence

This carrier and its merge/deployment do not authorize P1. The next command boundary is the exact frozen P1 PLAN command above, only after a fresh authenticated P0 and separate user authorization.

## Separate image closure track

Fresh existing-database classification at `2026-09-12T23:33:32.625416+00:00` remains unchanged:

- `COPIED = 435`
- `SOURCE_IMAGE_ABSENT = 27`
- `SOURCE_VALIDATION_HOLD = 4`
- `SIZE_AUTHORIZATION_HOLD = 1`

This package does not retry, fetch, transform, waive or alter image authorization. The image stream remains a separate #338 closure track.
