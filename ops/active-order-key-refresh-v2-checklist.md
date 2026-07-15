# Active-order key refresh v2 release checklist

- Lightweight function reads `om_orders` only.
- No operations view scan occurs inside the refresh RPC.
- No table-wide cache delete occurs.
- No cache refresh runs inside a schema migration transaction.
- A cache failure is logged as non-blocking.
- Complete mirror verification remains independent of the cache.
