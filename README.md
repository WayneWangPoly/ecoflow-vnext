# EcoFlow vNext

Clean rebuild of the EcoFlow internal fulfilment portal.

This project is **not** a restaurant ordering portal and **not** a customer checkout app. Orders are assumed to come from **Ordermentum API**. EcoFlow starts from imported orders and handles internal fulfilment:

Ordermentum import → mapping exceptions → owner release → stock reservation → picking → packing → delivery run → POD photo → completion.

## What is fixed in this version

- MVP roles: `owner`, `warehouse`, `picker`, `driver`
- No `/restaurant/*` or `/customer/*` routes
- SKU is the internal product identity
- Barcode is a lookup for SKU and unit level
- Supplier carton barcode is **not** treated as a unique physical carton ID
- Real warehouse locations are first-class master data
- Receiving goes to staging before putaway
- Inventory is event-ledger based through `stock_movements`
- POD belongs to `delivery_stop` and can also reference `order_id`

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Where to put your real data

Put CSV exports into:

```text
/data/master/skus.csv
/data/master/sku_barcodes.csv
/data/master/locations.csv
/data/master/ordermentum_product_mappings.csv
/data/master/customer_mappings.csv
/data/master/site_mappings.csv
```

Then run:

```bash
npm run import:master-data
```

The importer will regenerate TypeScript seed files under `src/core/data/generated/`.

## Manual work you still need to do

1. Export or prepare real SKU, barcode, location, and Ordermentum mapping CSVs.
2. Review generated seed files before using them.
3. Later, create Supabase tables using `supabase/schema.sql`.
4. Later, create a Supabase Storage bucket for POD photos.
5. Later, replace `src/core/repositories/mockRepository.ts` with Supabase repository functions.

## Contract files

The important files are:

```text
src/core/types/database.ts
src/core/types/ordermentum.ts
src/core/constants/roles.ts
src/core/constants/statuses.ts
src/core/constants/routes.ts
src/core/data/seed*.ts
src/core/mapping/mapOrdermentumOrder.ts
src/core/state/orderState.ts
src/core/state/inventoryState.ts
```

Do not rename domain objects, statuses, or routes casually. These are the project contract layer.
