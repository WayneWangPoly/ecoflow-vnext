# ECOFLOW-SLIM-002 — Targeted Ordermentum Store Sync

## Objective

Allow one known Ordermentum purchaser/store to be refreshed by external ID without scanning the purchaser catalog, price groups, products, variants, orders, or history.

An unchanged purchaser payload must perform zero database writes. A changed purchaser may write only its bounded raw-detail row, one bounded previous-version row when applicable, and its single non-manual `ecoflow_store_sites` row.

## Owner and reviewers

- Implementation role: Platform/Data
- Verification role: independent repository CI / Verification reviewer
- Chief Engineer: required for the new Edge Function and workflow
- Dependency: ECOFLOW-SLIM-001 minimum background cadence
- Planned merge order: ECOFLOW-SLIM-001, then this package

## In scope

- `scripts/ordermentum-targeted-store-sync-core.mjs`
- `scripts/ordermentum-targeted-store-sync.mjs`
- `scripts/ordermentum-targeted-store-sync.test.mjs`
- `.github/workflows/ordermentum-targeted-store-sync.yml`
- `.github/workflows/ordermentum-targeted-store-sync-check.yml`
- `supabase/functions/trigger-ordermentum-targeted-sync/index.ts`
- this work package

## Out of scope

- no scheduled target sync;
- no full purchaser scan;
- no full SKU/product/variant scan;
- no price-group scan;
- no schema or migration change;
- no direct Ordermentum writes;
- no overwrite of `ecoflow_store_sites.source='manual'` rows;
- no product/SKU targeted write in this package: current SKU consumers distinguish product summary and detail payloads, so merging them safely is a separate contract.

## Behaviour contract

### Input

`resource=purchaser` and one UUID `external_id`.

### Source request

Exactly one Ordermentum detail request:

`GET /v1/purchasers/{external_id}`

The targeted path must never call `/v1/purchasers` or paginate any collection.

### Unchanged result

If SHA-256 of the fetched detail equals the current `purchaser_detail` payload hash:

- return `changed=false`;
- perform no INSERT/UPDATE/DELETE;
- do not touch `last_seen_at`, `last_synced_at`, operational jobs, or store rows.

### Changed result

- archive at most the previous `purchaser_detail` state using the existing version-retention policy;
- upsert exactly one `ordermentum_raw_master_resources` row with `resource_type='purchaser_detail'`;
- project exactly one retailer/store row;
- preserve existing non-null store fields when the new purchaser detail omits them;
- if the target store is `source='manual'`, preserve it and report `storeProjection='manual_preserved'`.

### Trigger

The Owner/Admin-only Edge Function validates the current user and dispatches the dedicated GitHub workflow with the target ID. It does not create a durable operational-sync job, avoiding a new persistent log stream for this low-volume targeted action. Security audit events remain the bounded authority for explicit user-triggered dispatch.

### Evidence retention

Targeted workflow log artifact retention: 1 day.

## Acceptance criteria

- [ ] Targeted script contains no collection purchaser endpoint call.
- [ ] Targeted script accepts exactly one purchaser external ID.
- [ ] Same payload hash yields zero DB writes by control flow.
- [ ] Changed payload updates one raw-detail identity only.
- [ ] Store parsing matches the existing production projection field precedence.
- [ ] Manual store rows cannot be overwritten.
- [ ] Dedicated workflow has no `schedule`, `push`, or `workflow_run` trigger.
- [ ] Workflow artifacts retain for 1 day.
- [ ] Edge Function is Owner/Admin-only and accepts only purchaser + UUID.
- [ ] Unit/static contract tests pass.

## Test plan

| Layer | Scenario | Expected result |
|---|---|---|
| Unit | purchaser payload field extraction | exact retailer/store projection values |
| Unit | unchanged hash | `changed=false`, persistence callback never called |
| Unit | manual store | projection callback reports preserve/no update |
| Static | workflow trigger audit | workflow_dispatch only, 1-day artifacts |
| Static | endpoint audit | detail endpoint present; collection endpoint absent |
| Production after merge | target known unchanged store | 1 GET, 0 DB writes |
| Production after merge | target one changed store | only that raw-detail/store identity changes |

## Required evidence

- changed-file diff;
- unit/static CI output;
- no migration;
- post-deploy targeted dry/unchanged proof before declaring production complete.

## Rollback

Disable/remove the dedicated targeted workflow and Edge Function. Existing full manual recovery workflows and weekly recent reconciliation remain available.

## Decision log

### Decisions

- Store detail is stored as `purchaser_detail`, separate from the `purchasers` summary row, so a future full list refresh cannot create hash flip-flop.
- Unchanged checks intentionally do not touch timestamps because minimum writes are more important than recording every no-op check.
- Product targeting is deferred from this package because overwriting `products` summary with product detail would create alternating payload hashes during later full recovery scans.

### Risks

- A store changed in Ordermentum is not automatically known to EcoFlow unless an operator/system supplies its purchaser ID; weekly reconciliation remains the fallback discovery path.
- The detail endpoint response contract is provider-owned; malformed or mismatched target identity fails closed.
