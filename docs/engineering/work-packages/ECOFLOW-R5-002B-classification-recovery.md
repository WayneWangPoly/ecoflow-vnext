# ECOFLOW-R5-002B — bulk snapshot classification repair + dormant recovery carrier

## Baseline

- Protected base: `a3a103a9cfe3ffc66e9bfe06656e243e6b12ba95`.
- Failed live run: `53c8bf37-ff65-473a-ae9f-ec899acc1770`.
- The original request key `ECOFLOW-R5-002` is permanently consumed and must not be replayed.
- Production failure evidence is frozen in #339 comment `5672192072` and #335 comment `5672195570`.

## Root cause and repair

Unleashed returned page 1 successfully with HTTP 200 and 200 ADL1 StockOnHand rows. Before any snapshot write, the Edge function attempted one PostgREST `in.(...)` lookup containing all 200 long `product:<uuid>:warehouse:<uuid>` keys. The generated REST URL failed in transport.

Existing-snapshot and external-identity classification now partition external keys by a conservative encoded filter-value budget of 1,500 bytes. The connector page maximum remains 200 rows. Every classification chunk must succeed before the page commit RPC is reached; any chunk failure therefore prevents partial page staging.

## Dormant R2 carrier

The Edge contract recognizes `ECOFLOW-R5-002-R2` with the same ADL1/page-size/page-count boundary and recovery-specific reason, but it is deliberately non-executable in this package. Before returning `R5_002_R2_DORMANT_NOT_ACTIVATED`, the server proves the original key exists exactly once, the original run failed on the snapshot-classification path after seeing 200 rows, staged zero rows, targeted ADL1, and left no snapshot first/last-seen evidence. It also proves the R2 key has never been used.

There is intentionally no R2 browser control. A later separately authorized activation must make the recovery carrier live.

## Safety boundary

This package authorizes no Unleashed provider request, no R5-002 replay, no R5-002-R2 execution, no inventory-reference STAGE, no INITIAL stocktake, no inventory/warehouse movement, no Product Identity mutation, no Commercial Wave-2 mutation, and no cutover.

## Verification

The dedicated test constructs 200 production-shaped StockOnHand keys, proves deterministic encoded-budget partitioning, proves 70 unchanged + 60 changed + 70 inserted reconciliation, rejects 201-key pages, verifies both classification readers use chunking, and verifies R2 remains dormant. Existing Unleashed audits, typecheck and production build are required on the exact PR head.

## Merge boundary

Engineering PASS is not merge authorization. Merge/deployment remain a separate gate. Even after a later merge/deploy, live R2 provider traffic requires a separate explicit authorization and activation step.
