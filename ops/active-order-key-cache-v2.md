# Active order key cache v2

`ecoflow_ui_active_order_keys` is a derived acceleration cache for legacy supporting views. It is not part of the Ordermentum commercial mirror contract and it must never block source reconciliation.

The refresh function reads stable identifiers directly from `om_orders` and does not scan the multi-join order-operations views. It does not clear the cache inside a rebuild transaction. The authoritative current/history classification remains in the versioned order-operations views.

A cache refresh failure is emitted as a non-blocking warning. Complete mirror success continues to depend on raw/projected order and invoice coverage, source status classification, finance reconciliation and source-presence controls.
