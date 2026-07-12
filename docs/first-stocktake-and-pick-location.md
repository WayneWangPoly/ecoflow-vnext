# First warehouse stocktake and pick-location contract

Warehouse Map locations are operational master data, not visual decoration.

Recommended first stocktake sequence:

1. Work one physical A/B cell at a time and select or scan the location first.
2. Scan every SKU/item code physically stored in that cell.
3. Scan carton, sleeve, inner or each barcode and record units per package.
4. Count observed packages.
5. Review exceptions before posting opening stock through a controlled stocktake/receiving batch.

The fixed shelf recorded during Barcode setup is merged into the SKU master used to build order lines. Pick therefore receives the same location that appears on Warehouse Map. Adding a `+` slot only adds capacity for another SKU in the current cell; it never creates quantity or a stock-ledger movement.
