# Ordermentum cloud sync legacy master v3

This patch makes the cloud sync legacy-aware.

- `https://app.ordermentum.com` can currently read products, variants, purchasers, price groups, invoices and leads using the legacy bearer token.
- `https://api.ordermentum.com` currently returns `{"error":"API key required"}` without an `ORDERMENTUM_API_KEY`.
- `stock_locations` returned 404 on the legacy host, so the default master resources exclude it.

Recommended GitHub Actions secrets for now:

```text
ORDERMENTUM_BASE_URL=https://app.ordermentum.com
ORDERMENTUM_API_BASE_URL=https://app.ordermentum.com
```

When Ordermentum enables official API key access, set:

```text
ORDERMENTUM_API_BASE_URL=https://api.ordermentum.com
ORDERMENTUM_API_KEY=<x-api-key>
```

Default master resources:

```text
products,variants,purchasers,price_groups,invoices,leads
```
