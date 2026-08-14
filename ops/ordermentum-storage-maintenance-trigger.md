# Ordermentum projection storage maintenance trigger

Trigger ID: `2026-08-14-complete-mirror-336-projection-compaction`

This marker authorizes one explicit production physical-maintenance run after Complete Mirror #336 proved that the Accounts snapshot safe-delete repair succeeded and then failed only at the unchanged 475 MiB storage guard.

Observed production evidence before maintenance:

- Database size: `542706835` bytes.
- Unchanged pre-quota guard: `498073600` bytes (475 MiB).
- `ordermentum_raw_master_resource_versions` is already logically bounded to the 1-version / 7-day / 2-MiB payload policy and is not the required reclaim target.
- `om_orders` has already been logically slimmed so the complete Ordermentum order payload remains in `ordermentum_raw_orders`, but its physical relation is still disproportionately large.
- `om_order_items` is likewise a derived projection table with a disproportionately large physical relation compared with its live row count.

Authorized action:

- `VACUUM (FULL, ANALYZE)` only on `public.om_order_items` and `public.om_orders`.
- Verify exact row-count and ordered-primary-key fingerprints before and after the physical rewrite.
- Keep the 475 MiB guard unchanged and fail closed if the database remains at or above it.
- Dispatch a fresh `recent` Complete Mirror only after successful identity and storage-headroom verification.

Explicitly not authorized:

- No deletion, truncation, or mutation of Ordermentum raw authority tables.
- No deletion of current business rows from `om_orders` or `om_order_items`.
- No increase or bypass of the 475 MiB guard.
- No Ordermentum or QBO source writes.
- No hidden `VACUUM FULL` inside a schema migration or recurring schedule.
- No compaction of `om_invoices`, `ordermentum_raw_orders`, or `ordermentum_raw_master_resources` under this trigger.

This file is an auditable one-shot production maintenance trigger. Future physical maintenance requires a new explicit evidence marker or an operator-dispatched inspect/maintenance run under the same fail-closed contract.
