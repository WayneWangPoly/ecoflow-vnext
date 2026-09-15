# ECOFLOW-340B-2-R1 — Customer/Site Wave-1 evidence re-freeze

## Objective

Repair the evidence boundary for the later `ECOFLOW-340B-2` governed Customer/Site migration authority without creating any mutation authority in this package.

This package freezes recoverable membership, explicit HOLD reasons and deterministic hashes in Git. It deliberately contains **no database migration, no RPC, no Customer/Site promotion, no production business-data mutation and no provider traffic**.

Protected base:

`fca385593ee2f3d7ac4ef8ef0ce8751468db51f1`

That base already contains the merged/deployed `ECOFLOW-340B-1` legacy Customer-master browser containment.

## Why R1 is required

The original 2026-09-09 SELECT-only Wave-1 evidence recorded:

- Customer: `51` unique-email + normalized-name exact, plus `38` unique-email + phone exact/name-drift = **89**;
- Customer SHA-256: `7648dedacc853f572da9f851aef3f5fb8ae033d8267264ea3a7c9c5d2013618f`;
- Site: **75** exact parent-scoped suburb+postcode matches;
- Site SHA-256: `4bfd1f5c35295903980c233d671a067778879e838c9f656a9a274f8cc76f35f9`;
- `CUST-00000296` Site HOLD: Unleashed Marden 5070 vs Ordermentum Modbury 5092.

Fresh B-2 preflight after #340B-1 found `51 + 39 = 90` Customer evidence rows. The B-2 task correctly stopped instead of substituting a newly generated 90-row cohort for the frozen 89. Durable drift checkpoint: #340 comment `5683944229`.

The exact old 89-row membership cannot now be reconstructed without guessing:

- 37 of the current 39 phone-confirmed rows can be independently corroborated by pre-freeze Ordermentum order snapshots;
- two (`CUST-00000278`, `CUST-00000355`) have no pre-freeze order snapshot usable for that proof;
- both existed in Ordermentum before the freeze and both have pre-freeze purchaser-detail presence;
- the full old purchaser list payloads are no longer retained;
- `ordermentum_raw_master_resource_versions` is bounded by the 30-day / three-versions-per-resource / 10 MiB global retention contract, and the earlier purchaser versions needed to reconstruct the 2026-09-09 exact membership have been pruned.

Therefore R1 does not invent an answer to which current row was absent from the old 38-phone branch. It creates a new, explicit evidence epoch.

## Fresh SELECT-only census

No mutation was executed to produce this evidence.

### Customer evidence

Current conservative row-level evidence rule remains:

1. Ordermentum email is globally unique for the Unleashed Customer row; and
2. either normalized Customer/store name is exact, or normalized phone is exact while name drifts.

Fresh result:

- unique email + normalized name exact: **51**;
- unique email + phone exact/name drift: **39**;
- evidence-qualified Customer rows: **90**.

A second identity-level guard is now mandatory: one Ordermentum purchaser ID may not authorize more than one Unleashed CustomerCode.

The 90 rows contain only **86 distinct Ordermentum purchaser IDs**. Four purchaser IDs each have two competing Unleashed CustomerCodes. All eight rows are held closed:

| Ordermentum purchaser | Competing CustomerCodes |
|---|---|
| `55db5d12-a24b-4798-8075-718dd3bf7f87` | `CUST-00000535`, `CUST-00000580` |
| `7f073c08-4c21-4211-9e90-62ea1a6e0990` | `CUST-00000458`, `CUST-00000619` |
| `9b35ed96-7420-47b1-9264-72a67dac025d` | `CUST-00000476`, `CUST-00000481` |
| `b2f957b9-deb0-4d9c-94f8-c04bed37bec6` | `CUST-00000611`, `CUST-00000645` |

Resulting Customer boundary:

- evidence-qualified: **90**;
- `HOLD_DUPLICATE_EXTERNAL_ID`: **8**;
- governed AUTO membership for later R2 authority: **82**;
- existing canonical `customer_code` conflicts across the 82: **0**;
- existing active `ORDERMENTUM` external-customer-ID conflicts across the 82: **0**.

### Site evidence

The current 90-row Customer evidence set has 76 parent-scoped, non-obsolete Unleashed delivery-address items. The location evidence remains stable:

- exact suburb: **75/76**;
- exact postcode: **75/76**;
- exact suburb + postcode: **75/76**;
- one location HOLD remains `CUST-00000296`.

Four of the 75 exact Site rows are children of Customer rows held for duplicate purchaser identity:

- `CUST-00000481`;
- `CUST-00000580`;
- `CUST-00000619`;
- `CUST-00000645`.

Resulting Site boundary:

- parent-scoped Site membership: **76**;
- exact-location evidence rows: **75**;
- `HOLD_DUPLICATE_PARENT`: **4**;
- `HOLD_LOCATION_CONFLICT`: **1** (`CUST-00000296`);
- governed AUTO membership for later R2 authority: **71**.

## Recoverable membership manifest

`docs/engineering/evidence/340B-2-R1-customer-site-wave1-refreeze.manifest`

The manifest intentionally stores only the minimum identities required to recover exact cohort membership:

Customer row:

`CustomerCode | Ordermentum purchaser ID | match method | disposition`

Site row:

`parent CustomerCode | Unleashed Address GUID | Ordermentum purchaser ID | disposition`

It contains no customer/store name, email, phone, street, suburb or postcode payload.

Membership hashes use UTF-8 lines joined by `LF` with no trailing `LF`. Customer rows are bytewise sorted by CustomerCode. Site rows are bytewise sorted by parent CustomerCode then Address GUID.

- Customer membership 90: `645d02193e4e2f240406971e0f41a5be8f1b14ffc3f28621fdc9c564ab95adbe`
- Customer AUTO 82: `604c695c505dadf9d93ba251f1ff1edd8d27f8645406c060e4165ca93146e1c3`
- Site scoped membership 76: `4e964f0441778f52aded3cdfe671733f16feb191d8c8d44a8d9e2d647fe84fd2`
- Site AUTO 71: `5972b42f7541dfef576fe464a344d891434e78307325516708171287a418c1af`

## Source-evidence hashes for R2

Membership alone is not execution authority. R2 must reconstruct live server-side source evidence and compare it to the following frozen source-evidence hashes before any row can execute.

### Customer source-evidence recipe

For each evidence-qualified Customer row:

`external_code|mapping_id|mapping_revision|source_payload_sha256|source_external_key|source_external_guid|ordermentum_purchaser_id|ordermentum_retailer_id|ordermentum_purchaser_payload_hash|match_method`

Sort bytewise by `external_code`, join with `LF`, SHA-256.

- evidence 90: `9f19583c405d9d8f31574067ce0aa6eaa13f6e0ef8ac71bd184322324778ee65`
- AUTO 82 subset: `f8c4144d1cb50708ca6c7a0fbf760ceaa9f6ac92ab5f33b9715e9ec6e22cecb7`

The duplicate-HOLD membership evidence is independently frozen as:

`external_code|ordermentum_purchaser_id|match_method`

- HOLD 8: `e437b043fb858099de1651241ec89f70e8c53a552123832ae41e590122e25b3b`

### Site source-evidence recipe

For each exact-location Site row:

`parent_customer_code|delivery_mapping_id|mapping_revision|source_payload_sha256|source_external_key|source_external_guid|address_guid|ordermentum_purchaser_id|ordermentum_purchaser_payload_hash`

Sort bytewise by parent CustomerCode then Address GUID, join with `LF`, SHA-256.

- exact-location evidence 75: `67f16299aea8327632fdeac30bb531563dc5776d0e805e7facbac75bac1bd459`
- AUTO 71 subset: `a30654f80426baadd6b7965497e03fcc459513c811e86e23c1b9aca331c71d1a`

Duplicate-parent exact Site HOLD evidence uses:

`parent_customer_code|address_guid|ordermentum_purchaser_id`

- HOLD 4: `a34c230a7c4659494e2300ba0b34bbcf9bb3960a9c63b85cf0241321b4f839cc`

## R1 acceptance contract

R1 is PASS only if repository evidence proves all of the following:

- exactly 90 Customer evidence rows;
- exactly 82 Customer AUTO rows;
- exactly eight duplicate-external-ID Customer HOLD rows;
- exactly four duplicate purchaser groups, each containing two held rows;
- exactly 76 parent-scoped Site membership rows;
- exactly 71 Site AUTO rows;
- exactly four duplicate-parent Site HOLD rows;
- exactly one location HOLD, `CUST-00000296` with Address GUID `4b2b3942-0f08-4abe-87da-4f4b81afc835`;
- every AUTO Site has an AUTO Customer parent;
- every duplicate-parent Site has a duplicate-external-ID Customer parent;
- all four membership hashes reproduce exactly;
- no customer PII payload is embedded in the membership manifest;
- no migration, function/RPC, grant, policy or production mutation authority is introduced by R1.

## Required R2 authority contract

R1 does **not** authorize or implement R2. A separate reviewed package is required.

R2 must, at minimum:

1. be `SECURITY DEFINER`, postgres-owned, with fixed `search_path=pg_catalog, public`;
2. require an active Owner/Admin app profile;
3. use actor-bound command IDs and payload fingerprints so same command/same payload replays and same command/different payload conflicts;
4. server-derive Customer/Site membership from the R1 frozen manifest; callers cannot nominate arbitrary canonical IDs or expand the cohort;
5. re-read current Unleashed mapping revision/source payload SHA and current Ordermentum purchaser payload hash and fail closed on any evidence drift;
6. verify both the membership hash and the applicable source-evidence hash before execution;
7. reject any purchaser ID appearing more than once in the evidence cohort;
8. create Customer + active `external_customer_mappings(provider='ORDERMENTUM')` atomically, with no overwrite of an existing customer code or external ID;
9. permit Site execution only after the exact parent Customer mapping exists and is ACTIVE;
10. server-derive the Unleashed Address GUID/source payload, require exact frozen parent relation and current location evidence, and atomically create Address + Customer Site;
11. preserve `CUST-00000296` Site HOLD and all duplicate-parent HOLDs;
12. infer no credit, price group, route, inventory, Product Identity, financial or unrelated commercial authority from Customer identity.

## STOP boundary

R1 authorizes evidence engineering only.

- Production Customer/Site mutation: **NOT AUTHORIZED**
- Production business-data mutation: **NOT AUTHORIZED**
- Provider traffic: **NOT AUTHORIZED**
- Inventory/#339 mutation: **NOT AUTHORIZED**
- Merge: **NOT AUTHORIZED IN R1 ENGINEERING TASK**
- R2 authority execution: **NOT AUTHORIZED**
