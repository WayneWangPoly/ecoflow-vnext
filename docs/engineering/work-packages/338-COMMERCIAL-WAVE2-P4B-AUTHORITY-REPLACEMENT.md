# ECOFLOW-R3-P4B — Commercial Wave 2 authority replacement

## Purpose

P4A production readiness passed with all 163 frozen EXPANSION candidates eligible and disabled, while proving the incumbent `ecoflow_unlock_commercial_wave2_expansion(...)` service-role authority is stale. Its CANARY gate expects a test-only `MATCHED / ORDERMENTUM_PRODUCT_CODE_EXACT / COMMERCIAL_SKU` mutation that real P2B/P3 production never performs.

P4B replaces that authority without authorizing production expansion.

## Canonical base

- protected main: `e2c00ce40948b36a3cf58f2eaed91e29001fb3d3`
- P4A authenticated production result: `PASS / 163_ELIGIBLE / READY_FOR_P4B_ENGINEERING / PRODUCTION_EXPANSION_NOT_AUTHORIZED`
- frozen cohort SHA: `79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a`
- CANARY: `140010`
- CANARY source mapping: `3001d0f1-6c1b-4b15-98a0-91443ca6b525`, `UNMATCHED`, rev `0`
- CANARY Commercial SKU: `4710bb98-2706-42e5-866b-8788e36e1acc`
- CANARY active ORDERMENTUM mapping: `1995b15c-7ee7-466b-ba3e-daba596d71a3`

## P4B authority shape

The P4B migration performs two security changes only:

1. revoke the legacy service-role authority from `ecoflow_unlock_commercial_wave2_expansion(...)`;
2. create `ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)` as the replacement implementation.

The v2 replacement:

- derives the actor from `auth.uid()`;
- requires an ACTIVE OWNER/ADMIN profile and cross-checks `ecoflow_active_app_role()`;
- has no `p_requested_by` argument and therefore cannot spoof another actor;
- reuses the authenticated P4A PASS contract;
- freezes the real P2B/P3 CANARY state (`UNMATCHED` source mapping plus promoted Commercial SKU and active ORDERMENTUM mapping);
- takes an expansion advisory lock and row-locks the 163 candidate/source-mapping rows;
- recomputes all 163 source/listing/no-collision eligibility conditions immediately before enablement;
- uses the existing unlock command ledger for exact-command replay control;
- mutates only EXPANSION candidate enablement plus the phase-unlock, command and security-audit ledgers;
- creates no Commercial SKU, external product mapping, Physical/package/barcode authority, inventory/SOH/location quantity, image action or provider traffic.

## Dormant-by-default boundary

P4B engineering deliberately does **not** grant the v2 replacement to any application role.

After this migration:

- legacy function: no EXECUTE for `public`, `anon`, `authenticated` or `service_role`;
- v2 replacement: no EXECUTE for `public`, `anon`, `authenticated` or `service_role`;
- production expansion remains NOT AUTHORIZED;
- no P4B execution UI/caller is added;
- no candidate is enabled by the migration itself.

The replacement mutation logic is exercised only in isolated PostgreSQL contract tests, where a temporary transactional grant simulates a future activation and is rolled back.

## Next gate

A later, separately reviewed and separately authorized **P4C activation** must:

- revalidate P4A/P4B production authority state;
- intentionally grant the v2 replacement to `authenticated` (not `service_role`);
- add a bounded OWNER/ADMIN execution carrier;
- execute exactly one frozen expansion-unlock command only after explicit production authorization;
- verify exactly 163 EXPANSION candidates become enabled and no promotion/provider/Physical/inventory side effect occurs;
- STOP before any non-CANARY promotion unless separately authorized.

## STOP

This P4B engineering package must not merge or deploy without a separate merge/deploy authorization. Even if later merged, it only revokes the stale path and installs a dormant replacement. It does not authorize or execute production expansion.
