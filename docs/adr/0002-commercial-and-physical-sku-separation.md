# ADR-0002: Separate commercial and physical SKUs

- Status: Accepted
- Date: 2026-07-27
- Owners: Chief Engineer, Domain, Platform/Data

## Context

A customer can order one Ordermentum product while the warehouse fulfils it
with an equivalent brand based on stock, quality, and price. Treating the sales
SKU as the physical stock item makes stocktake, deduction, margin, recall, and
customer dispute records unreliable.

## Decision

Represent these concepts separately:

- commercial product and sellable SKU: what the customer ordered;
- physical stock item or brand variant: what exists and was dispatched;
- substitution group and constraints: which physical items may fulfil a
  commercial line;
- allocation: the approved physical item and quantity selected for an order
  line.

Picking and inventory movements reference the physical item. The order retains
the commercial line. A substitution records actor, time, quantity, reason, and
the rule that allowed it.

## Alternatives considered

- Rename the Ordermentum SKU when suppliers change: rejected because it destroys
  order history and does not represent concurrent brands.
- Use an unstructured note on the pick task: rejected because stock and recall
  cannot be reconciled.
- Treat all equivalents as one stock balance: rejected because pack conversion,
  quality, cost, and barcode controls differ.

## Consequences

Stocktake must count physical items, and each barcode maps to a physical item
and package unit. Pricing remains tied to the commercial product. Historical
orders display both ordered and fulfilled identities when they differ.

## Migration plan

1. Inventory current SKU, barcode, package, and mapping data.
2. Introduce compatible physical-item and substitution structures.
3. Backfill only mappings that can be proven; quarantine ambiguous rows.
4. Change allocation and movement commands before changing UI labels.
5. Reconcile opening balances and retire direct commercial-SKU deduction.
