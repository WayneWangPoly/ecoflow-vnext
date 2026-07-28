## Summary

<!-- What changed? Keep this PR to one logical theme. -->

## Business behaviour

<!-- What user or operational behaviour changes? What must remain unchanged? -->

## Technical approach

<!-- Include the work-package or ADR link and the authoritative contract. -->

## Files changed

<!-- List the main paths and why each is in scope. -->

## Database impact

<!-- Schema, migration, RPC, RLS, deployment order, or "None". -->

## Security impact

<!-- Roles, data exposure, credentials, storage, audit, or "None". -->

## Tests and evidence

<!-- Exact commands and results. Add concurrency/RLS/migration evidence where relevant. -->

- [ ] TypeScript and production build pass.
- [ ] Relevant unit and integration tests pass.
- [ ] Migration shadow and RLS checks pass, or are not applicable.
- [ ] UI screenshots are attached, or there is no UI change.
- [ ] Scope drift and unrelated formatting were checked.
- [ ] Independent Verification reviewed critical operational changes.

## Known limitations and deferred findings

<!-- Do not fix unrelated findings in this PR. Record them here. -->

## Rollback

<!-- Code, data, deployment, and compensating-migration steps. -->

## Release checklist

- [ ] Branch name follows `agent/<area>/<ticket>-<description>`.
- [ ] No credentials, raw provider exports, customer data, generated files, or local config are committed.
- [ ] No new `ecoflow_day_state` scope or DOM enhancer was introduced without an accepted ADR.
- [ ] Commercial and physical SKU identities remain separate.
- [ ] Inventory changes produce approved movement records.
- [ ] Critical offline actions are not shown as server-complete.
