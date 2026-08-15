# Work Package: WAREHOUSE-SURVEY-001 existing-SKU autocomplete

Issue: #318
Field acceptance parent: #314

## Objective

Restore the originally intended warehouse Barcode Survey flow: the operator types the first characters of an existing SKU, progressively narrows bounded suggestions, explicitly selects the correct SKU, and then records carton/sleeve physical barcode evidence.

## Authority boundary

The SKU is contextual evidence only. Selection must never create or edit a Commercial SKU, assign a barcode, publish Product Identity, change inventory, locations, receiving, stocktake balances, substitution rules or packaging conversions.

The server resolves the submitted SKU against the existing `v_ecoflow_inventory_sku_control` read surface before accepting the observation. Arbitrary browser-provided SKU context fails closed. The resolved SKU code and product-name snapshot are stored only on the append-only survey observation.

Historical survey observations without SKU context remain valid and unchanged. The original v1 survey RPC remains available for compatibility; the field UI uses v2.

## UX contract

1. Focus starts on SKU search.
2. Each typed SKU prefix performs a debounced, case-insensitive, prefix-only search with at most 12 suggestions from the server (server hard cap 20).
3. Suggestions display existing SKU and product name, plus category/shelf when available.
4. The operator explicitly selects one suggestion. Editing the text afterward invalidates the selection.
5. No match is explicit and never creates a SKU.
6. After SKU selection, focus moves to carton barcode, then existing sleeve-state capture continues unchanged.
7. `Save & Next` requires the explicit SKU selection, server acknowledgement, then clears the draft and refocuses SKU search.

## Idempotency

The server-resolved SKU context participates in the v2 request fingerprint. Reusing a command UUID with a changed SKU fails with `BARCODE_SURVEY_IDEMPOTENCY_CONFLICT`. Exact retries remain replay-safe.

## Verification

- Static authority contract proves prefix/bounds/role controls and forbids SKU/Product Identity/inventory writes.
- PostgreSQL 17 fixture proves historical no-SKU rows survive, prefix narrowing works, canonical SKU context is server-resolved, unknown SKUs fail closed, and changing SKU on the same command conflicts.
- Existing Barcode Survey role/DML/replay/concurrency contracts continue to run.
- TypeScript and production build must pass on exact PR head.
- A trusted production-schema shadow migration gate is required before merge because this adds a forward migration.
- Final authenticated production field evidence remains tracked by #314.

## Rollback

Do not edit a deployed migration. UI/repository can be reverted independently. If the database surface must be retired after deployment, use a forward compensating migration after evidence-retention review; historical observations must not be destroyed.
