# UNLEASHED-MIGRATION-005 — #340A Native Read Parity

## Boundary

This package is read-only framework work. It does not authorize Product Identity commissioning, Receiving, Stocktake, Pick, inventory adjustment/transfer, Unleashed live acquisition, #338 PLAN/AUTHORIZE_ASSETS/COPY_IMAGES, #340B mutations, #345 metrics, #341 cutover, or #342 retirement.

Native WAYNX routes remain the only shell. Unleashed familiarity is limited to generic business navigation, filter/column order and operating mental model. Raw `unleashed_*` staging snapshots are not operational truth.

## Reuse matrix

| #340A surface | Decision | Existing authority/assets | Bounded implementation consequence |
| --- | --- | --- | --- |
| Control Room | REUSE | `DashboardPage`, existing intelligence/control-room contracts | No replacement dashboard shell. Later enrichment only consumes governed read models. |
| Products | COMPOSE | Ordermentum commercial/catalog facts + `productIdentity.ts` + inventory/reference context | New `/products` read workspace. Product Master stays separate from `/inventory` and Physical SKU commissioning. |
| Suppliers | NEW | #338 governed mapping evidence exists; no complete native supplier directory is yet exposed as operational truth | Define a typed Supplier Master read contract. Until a governed canonical directory is bound, surface must be explicit UNAVAILABLE/DEGRADED rather than read raw Unleashed JSON. |
| Purchases | ADAPT | `purchaseOrders.ts`, `WarehousePurchaseOrderReceiving.tsx`, `WarehouseReceivingFlow.tsx`, `DesktopReceivingHistory.tsx`, `PurchaseOrderReconciliation.tsx` | New `/purchases` office read route adapts the existing read RPC. Mutation/receiving entry points remain governed separately. |
| Inventory | REUSE / ADAPT | `inventoryControl.ts`, `InventoryControlCenter.tsx`, `InventoryMasterCatalog.tsx`, #339 reference/ledger semantics | Enrich current native inventory surface. Never overwrite balances from browser state. |
| Customers | REUSE / ADAPT | `customerStoreCenter.ts`, `OwnerStoreIntelligence.tsx`, existing `/customers` route | Extend existing customer/store model; do not create a duplicate customer shell. |
| Product Identity | REUSE | `/commissioning/product-identity`, `productIdentity.ts` | Remains distinct commissioning authority; #340A only links/read-composes context later. |
| Delivery / Driver / POD | REUSE | Existing native routes and authority | Must remain green and untouched by parity shell work. |
| Analytics | REUSE | Existing analytics/intelligence route | #340 does not create Revenue/Gross Profit formulas; #345 owns governed metric definitions. |

## Chat 1 checkpoint

- Register `/products`, `/products/:productId`, `/suppliers`, `/suppliers/:supplierId`, `/purchases`, `/purchases/:purchaseOrderId` in the central unified route contract.
- Owner/Admin route ownership is explicit. Account/Viewer/Warehouse/Driver remain fail-closed until an independent capability decision changes that contract.
- New routes intentionally retain `legacyDesktopTab: null` in Chat 1. The existing `DesktopRouteBoundary` therefore emits `WORKSPACE_NOT_MIGRATED` rather than showing a wrong legacy panel.
- Reuse the existing bounded workspace query-state parser for search/filter/sort/cursor/selection state.
- Introduce typed read-state/source/authority/freshness contracts under `src/data/repositories/`.
- Adapt the existing governed purchase-order read RPC only; expose no new write command.

Chat 2 is responsible for mounting the real Products/Suppliers/Purchases read surfaces into the existing desktop shell. No route is to be declared parity-complete merely because it is registered here.
