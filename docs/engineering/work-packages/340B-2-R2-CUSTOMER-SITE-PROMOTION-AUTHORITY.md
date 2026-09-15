# ECOFLOW-340B-2-R2 — governed Customer/Site Wave-1 promotion authority

## Objective

Implement the narrow database authority required to promote only the frozen R1 AUTO Customer/Site cohorts, while keeping production execution, merge and deployment separately gated.

R2 is stacked on the exact R1 engineering head:

`6ee63c595a92ecd9e9e13c81f104121243107932`

R1 PR: `#418 — ECOFLOW-340B-2-R1: re-freeze Customer/Site Wave-1 evidence`.

R1 remains a prerequisite. R2 must not be merged or materialized into production migration history until R1 has independent verification and the required merge gate.

## Authorization boundary

This engineering package does **not** authorize:

- production Customer promotion;
- production Site promotion;
- production business-data mutation;
- applying the SQL carrier to production;
- deployment;
- merge;
- provider traffic;
- inventory/#339 mutation;
- Product Identity/#338 mutation;
- credit, price-group, financial, route or unrelated commercial authority.

## Why the authority is batch-scoped

R1 froze both membership and source-evidence hashes. A per-row authority would mutate the corresponding Unleashed mapping revision after the first successful row and would therefore invalidate the global source-evidence hash required for the next row.

R2 therefore uses two independently authorized, exactly-once atomic batches:

1. Customer Wave-1: exactly **82** AUTO Customers;
2. Site Wave-1: exactly **71** AUTO Sites, only after the exact parent Customers are promoted.

The caller cannot nominate a Customer ID, Site ID, mapping ID, purchaser ID, Address GUID or canonical target.

## R1 evidence consumed

### Customer

- evidence-qualified rows: `90`;
- AUTO: `82`;
- duplicate purchaser HOLD: `8` across four 2-to-1 collisions;
- evidence membership 90: `645d02193e4e2f240406971e0f41a5be8f1b14ffc3f28621fdc9c564ab95adbe`;
- AUTO membership 82: `604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3`;
- evidence source hash 90: `9f19583c405d9d8f31574067ce0aa6eaa13f6e0ef8ac71bd184322324778ee65`;
- AUTO source hash 82: `f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7`;
- duplicate-HOLD hash 8: `e437b043fb858099de1651241ec89f70e8c53a552123832ae41e590122e25b3b`.

### Site

- parent-scoped non-obsolete rows: `76`;
- exact suburb+postcode: `75`;
- AUTO: `71`;
- duplicate-parent HOLD: `4`;
- location HOLD: `1`, `CUST-00000296`, Address GUID `4b2b3942-0f08-4abe-87da-4f4b81afc835`;
- scoped membership 76: `4e964f0441778f52aded3cdfe671733f16feb191d8c8d44a8d9e2d647fe84fd2`;
- AUTO membership 71: `5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af`;
- exact source hash 75: `67f16299aea8327632fdeac30bb531563dc5776d0e805e7facbac75bac1bd459`;
- AUTO source hash 71: `a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a`;
- duplicate-parent HOLD hash 4: `a34c230a7c4659494e2300ba0b34bbcf9bb3960a9c63b85cf0241321b4f839cc`.

## Fresh production SELECT-only calibration

Before R2 implementation, the intended server-side SQL was executed as SELECT-only against production and reproduced the R1 frozen values exactly.

Customer recomputation reproduced:

- `90` evidence rows;
- `82` AUTO rows;
- evidence membership 90 hash;
- AUTO membership 82 hash;
- evidence source 90 hash;
- AUTO source 82 hash.

Site recomputation reproduced:

- `76` scoped rows;
- `75` exact-location rows;
- `71` AUTO rows;
- `4` duplicate-parent HOLD rows;
- `1` location HOLD;
- scoped membership 76 hash;
- AUTO membership 71 hash;
- exact source 75 hash;
- AUTO source 71 hash.

All 71 AUTO Site source payloads currently have nonblank `StreetAddress`, `Suburb`, `Region` and `PostalCode`.

No production mutation was performed during calibration.

## SQL carrier

`scripts/customer-site-wave1-promotion-authority.sql`

This is a migration-ready engineering carrier, not a production migration execution.

The current Chat environment does not provide the Supabase CLI. Project engineering policy requires formal migration files to be created using `supabase migration new`; therefore R2 deliberately does not invent a timestamped migration filename. A later materialization gate must create the formal migration with the CLI and copy the reviewed SQL carrier unchanged before exact-head verification is repeated.

## Security model

The two mutation RPCs are:

- `ecoflow_promote_customer_wave1_v1(uuid,text,text,text)`;
- `ecoflow_promote_site_wave1_v1(uuid,text,text,text)`.

Both:

- are postgres-owned `SECURITY DEFINER` functions;
- have fixed `search_path = pg_catalog, public`;
- derive the actor from `auth.uid()`;
- require an ACTIVE `app_user_profiles` row with `team_status='ACTIVE'` and role `OWNER` or `ADMIN`;
- cross-check `ecoflow_active_app_role()`;
- accept no actor UUID and no caller-selected canonical identity;
- revoke default execute from `PUBLIC`, `anon`, `authenticated`, and `service_role`, then grant execute only to `authenticated`;
- use actor-bound command IDs plus a deterministic request fingerprint;
- replay same command/same actor/same payload;
- reject same command with another actor or payload;
- serialize command IDs and each batch authority with advisory locks;
- freeze one transaction-local evidence snapshot and reuse it for every hash,
  conflict, parent/source and mutation step, so concurrent source inserts cannot
  expand the verified cohort under PostgreSQL `READ COMMITTED`.

Internal live-evidence helper functions are SECURITY INVOKER and have EXECUTE revoked from all API roles.

Command ledger tables have RLS enabled and no browser policy. Browser roles have no direct table privileges.

## Customer batch authority

Before any write, the Customer RPC re-derives the entire live cohort from:

- current Unleashed Customer mapping/snapshot evidence;
- globally unique normalized Ordermentum email;
- exact normalized name or exact normalized phone/name-drift;
- current Ordermentum purchaser payload hashes.

The RPC fails closed unless all counts and all R1 hashes reproduce exactly.

Additional pre-write fences:

- all 82 AUTO source mappings remain pristine `UNMATCHED` rows;
- no canonical `customer_code` collision exists;
- no existing `ORDERMENTUM` external customer ID collision exists;
- CustomerCode and CustomerName are nonblank;
- source Customer is not obsolete.

On success the transaction creates exactly 82:

- `customers` rows;
- active `external_customer_mappings(provider='ORDERMENTUM')` rows;
- corresponding `ecoflow_unleashed_master_mappings` transitions to `MATCHED` with canonical Customer ID/code, Ordermentum purchaser ID, bounded match method, review actor/reason and revision increment.

No email, phone, credit, price group, route, financial, inventory or Product Identity authority is inferred into the canonical Customer record.

## Site batch authority

The Site RPC re-derives the entire current Site evidence set and fails closed unless the R1 76/75/71/4/1 counts and hashes reproduce exactly.

It additionally requires:

- `CUST-00000296` remains the exact location HOLD with its frozen Address GUID;
- every AUTO delivery mapping remains pristine `UNMATCHED`;
- every AUTO parent Customer mapping is already `MATCHED`, points to an active canonical Customer with the frozen CustomerCode, and carries the same Ordermentum purchaser ID;
- StreetAddress/Suburb/Region/Postcode remain nonblank;
- deterministic SiteCode has no canonical conflict.

On success the transaction creates exactly 71:

- `addresses` rows derived from the frozen/current Unleashed Address payload;
- `customer_sites` rows under the exact promoted parent Customer;
- delivery-address mapping transitions to `MATCHED` with canonical Site ID/code and revision increment.

SiteCode is server-derived as:

`<CustomerCode>-SITE-<first 8 uppercase hex characters of Address GUID>`

No contact name or phone is inferred. `delivery_note` is bounded to the Unleashed `DeliveryInstruction` field.

## Verification carrier

Dedicated workflow:

`.github/workflows/customer-site-wave1-promotion-authority-check.yml`

It runs:

- static authority contract;
- PostgreSQL 17 fixture;
- migration-ready SQL carrier;
- DB role/denial/replay/zero-write-failure contract;
- R1 frozen membership/HOLD regression;
- Customer legacy containment static regression;
- Unleashed master bridge and inventory-reference regressions;
- repository hygiene;
- TypeScript;
- production build.

The DB fixture intentionally does **not** fabricate a fake successful 90/82 production cohort. Successful cohort/hash equivalence is grounded by the fresh production SELECT-only calibration above. The fixture verifies authorization, denial, replay conflict and atomic fail-closed behaviour without mutating production.

## Required later materialization gate

Before R2 can be considered merge-ready, a later task must:

1. independently verify R1 and satisfy its merge gate;
2. create the formal migration filename with `supabase migration new`;
3. copy the reviewed R2 SQL carrier without semantic change;
4. re-run exact-head PostgreSQL/CI verification on the materialized migration;
5. independently review the materialized exact head;
6. obtain separate merge/deployment authority.

Production execution remains a still-later, separately authorized command after merge/deployment/postflight.

## STOP

R2 engineering authority implementation is not production execution.

- Merge: **NOT AUTHORIZED**
- Deployment: **NOT AUTHORIZED**
- Production SQL apply: **NOT AUTHORIZED**
- Customer promotion: **NOT AUTHORIZED**
- Site promotion: **NOT AUTHORIZED**
- Provider traffic: **NOT AUTHORIZED**
- Inventory/#339 mutation: **NOT AUTHORIZED**
