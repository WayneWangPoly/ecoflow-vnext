# EcoFlow field readiness reset v1

## Product purpose

Ordermentum remains the commercial source of truth for customers, SKUs, orders and invoices. EcoFlow exists to convert those source facts into physical execution: warehouse locations, barcode identity, stock movements, picking, delivery runs, POD and operational audit.

## Current release phase

The product is now in **warehouse preparation**, not broad control-room expansion.

The single next field milestone is the first warehouse stocktake:

1. Select the physical location.
2. Identify the Ordermentum SKU.
3. Scan the package barcode and define the package conversion.
4. Count packages observed.
5. Add the line to one controlled stocktake receiving batch.
6. Verify every line and post the batch once to the stock ledger and warehouse location balances.

## Interface policy

- The default Owner/Admin dashboard must show one next action, not integration internals.
- Mirror health is a compact system prerequisite, not the primary workflow.
- First stocktake combines barcode setup and controlled receiving into one guided surface.
- Daily receiving, returns, pick and delivery remain available but secondary until opening stock is established.
- Technical controls remain in System/Settings and audit surfaces.
- No stock quantity may change from Warehouse Map or barcode mapping alone.

## Readiness gate

Field readiness is reached when:

- Ordermentum mirror is COMPLETE.
- Warehouse map locations are available.
- First-stocktake lines can be scanned, verified and posted once.
- Posted quantities appear in Inventory and Warehouse Map.
- A warehouse user can complete the flow from a phone without navigating through Owner technical screens.
