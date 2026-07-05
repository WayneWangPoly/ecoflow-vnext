# Order Coverage + SKU Activity V6

Fixes barcode count aggregation by joining `sku_barcodes.packaging_level_id` to `sku_packaging_levels.id` before reading `level_code`.
