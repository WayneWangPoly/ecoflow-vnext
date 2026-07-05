# EcoFlow Ordermentum Master Data View Schema Fix V2

This migration rebuilds the Ordermentum master-data workbench views without the JSON path array error and fixes `v_ecoflow_external_change_queue` to match the actual `external_change_requests` schema created by the safe overlay migration.

The previous view used columns such as `source_system`, `request_payload`, `diff_payload`, `created_at`, and `updated_at` directly from `external_change_requests`. The current table uses:

- `external_system`
- `source_payload_before`
- `proposed_payload_after`
- `diff_summary`
- `requested_at`
- `approved_at`
- `pushed_at`

This migration exposes compatibility aliases in the view, for example:

- `external_system as source_system`
- `proposed_payload_after as request_payload`
- `diff_summary as diff_payload`
- `requested_at as created_at`
- `coalesce(pushed_at, approved_at, requested_at) as updated_at`

It does not modify raw data, synced master data, SKU overrides, store sites, orders, or existing front-end files.
