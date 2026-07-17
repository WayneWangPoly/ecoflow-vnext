# Current-order scope repair — 17 July 2026

The completed Ordermentum history mirror exposed three presentation and operational-scope defects:

- The lightweight active-key refresh cached every canonical historical order and never pruned stale keys.
- Current operational browser reads silently stopped at the Supabase single-response row cap.
- Mirror status counted both an order UUID and its order number as two raw orders.

The correction restores a current-only, source-present, non-terminal 60-day cache with atomic stale-key pruning; pages all required operational views; uses the exact server operations summary for the Dashboard total; and publishes source-backed distinct mirror counts with computed active source-missing controls.

Full history remains retained and searchable. It is not promoted into warehouse, driver or current-order queues.
