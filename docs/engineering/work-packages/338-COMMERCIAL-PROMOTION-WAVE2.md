# #338 Commercial Promotion Wave 2 engineering carrier

Status: ENGINEERING REVIEW. Production unlock and promotion remain HOLD.

## Frozen input

A SELECT-only production census on 2026-09-10 reproduced the issue checkpoint exactly:

- 164 current-visible, normalized exact Ordermentum SKU-code matches;
- 164 distinct normalized codes and exactly one visible listing row per code;
- each Unleashed mapping is PRODUCT / UNMATCHED with source_duplicate_count 1;
- each row is bound to its exact mapping UUID, revision, source external key and source payload SHA-256;
- sorted cohort SHA-256: `79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a`;
- hash line format: `code|mapping_id|revision|source_payload_sha256|source_external_key`, joined with LF in normalized-code order;
- `BCB-F-L` is included through `upper(btrim(...))` normalization;
- conflict `CCSB6-80`, history-only `CCSKBM16-90`, and the 119 Unleashed-only rows are excluded.

The complete 164-row evidence is stored in the migration, not reconstructed at command time.

## Separate phase authority

Wave 2 does not insert into, update, replace or call the historical Batch 1 allowlist, phase unlocks or RPCs. It has new candidate, unlock, command and promotion provenance tables plus three service-role-only commands.

All 164 candidates are installed with `enabled=false`. Deployment cannot promote a SKU and does not even enable the canary.

A separately authorized canary-unlock command must revalidate all 164 frozen rows against current mapping revision, exact source hash/key, active product payload, one current-visible Ordermentum listing and absence of any existing SKU or Ordermentum mapping. The deterministic engineering canary is the normalized lowest code, `140010`; only that one row becomes enabled.

The promotion command is still Owner/Admin-attributed and payload-replay bound. It creates only:

- one Commercial `skus` row with `setup_status='mapping_draft'`;
- explicit `unconfigured` storage, pick and external mapping unit levels;
- one active exact Ordermentum external mapping with incumbent `BOUNDED_COMMERCIAL_PROMOTION` confidence;
- command, promotion and security-audit provenance.

It creates no `sku_units`, Physical SKU/family/package/barcode, supplier/brand, location, inventory, SOH, opening balance, substitution or cutover authority.

The expansion-unlock command remains blocked until the canary was promoted and a fresh governed PLAN has changed its Unleashed mapping to exactly one `ORDERMENTUM_PRODUCT_CODE_EXACT / MATCHED / COMMERCIAL_SKU` candidate bound to the promoted Commercial SKU. It then revalidates all 163 still-disabled frozen rows before enabling them.

## Failure and replay fences

- wrong actor, set hash, mapping UUID, revision, source hash, source key, listing cardinality or source liveness fails closed;
- any new SKU/external mapping conflict fails closed;
- `CCSB6-80` and `CCSKBM16-90` are independently rejected even if a caller supplies another mapping UUID;
- command IDs are advisory-locked and payload-hashed; identical replay returns the recorded result and changed replay fails;
- direct table privileges are revoked from public, anon, authenticated and service_role;
- every SECURITY DEFINER RPC has an empty search path, revokes PUBLIC/anon/authenticated execution and grants only service_role execution;
- all five public authority tables have RLS enabled.

## Verification

The dedicated PostgreSQL 17 contract rebuilds the complete 164-row fixture, verifies the frozen hash and disabled deployment state, denies a Viewer, denies premature expansion, unlocks/promotes the canary, simulates the exact fresh PLAN proof, blocks one-row expansion drift, unlocks exactly 163 rows, and promotes normalized ` BCB-F-L ` without creating package/physical/inventory surfaces. It also checks grants, RLS, replay behavior, audit evidence and repeat migration application.

## STOP boundary

Keep the PR Draft / OPEN / UNMERGED. Do not deploy this migration, unlock either phase, promote any Wave 2 SKU, or perform a production PLAN without a new explicit authorization. No #339 inventory/SOH/opening-balance or cutover authority is included.
