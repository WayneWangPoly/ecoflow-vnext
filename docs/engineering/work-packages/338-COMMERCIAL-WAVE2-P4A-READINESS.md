# ECOFLOW-R3-P4A — 163-candidate expansion readiness-only carrier

## Objective

Establish a caller-authenticated SELECT-only P4 readiness authority after the authenticated production P3 verdict:

`ECOFLOW-R3-P3 — PASS / CANARY_VERIFIED / HOLD_AT_P4`.

P4A must not enable, promote or otherwise mutate any expansion candidate. It exists to prove the frozen 163-row expansion cohort is still eligible and to identify whether the incumbent P4 mutation authority is safe to reuse.

## Canonical baseline

- protected main: `88490baa22b7e2cede8f8a12fdb42087d4370e56`
- candidate set SHA-256: `79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a`
- CANARY: `140010`
- source mapping: `3001d0f1-6c1b-4b15-98a0-91443ca6b525`, revision `0`
- source payload SHA-256: `016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8`
- Commercial SKU: `4710bb98-2706-42e5-866b-8788e36e1acc`
- active ORDERMENTUM mapping: `1995b15c-7ee7-466b-ba3e-daba596d71a3`

## Production SELECT-only census before engineering

Fresh production reads after P3 PASS showed:

- candidates: `164 total / 1 CANARY / 163 EXPANSION`;
- enabled: `1 CANARY / 0 EXPANSION`;
- expansion eligibility under the bounded Commercial-promotion source/listing/no-collision rules: `163/163`;
- expansion unlock rows: `0`;
- non-CANARY promotions: `0`;
- one frozen cohort hash only, equal to the canonical hash above.

The CANARY source mapping remains `UNMATCHED`, revision `0`, with the frozen source SHA. This is expected: P2B created a new Commercial SKU and an active ORDERMENTUM external mapping but deliberately did not mutate Unleashed source-mapping authority.

## Critical P4 blocker discovered

The incumbent `ecoflow_unlock_commercial_wave2_expansion(...)` requires the CANARY row in `ecoflow_unleashed_master_mappings` to be:

- `MATCHED`;
- `ORDERMENTUM_PRODUCT_CODE_EXACT`;
- canonical object type `COMMERCIAL_SKU`;
- linked to the promoted Commercial SKU;
- candidate count `1`.

The original isolated Wave-2 database test manually performs that source-mapping mutation after CANARY promotion before testing expansion unlock. Production P2B never performs that mutation, by design.

Therefore the incumbent P4 unlock is stale relative to the actual P2B/P3 completion contract and MUST NOT be invoked as the production expansion authority.

## P4A engineering shape

P4A adds only:

1. no-argument caller-authenticated `STABLE SECURITY DEFINER` RPC `ecoflow_read_commercial_wave2_p4_readiness()`;
2. ACTIVE OWNER/ADMIN recheck and no service-role execution grant;
3. mandatory reuse of the P3 v3 PASS authority;
4. exact frozen cohort hash recomputation;
5. 163-row expansion eligibility recomputation using frozen mapping/snapshot/listing/no-collision evidence;
6. explicit detection of the dormant legacy service-role P4 function and whether it is compatible with current CANARY state;
7. native UI button for authenticated P4A readiness only;
8. no production mutation control.

Expected clean disposition:

`ECOFLOW-R3-P4A — PASS / 163_ELIGIBLE / READY_FOR_P4B_ENGINEERING / PRODUCTION_EXPANSION_NOT_AUTHORIZED`

## P4B requirement

Before any production expansion authorization, P4B must replace or revoke the stale legacy expansion unlock. Its new gate must use the actual P3-completed Commercial identity + active ORDERMENTUM external mapping as CANARY proof rather than requiring a test-only mutation of the frozen Unleashed source mapping.

P4B must remain separate from P4A and must receive its own PR, exact-head CI, trusted production-schema shadow, Independent Verification and explicit production authorization.

## STOP boundary

P4A does **not** authorize or perform:

- enabling any of the 163 expansion candidates;
- Commercial SKU promotion for any expansion code;
- calling `ecoflow_unlock_commercial_wave2_expansion(...)`;
- provider requests or #359 current-API traffic;
- caller switch, legacy retirement or cutover;
- Physical SKU/package/barcode authority;
- inventory/SOH/location quantity mutation;
- image planning/copy;
- #339 mutation.
