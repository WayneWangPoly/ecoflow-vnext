# ECOFLOW-R3-P4D — promotion authority replacement + frozen batch plan

## Canonical base

- protected main: `d5ad5178ba41149a12b4c308b0b4aabf1bf2a057`
- P4C: `PASS / 163_ENABLED / CLOSED / HOLD_BEFORE_NON_CANARY_PROMOTION`
- frozen cohort SHA: `79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a`
- P4C command: `430e5bfe-e8b1-44dd-a004-9dfb0bbc46b8`

## Production census before engineering

Fresh SELECT-only census after P4C showed:

- EXPANSION candidates: 163
- enabled: 163
- still eligible for bounded Commercial promotion: 163
- source drift: 0
- missing Ordermentum listing: 0
- existing ORDERMENTUM mapping collision: 0
- existing SKU-code collision: 0
- non-CANARY promotions: 0
- non-CANARY promotion commands: 0

The incumbent `ecoflow_promote_commercial_wave2_sku(...)` still had service-role EXECUTE and accepted a caller-supplied `p_requested_by`. That direct authority must not be used for the 163-row expansion.

## P4D authority shape

P4D performs security hardening and planning only:

1. prove P4C closed exactly once;
2. revoke the completed P4C expansion-unlock mutation from every application role;
3. revoke direct legacy promotion execution from service_role/browser roles;
4. install `ecoflow_promote_commercial_wave2_expansion_sku_v2(...)` which derives the actor from `auth.uid()` and requires ACTIVE OWNER/ADMIN plus `ecoflow_active_app_role()` agreement;
5. keep the new promotion replacement dormant — no EXECUTE grant to authenticated, service_role, anon or public;
6. expose authenticated SELECT-only P4D readiness.

The v2 function is deliberately a thin security wrapper over the previously verified bounded promotion implementation. The incumbent mutation remains internally callable by the function owner but is no longer directly callable by service-role or browser roles.

## Frozen promotion plan

P4D sorts the exact 163 EXPANSION candidates by normalized external code using `COLLATE "C"`, then assigns deterministic 25-row windows.

Promotion plan SHA-256:

`43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888`

Seven windows are expected: six windows of 25 and a final window of 13. Each window hash covers:

`external_product_code|unleashed_mapping_id|expected_mapping_revision|expected_source_payload_sha256`

The P4D production readiness read must recompute the same plan from candidates that are still enabled, source-stable, uniquely listed on Ordermentum and collision-free.

## Business mutation boundary

P4D does **not** create any Commercial SKU or external mapping. It does not write a promotion row, issue provider traffic, create Physical/package/barcode authority, change inventory/SOH/location quantity, or touch images/#339.

A later **P4E** must be separately engineered and authorized to:

- activate the caller-authenticated v2 promotion function;
- bind execution to the frozen seven-batch plan;
- execute bounded batches with exactly-once commands and post-batch verification;
- stop immediately on source/listing/collision drift;
- never use service-role as the business actor.

## STOP

P4D engineering stops at merge gate. Even if later merged/deployed, production non-CANARY promotion remains **NOT AUTHORIZED**.
