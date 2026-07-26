# Ordermentum packaging evidence

The First stocktake product-mapping screen uses historical Ordermentum order-line unit labels as a read-only signal:

- carton lines only → carton-only evidence;
- sleeve/each lines only → loose-sale evidence;
- both → mixed carton and sleeve evidence;
- unrecognised or conflicting units → unclear.

This is not a packaging master and does not change SKU policy automatically. Physical labels and actual EcoFlow sales practice remain authoritative.

Field rule:

- Carton-only evidence: keep cartons sealed.
- Mixed evidence: open at most one representative carton only when a sleeve barcode is not already visible or mapped.
- Sleeve-only evidence: inspect one representative sleeve, then keep remaining cartons sealed.
- Unclear evidence: map the visible carton and leave the sleeve step pending.

The view and UI are read-only. No barcode, inventory, receiving, warehouse movement or package-policy row is written by this evidence check.
