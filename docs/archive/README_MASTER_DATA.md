# EcoFlow master data pass 1: SKU master + store-site (address) master

## Apply

Run `supabase/migrations/20260706_seed_sku_master_and_store_sites.sql` in the Supabase SQL Editor.
No front-end config changes needed — the app auto-detects the new objects and falls back
gracefully while they don't exist.

## What it creates / seeds

**`ecoflow_store_sites`** (address master) — one row per retailer, seeded from the newest
raw Ordermentum order that carries an address. Measured coverage at seed time:
59/61 retailers with street + suburb, 58/61 with lat/lng, 59/61 with an Ordermentum
price-group id. Phones are empty in Ordermentum data — fill `contact_phone` by hand
(rows edited by hand should set `source = 'manual'` so reseeding never overwrites them).

**SKU master seed** —
- one `ecoflow_sku_master_overrides` row per active product mapping;
  `preferred_pick_level` is inferred from real order-line units
  (`external_product_mappings.default_unit_level` is an unreliable 'SLEEVE' placeholder);
- freight/service SKUs classified `SERVICE_ITEM`;
- `warehouse_location` column added (empty until the warehouse walk-through fills it);
- CARTON (+EACH where loose) packaging levels per internal SKU;
- Ordermentum barcode candidates land in `sku_barcodes` as `ORDERMENTUM_CODE_ONLY`/`REVIEW`
  for the confirmation workbench.

**`v_ecoflow_app_sku_master`** — the app-facing view. Only `CONFIRMED` barcodes are exposed
to the app; pseudo-codes never drive warehouse scanning.

## What the app now does with it

- Orders carry the real store address, suburb, lat/lng, delivery instructions and
  price-group name (tier). Navigation buttons unlock automatically for verified addresses.
- The driver run map projects real coordinates (warehouse at Dudley Park included);
  route optimisation now runs on real geometry.
- Pick lists take loose/carton judgement, warehouse location and service-item exclusion
  from the SKU master; sleeve-scan validation only ever compares against CONFIRMED barcodes.
- Stores page shows delivery address, contact and site status per store.

## Deliberately not in this pass

- Barcode confirmation workbench UI (confirm via `scripts/confirm-sku-barcode.mjs` or SQL for now).
- Warehouse location capture flow (fill `warehouse_location` manually meanwhile).
- Store-site edit UI (edit rows in Supabase; set `source='manual'`).
