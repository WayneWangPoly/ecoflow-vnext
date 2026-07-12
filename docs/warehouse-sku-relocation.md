# Warehouse SKU relocation

SKU identity, product names and warehouse layout are separate concerns.

- **Edit layout** controls rack geometry, rack/column order and location structure only.
- **SKU master** controls the product code and product display name.
- **Move SKU** controls stock relocation between two existing warehouse locations.

A future relocation action must not rename a SKU or silently overwrite a location. It should:

1. Select or scan the source location.
2. Select or scan the SKU currently recorded there.
3. Select or scan the destination location.
4. Enter the quantity to move, or choose **Move all**.
5. Confirm the transfer.
6. Write paired stock-ledger movements with one transfer reference: negative at source and positive at destination.
7. Refresh the Warehouse Map from the resulting location balances.

Corrections to an incorrect product name belong in SKU master. Corrections to an incorrect physical location use the controlled Move SKU transaction. Empty rack cells continue to display only **Empty** until receiving, stocktake or a relocation transaction creates a live balance there.
