# ECOFLOW-SLIM-003 — Derived Ordermentum JSON Retention

## Objective

Stop duplicated Ordermentum JSON in derived `om_invoices` and `om_order_items` from regrowing, then reclaim the existing physical space with one explicit, identity-preserving production maintenance run.

Production evidence on 2026-08-26:

- database: 505,293,971 bytes (~482 MiB);
- `om_invoices`: 118 MiB total / ~113 MiB TOAST / ~64 MiB live `raw_json`;
- `om_order_items`: 46 MiB total / ~40 MiB TOAST / ~34 MiB live `raw_json`;
- complete source authority remains in `ordermentum_raw_orders` and Ordermentum raw master tables.

Database dependency inspection found no view consuming `om_order_items.raw_json`. `v_ecoflow_order_financial_truth_v1` consumes only these invoice raw fields beyond structured columns:

- `paymentMethod.name` / `paymentMethod.type`;
- `invoicePaymentMethod`;
- `currentPaymentMethod`;
- `paymentTerms` / `paymentTerm` / `terms`;
- `unleashedStatus` / `syncStatus` / `integrations.unleashed.status`.

## Owner and reviewers

- Implementation role: Platform/Data
- Verification role: independent migration/storage Verification
- Chief Engineer: required for migration and production maintenance workflow
- Dependency: ECOFLOW-SLIM-001 minimum background cadence
- Planned merge order: ECOFLOW-SLIM-001, this package, then explicit production maintenance

## In scope

- one forward migration installing derived-JSON slimming triggers;
- static/storage contract tests;
- one manual-only production maintenance workflow;
- no automatic execution of the maintenance action.

## Out of scope

- no deletion of `ordermentum_raw_orders`;
- no deletion of master source payloads;
- no historical order deletion;
- no change to financial/order/item structured fields;
- no change to Ordermentum source writes;
- no guard increase or quota bypass;
- no scheduled `VACUUM FULL`;
- no compaction of raw authority tables in this package.

## Behaviour contract

### Future writes

Before every INSERT/UPDATE of `om_order_items.raw_json`, store `{}` only.

Before every INSERT/UPDATE of `om_invoices.raw_json`, retain only the raw fields still consumed by `v_ecoflow_order_financial_truth_v1`. Structured invoice columns remain unchanged.

The triggers apply regardless of which projector writes the derived tables, preventing future regression without duplicating projector code.

### Existing data

The migration MUST NOT bulk-rewrite existing rows because production currently has only ~18 MB quota headroom. Existing rows are reclaimed only through the explicit maintenance workflow.

Maintenance order:

1. capture DB size, row counts, primary-key identity hashes, structured row fingerprints, and financial-view fingerprint;
2. rewrite `om_order_items.raw_json` to `{}`;
3. `VACUUM (FULL, ANALYZE)` `om_order_items`;
4. verify item row identity + structured fingerprint unchanged;
5. rewrite `om_invoices.raw_json` through the installed slimming trigger;
6. `VACUUM (FULL, ANALYZE)` `om_invoices`;
7. verify invoice row identity + structured fingerprint and financial-view fingerprint unchanged;
8. record reclaimed bytes and final database size.

The maintenance workflow is manual-only and keeps evidence for 1 day.

## Acceptance criteria

- [ ] Future item raw JSON is always `{}`.
- [ ] Future invoice raw JSON contains only the approved compatibility fields.
- [ ] Migration performs no bulk UPDATE/VACUUM of production rows.
- [ ] Trigger functions are not executable by browser roles.
- [ ] Maintenance workflow has only `workflow_dispatch`.
- [ ] Maintenance verifies primary-key and structured fingerprints before/after.
- [ ] Financial truth view output fingerprint is unchanged after invoice slimming.
- [ ] Maintenance processes items before invoices to recover headroom first.
- [ ] No raw authority relation is modified.
- [ ] Maintenance artifact retention is 1 day.
- [ ] Static migration/storage contract passes.

## Test plan

| Layer | Scenario | Expected result |
|---|---|---|
| Static | migration audit | trigger-only migration, no bulk rewrite, browser execute revoked |
| Static | maintenance audit | manual-only, items first, identity/fingerprint checks, 1-day artifact |
| Migration/shadow | apply forward migration | trigger installation succeeds; existing row counts unchanged |
| Production maintenance | explicit operator run | structured/financial fingerprints identical, DB bytes materially reduced |
| Post-maintenance sync | one changed order/invoice | derived raw JSON remains slim after normal projector execution |

## Required evidence

- production pre-size inventory;
- migration checks;
- maintenance before/after byte counts;
- row/fingerprint equality;
- financial view equality;
- post-sync derived raw JSON size evidence.

## Rollback

Before maintenance: forward compensating migration drops the two triggers/functions; no row data has changed.

After maintenance: structured derived data remains intact and complete raw authority remains in `ordermentum_raw_orders`; if full derived JSON is ever required again, it can be reprojected from source authority after an explicit contract change. Physical compaction itself does not delete structured business rows.

## Decision log

### Decisions

- Raw provider payload is not business history; derived tables retain only fields with proven consumers.
- `om_order_items.raw_json` has no database consumer and is reduced to `{}`.
- Invoice compatibility JSON is retained only for the financial-view fields that are not yet structured columns.
- Existing rows are not slimmed in the migration because quota headroom is too small for an uncontrolled rewrite.

### Assumptions

- `ordermentum_raw_orders` remains the complete order/detail source authority.
- Current production dependency inventory accurately reflects database view/function consumers; repository static audit additionally guards known code paths.

### Risks

- `VACUUM FULL` takes an exclusive table lock; the manual workflow serializes with Ordermentum cloud sync and fails on lock timeout rather than blocking indefinitely.
- Unknown external direct consumers of derived raw JSON would be incompatible; this is why structured/final read models are the supported contract.

### Deferred

- physical compaction of `ordermentum_raw_master_resources` and `ordermentum_raw_orders` only if final size remains above the desired 300–350 MiB operating band.
