# ECOFLOW-R3-P3A-R2 — authenticated evidence read authority

## Objective

Add the smallest auditable database authority that lets a fresh caller-authenticated ACTIVE OWNER/ADMIN read the frozen P3 evidence for the already-promoted Commercial SKU `140010`. The carrier is verification-only: it cannot replay P2B, mutate any ledger or identity, contact Ordermentum, unlock P4, switch callers, retire the legacy path, or cut over.

## Canonical baseline and scope

- Protected starting `main`: `f57870c93b75acd041804ef17fd076d66d51341c`
- P2B command: `7900f15b-bdae-444f-b22c-04000730e260`
- Commercial SKU: `140010` / `4710bb98-2706-42e5-866b-8788e36e1acc`
- Active Ordermentum mapping: `1995b15c-7ee7-466b-ba3e-daba596d71a3`
- Source mapping: `3001d0f1-6c1b-4b15-98a0-91443ca6b525`, revision `0`
- Source payload SHA-256: `016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8`
- Candidate-set SHA-256: `79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a`
- PR #401 remains open, unmerged, and must not be deployed as written.

This package contains one forward migration, a direct authenticated RPC consumer, the minimal Product Identity UI mount, and static/PostgreSQL contracts. It makes no production business data change. Merge, deployment, and production P3 execution remain separate gates.

## Authority contract

`public.ecoflow_read_commercial_wave2_p3_verification()` is a no-argument, `STABLE`, `SECURITY DEFINER` function with `search_path=''` and fully qualified relations. It derives the caller exclusively from `auth.uid()`, requires an active `app_user_profiles` row with `team_status='ACTIVE'`, restricts the role to `OWNER` or `ADMIN`, and cross-checks the canonical `public.ecoflow_active_app_role()` predicate.

The body contains only fixed-scope SELECT statements. It has no DML, dynamic SQL, provider/network operation, repair, reconcile, replay, promotion, unlock, or P4 path. It returns only the frozen identity/mapping/provenance/ledger/audit fields plus bounded aggregate sentinels. It accepts no table name, filter, identifier, role, or scope input.

Function EXECUTE is revoked from `PUBLIC`, `anon`, and `service_role`, then granted only to `authenticated`. Direct privileges remain revoked from `PUBLIC`, `anon`, and `authenticated` on:

- `ecoflow_commercial_wave2_candidates`
- `ecoflow_commercial_wave2_promotions`
- `ecoflow_commercial_wave2_promotion_commands`

No RLS policy or table SELECT grant is added. Existing Wave-2 write functions, grants, exactly-once semantics, and audit generation are unchanged.

## Corrected provider sentinel

P3A emits zero provider traffic. Provider operational tables are not required to have absolute zero delta. The RPC recognizes either no activity or only the durably attributed incumbent scheduled legacy sync:

- workflow `ordermentum-cloud-sync.yml`, run `34767646363`;
- operational run `0bc9be6e-bc67-4e20-8e5c-c843451eb326`;
- `legacy-bearer`, 8 orders, 8 detail successes, 0 detail failures;
- eight raw API events linked to that operational run and one sync-state row.

Any additional or mismatched provider run/event fails closed as `UNATTRIBUTED_PROVIDER_ACTIVITY`. #359-C/current-API activity, caller switch, legacy retirement, and cutover remain forbidden and are separate strict sentinels.

## Acceptance and tests

| Gate | Proof |
|---|---|
| Static authority | no-argument RPC, fixed empty search path, canonical explicit caller check, no DML/dynamic SQL/network |
| Browser boundary | caller-authenticated `supabase.rpc(...)`; no Edge service-role reader or privileged secret |
| Authorization | OWNER/ADMIN succeeds; anon, inactive, and non-OWNER/ADMIN fail |
| Private ledgers | authenticated direct SELECT remains denied; INSERT/UPDATE/DELETE authority remains absent |
| Frozen evidence | exact singleton SKU, mapping, source provenance, command, promotion, initial `replayed=false`, and ADMIN audit |
| Negative space | 164 candidates / 163 expansion / only `140010` enabled / no P4 / no non-canary promotion |
| Sentinels | Physical/package/barcode/inventory/location/image/#339 unchanged; provider attribution aware; caller/cutover/retirement zero |
| Replay | PostgreSQL 17 clean post-P2B fixture; migration applies twice |
| Regression | incumbent P2B static and database contracts stay green |
| Application | TypeScript and production build pass |
| Trusted | production-schema shadow and fresh Independent Verification bind to the exact head |

## STOP boundary

This work package authorizes engineering, PR, CI, trusted schema shadow, and Independent Verification only. It does not authorize merge, production migration/deployment, authenticated production P3 execution, P2B replay, P4, expansion promotion, #339 changes, #359 shadow/provider action, caller switch, legacy retirement, or cutover.
