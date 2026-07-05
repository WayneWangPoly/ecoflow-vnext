# Ordermentum cloud sync API-key hardening

The official `https://api.ordermentum.com` master-data endpoints can return:

```json
{"error":"API key required"}
```

when called with the legacy bearer token. This patch:

- passes `ORDERMENTUM_API_KEY` from GitHub Actions secrets into the sync job;
- adds an `orders_only` manual workflow mode;
- lets standard cloud order sync continue even when master-data sync is blocked by a missing API key;
- makes `master_only` fail loudly when the API key is missing on the official API host.

## Recommended flow

1. Keep `ORDERMENTUM_API_BASE_URL=https://api.ordermentum.com` for API-key mode.
2. Add a GitHub Actions secret named `ORDERMENTUM_API_KEY` after Ordermentum enables API access.
3. Until then, use `orders_only` or allow `standard` mode to skip master data while still syncing orders.
4. To test possible legacy fallback locally, set:

```powershell
$env:ORDERMENTUM_API_BASE_URL="https://app.ordermentum.com"
node scripts/ordermentum-master-data-discovery.mjs --resources=products,variants,purchasers,price_groups,invoices,stock_locations,leads --page-size=5
```
