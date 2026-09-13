# ECOFLOW-R3-P2B — Wave 2 canary promotion authenticated carrier

## Purpose

Promote exactly one already-unlocked Wave 2 Commercial SKU canary (`140010`) through the incumbent bounded promotion authority, without creating any Physical SKU, family, package, barcode, image, inventory, warehouse or expansion authority.

## Canonical base

- protected `main`: `56931cb04a2ef95d5762d4445556f81b5c1a60d1`
- P2A: `PASS / CANARY_UNLOCK_COMPLETE / HOLD_AT_P2B`
- P2A unlock command: `61b13a7c-18d1-48f0-b317-96d23607ddfb`
- P2B promotion command: `7900f15b-bdae-444f-b22c-04000730e260`
- cohort SHA-256: `79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a`
- canary: `140010`
- mapping: `3001d0f1-6c1b-4b15-98a0-91443ca6b525`, revision `0`
- source payload SHA-256: `016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8`
- source key: `guid:e80b9e1d-f33d-4ebf-b76d-dfdd9beb1a7b`

## Engineering shape

P2B does not reimplement promotion. The new service-role-only wrapper delegates to the incumbent `ecoflow_promote_commercial_wave2_sku(...)` after a frozen SELECT-only preflight proves:

- exactly one completed P1 PLAN;
- exactly one P2A CANARY phase unlock and unlock command;
- the P2A audit is present;
- `140010` is the only enabled candidate;
- no Wave 2 promotion or promotion command exists yet;
- no Commercial SKU or Ordermentum external mapping already exists for `140010`;
- cohort hash, mapping revision, source payload and source key remain exact;
- Physical/inventory/image authority flags remain false.

The wrapper then verifies postconditions in the same transaction: exactly one Wave 2 promotion, exactly one P2B command, exactly one Commercial SKU `140010`, exactly one active Ordermentum mapping for `140010`, and no expansion promotion.

## Authentication boundary

Browser code never receives service-role credentials and cannot execute the P2B RPC directly. A dedicated JWT-protected Edge Function authenticates the Supabase user, requires an ACTIVE OWNER/ADMIN profile, validates all frozen evidence, and then invokes the service-role-only preflight or execution RPC.

## UI boundary

P2B is mounted as an independent carrier next to the already-deployed P2A carrier. The UI requires a fresh authenticated P2B SELECT-only preflight before exposing the separate promotion button. P3 verification and P4 expansion remain visibly locked and have no callable action in this carrier.

## Explicit non-goals

This package does not:

- execute P2B in production merely by merging/deploying;
- unlock or promote any of the 163 expansion candidates;
- create Product Identity or Physical SKU authority;
- create/modify Family, package or barcode authority;
- PLAN/COPY images;
- mutate inventory quantity, stock, warehouse location or movement authority;
- enter #339 or #359;
- switch providers, scheduled callers or source-of-truth cutover.

## Required engineering verification

The exact-head workflow must prove:

1. the branch descends from the exact post-P2A base;
2. static separation/auth contracts pass;
3. PostgreSQL 17 fixture reaches authentic post-P2A state before P2B;
4. P2B preflight is READY only on the exact frozen state;
5. stale source/frozen evidence is rejected;
6. direct browser/authenticated RPC execution is revoked;
7. first execution creates only the Commercial SKU/external mapping/promotion ledger;
8. same-command replay is idempotent and changed-payload replay is rejected;
9. Physical/package/barcode/inventory/image sentinels remain untouched;
10. TypeScript typecheck, production build and whitespace checks pass;
11. incumbent P2A contract remains green.

## Production execution sequence after engineering approval

`merge P2B carrier → production deploy verification → fresh authenticated P2B SELECT-only preflight → exactly-once frozen P2B promotion → SELECT-only postflight → durable #338/#335 checkpoint → STOP at P3`

Do not infer P3/P4 authorization from P2B completion. P3 is verification-only and P4 remains a separate expansion gate/carrier.
