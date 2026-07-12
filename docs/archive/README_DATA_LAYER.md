# EcoFlow Ordermentum data layer patch

This patch adds the first careful data-integration layer without calling the live Ordermentum API.

## What changed

- `src/data/ordermentumSnapshot.ts`
  - Normalized static snapshot generated from the current real Ordermentum sample files.
  - Includes recent order headers, one detailed order, invoice summary, purchaser summary, products, variants, price groups and stock locations.

- `src/domain/types.ts`
  - Shared EcoFlow UI/domain types.

- `src/domain/ecoflowData.ts`
  - Converts Ordermentum samples into EcoFlow internal demo data:
    - internal orders
    - stores
    - stock rows
    - catalog rows
    - price groups
    - reconciliation summary
    - data quality checks

- `src/app/App.tsx`
  - Removes hardcoded demo arrays from the app layer.
  - Dashboard / Ordermentum / Inventory / Stores / Reconciliation / Settings now read from the domain data layer.

- `src/styles.css`
  - Adds styling for data audit, quality gates, price groups, catalog sample, and integration readiness panels.

## Apply

Copy the files in this patch into the project root, then run:

```powershell
npm run build
npm run dev
```

## Build status

This patch was built successfully with:

```text
npm run build
```

## Next layer

The next logical layer is to replace the static `ordermentumSnapshot.ts` with either:

1. a file-upload importer for refreshed CSV/JSON exports, or
2. a repository interface that can later read the same shape from Supabase / live Ordermentum API.

Do not connect live API directly to UI components. Keep UI -> domain -> data source separation.
