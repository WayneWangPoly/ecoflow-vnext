# ECOFLOW-R3-P4E — sequential authenticated batch promotion

## Canonical base

- protected main: `d7af3b5ea2436366ba90d444988af55816bfc781`
- P4C: `PASS / 163_ENABLED / CLOSED`
- P4D: `PASS / MERGED / PRODUCTION_DEPLOYED / SECURITY_HARDENING_LIVE / 0_PROMOTED / CLOSED / HOLD_AT_P4E`
- frozen candidate-set SHA: `79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a`
- frozen promotion-plan SHA: `43a557ddf36347c8fa303d02dd4c27b8e0aa7f7e4310955a16f70a98f5f33888`

## Objective

P4E replaces ad-hoc per-SKU execution with one caller-authenticated, sequence-gated batch carrier. The carrier must make it impossible for the browser to call the dormant single-SKU mutation directly and must stop between every batch until an independent postflight checkpoint proves the exact footprint.

This engineering package is **not production authorization**. The branch and PR may implement the future production authority, but no merge, deployment or non-CANARY promotion is permitted without a separate explicit gate.

## Frozen windows

| Batch | Count | Range | Batch SHA | Frozen command |
| --- | ---: | --- | --- | --- |
| 1 | 25 | `140280` → `BP-SSD-TT` | `7dc7e7aacb5891caa2905a241c68a57920c98173991d5d410cf27b6a2ccf55e3` | `dbd1f89c-720f-4a44-bd31-59787b0d3bd3` |
| 2 | 25 | `BPB12` → `CCSA6-80` | `82d6667c5a077bd7bcfbefd8e27feb37644b80cd0418b050a1f3d83d2ab955c0` | `5ad4dd0c-0028-4cc2-9eed-1422f0ba2696` |
| 3 | 25 | `CCSKBM6-80` → `EF-DWLQ20` | `59c55ae2e4d40995234f002eabc1f714d3e634babcddc60db5be68cc5cc8584b` | `e04af561-dd00-4a0b-88b7-aa185508130e` |
| 4 | 25 | `EF-RTUS05` → `KNIFE165BULK` | `a03043367fb53ccc81b42e0ea74fe5db9fd6b5ff984ae89f8a56b9303aa05457` | `bdbd7dfb-ef13-442b-84b6-ce3dead08f8b` |
| 5 | 25 | `KOMCOFFEE12-80` → `PCT5` | `f761569972fc8a23fa26cd0fe78516bcf37e648d5a07ace5ebd2d34207ab66d1` | `ed79bf21-245f-43bc-9722-a8a79be568bb` |
| 6 | 25 | `PROLL16W` → `SCCSPW28BAG` | `ff2e9000c096485ed63b18dbf9adfb545e925a0d1ced8458122f68dd0151a15c` | `d326df14-63ba-4bac-b66e-c5c489a8a039` |
| 7 | 13 | `SK1216` → `WRCL` | `ca2ebb59ffbd31e5b8c488ea33b4c39d63ab9194025c3c1bd2157fad87b4f890` | `c3a0f311-4efb-4325-804b-d8eb39ef9291` |

The plan is recomputed from the frozen, enabled EXPANSION candidate ledger, sorted by normalized external product code using `COLLATE "C"`. Promotion itself does not modify that candidate ledger, so the plan remains independently reproducible after each batch.

## Authority model

P4D's single-SKU replacement `ecoflow_promote_commercial_wave2_expansion_sku_v2(...)` remains ungranted to `authenticated`, `service_role`, `anon` and `public`.

P4E adds three caller-authenticated surfaces:

1. `ecoflow_read_commercial_wave2_p4e_batch_gate()` — read-only programme/batch gate;
2. `ecoflow_promote_commercial_wave2_expansion_batch_v1(integer)` — the only browser-accessible business mutation;
3. `ecoflow_verify_commercial_wave2_expansion_batch_v1(integer)` — independent postflight proof and checkpoint.

All derive the actor from `auth.uid()` and require an ACTIVE `OWNER` or `ADMIN` plus `ecoflow_active_app_role()` agreement. `service_role` and `anon` receive no P4E business mutation grant.

## Batch execution contract

For a batch to execute, the transaction must prove all of the following again:

- exact 163-row P4C closure and frozen candidate-set lineage;
- exact seven-window plan and expected current-batch hash;
- all previous batches have committed postflight verification rows;
- no current or future batch has already been promoted;
- no promotion exists outside the frozen plan;
- every current-batch source mapping is still `UNMATCHED`, revision/source-stable and unique;
- every current SKU remains exactly once visible on Ordermentum;
- no existing Commercial SKU or ORDERMENTUM external mapping collides with the current code;
- the dormant single-SKU delegate is still inaccessible to browser/service roles.

The batch is one PostgreSQL transaction. Each member receives a generated item command UUID and is promoted only through the already bounded P4D single-SKU delegate. Any item drift or failed postcondition aborts the whole batch.

The committed batch result contains all item command IDs and resulting Commercial SKU / external mapping IDs. The frozen batch command ID is unique and makes exact replay idempotent.

## Independent postflight gate

A successful batch is **not enough** to open the next batch. `ecoflow_verify_commercial_wave2_expansion_batch_v1(...)` must independently prove:

- exact item count and exact current-batch membership;
- exact individual promotion-command lineage;
- exact Commercial SKU and ORDERMENTUM mapping IDs;
- `mapping_draft` Commercial setup state;
- source mapping revision/status/payload remained unchanged;
- one `COMMERCIAL_WAVE2_SKU_PROMOTED` audit per item;
- the P4E batch-level audit exists;
- cumulative promotion/command counts are exact;
- zero future-batch and zero unplanned promotion exists;
- provider/Physical/inventory flags remain false.

Only after the verification row commits does the next batch become executable.

## Explicitly absent

P4E does not call Ordermentum or any other provider. It does not create or change Physical SKU, package, barcode, warehouse location, StockOnHand, inventory quantity, images or #339 authority. It does not mutate `ecoflow_unleashed_master_mappings`.

## Engineering verification target

The PostgreSQL 17 contract must prove inactive-admin denial, plan/hash binding, source-drift fail-closed behavior, batch-2-before-postflight denial, exact batch replay, postflight replay, and the complete seven-batch run ending with exactly:

- +163 Commercial SKUs;
- +163 ORDERMENTUM external mappings;
- +163 Wave-2 promotions;
- +163 item promotion commands;
- 7 batch commands;
- 7 postflight verification checkpoints;
- unchanged 163 Unleashed source mappings;
- zero provider/Physical/inventory authority.

## STOP

P4E engineering stops at the merge gate. Production merge/deploy and any first-batch execution require separate explicit authorization.
