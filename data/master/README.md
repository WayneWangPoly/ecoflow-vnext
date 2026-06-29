# EcoFlow master data import

This project now treats the uploaded markdown baseline as the current trial source of truth:

- Ordermentum SKU code = EcoFlow `sku_code` = warehouse SKU.
- `barcode_value` is always text. Do not use number fields for barcodes because some values start with `0`.
- Supplier carton/sleeve barcodes identify SKU + unit level. They are not unique physical carton IDs.
- Current confirmed trial location is `A1-01-02A` with barcode `LOC-A1-01-02A`, assigned to `JP-PBS-6X197-ARTBOX`.

Copy the `.example.csv` files to `.csv`, expand them with real master data, then run:

```bash
npm run import:master-data
```

Generated files are written to `src/core/data/generated/` for review before wiring into the seed modules.
