# Complete mirror source-missing definition v3

- Retained Ordermentum `SOURCE_MISSING` records remain historical warnings.
- A source-missing order blocks mirror completion only when it is linked to a non-terminal EcoFlow internal order workflow.
- Complete-mirror verification uses the lightweight `ecoflow_count_active_source_missing_orders()` database contract and publishes `LIGHTWEIGHT_DIRECT_V3`.
- Settings displays the actual persisted blocker list when history is already complete instead of claiming the history backlog is incomplete.
