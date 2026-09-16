# ECOFLOW-340B-2-R2P — Customer/Site authenticated production promotion carrier

## Protected engineering base

`5e855849c1f84a4a8a68945a07ad719e2eac19b8`

This package follows the merged R2 Customer/Site authority and the merged R2G mirror-trigger containment fix.

## Purpose

Provide the missing caller-authenticated operator surface for the already-reviewed Customer/Site Wave-1 RPCs. The database authority intentionally derives the actor from `auth.uid()` and denies `service_role`, so production execution must come from an authenticated ACTIVE OWNER/ADMIN session rather than direct database DML or a privileged automation identity.

This package adds no database authority and performs no production execution.

## Fresh production SELECT-only calibration

Immediately before this carrier was authored, current production source evidence reproduced the frozen R1/R2 cohort exactly.

Customer:

- evidence rows: `90`;
- AUTO: `82`;
- duplicate purchaser HOLD: `8`;
- evidence membership 90: `645d02193e4e2f240406971e0f41a5be8f1b14ffc3f28621fdc9c564ab95adbe`;
- AUTO membership 82: `604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3`;
- evidence source 90: `9f19583c405d9d8f31574067ce0aa6eaa13f6e0ef8ac71bd184322324778ee65`;
- AUTO source 82: `f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7`;
- duplicate HOLD 8: `e437b043fb858099de1651241ec89f70e8c53a552123832ae41e590122e25b3b`.

Site:

- scoped: `76`;
- exact-location: `75`;
- AUTO: `71`;
- duplicate-parent HOLD: `4`;
- location HOLD: `1`;
- scoped membership 76: `4e964f0441778f52aded3cdfe671733f16feb191d8c8d44a8d9e2d647fe84fd2`;
- AUTO membership 71: `5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af`;
- exact source 75: `67f16299aea8327632fdeac30bb531563dc5776d0e805e7facbac75bac1bd459`;
- AUTO source 71: `a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a`;
- duplicate-parent HOLD 4: `a34c230a7c4659494e2300ba0b34bbcf9bb3960a9c63b85cf0241321b4f839cc`;
- frozen location HOLD remains `CUST-00000296` / `4b2b3942-0f08-4abe-87da-4f4b81afc835`.

All pre-write fences were zero: Customer source non-pristine, CustomerCode collision, ORDERMENTUM external-ID collision, invalid Customer source, Site source non-pristine, invalid Site source and deterministic SiteCode collision. The frozen location HOLD matched exactly once.

Production still had no migration `20260915235756`, no Customer promotion RPC and no Site promotion RPC at calibration time.

## Migration identity

Reviewed source authority and formal migration remain byte-identical at Git blob:

`c3ad07c161a4803afe70c335139e0e270861a12b`

Formal migration:

`supabase/migrations/20260915235756_customer_site_wave1_promotion_authority.sql`

## Frozen production commands

Customer Wave-1:

- command ID: `bf66f8a0-2475-45be-ac05-0a2f923f4bc5`;
- expected membership: `604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3`;
- expected source evidence: `f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7`;
- reason: `ECOFLOW-340B-2-R2P CUSTOMER_WAVE1 governed production promotion`;
- exact footprint: 82 promoted / 8 held.

Site Wave-1:

- command ID: `36c9868b-3644-4469-a259-2e39faf6365e`;
- expected membership: `5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af`;
- expected source evidence: `a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a`;
- reason: `ECOFLOW-340B-2-R2P SITE_WAVE1 governed production promotion`;
- exact footprint: 71 promoted / 4 duplicate-parent HOLD / 1 location HOLD.

The command IDs, hashes and reasons are code constants. The operator cannot nominate rows, canonical IDs or alternate source evidence.

## Operator carrier

The Settings workspace mounts the carrier only for authenticated `owner` or `admin` roles. It never calls either RPC on mount.

Each mutation requires a separate `window.confirm` describing the exact production footprint and excluded authorities. The Site button remains locked until the frozen Customer command returns a machine acknowledgement that passes exact result assertions in the current browser session. Replaying the frozen command uses the database exactly-once ledger and the original authenticated actor binding.

The repository calls only:

- `ecoflow_promote_customer_wave1_v1`;
- `ecoflow_promote_site_wave1_v1`.

It performs no direct table DML, provider fetch, inventory mutation or service-role call.

## Required production sequence — not authorized by this package

1. Fresh protected-main race check.
2. Separately authorized `Deploy Supabase migrations` `workflow_dispatch` with exact current main SHA and `DEPLOY_SUPABASE_PRODUCTION` confirmation.
3. Verify migration history, RPC ownership/grants and deployment postflight. The governed post-deploy Complete Mirror `verify_only` workflow is expected to run only because the upstream event is a real production `workflow_dispatch`; its operational health snapshot write must be included in the deployment authorization ledger.
4. Fresh SELECT-only cohort/fence calibration.
5. Separately authorized Customer command `bf66f8a0-2475-45be-ac05-0a2f923f4bc5` from an ACTIVE OWNER/ADMIN application session.
6. Customer postflight: exact command ledger, 82 Customer rows, 82 ORDERMENTUM mappings, 82 source mapping transitions and 8 HOLD preservation.
7. Only after Customer postflight passes, separately authorize/confirm Site command `36c9868b-3644-4469-a259-2e39faf6365e`.
8. Site postflight: exact command ledger, 71 addresses, 71 customer_sites, 71 source mapping transitions, 4 duplicate-parent HOLD and 1 location HOLD preservation.
9. STOP before any unrelated Customer enrichment, provider traffic, inventory/#339 or Product Identity/#338 mutation.

## Authorization boundary for R2P engineering

Authorized now:

- branch / PR engineering;
- automatic CI;
- exact-head verification;
- Independent Verification;
- durable checkpointing.

Not authorized now:

- merge;
- `workflow_dispatch`;
- Supabase or Vercel production deployment;
- Customer promotion;
- Site promotion;
- provider traffic;
- #338/#339 mutation;
- any production business-data mutation.

## STOP

Stop at the separate R2P carrier merge gate after exact-head CI and Independent Verification.
