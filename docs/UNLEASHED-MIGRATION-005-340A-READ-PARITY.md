# UNLEASHED-MIGRATION-005 — #340A Native Read Parity

## Boundary

This package is read-only framework work. It does not authorize Product Identity commissioning, Receiving, Stocktake, Pick, inventory adjustment/transfer, Unleashed live acquisition, #338 PLAN/AUTHORIZE_ASSETS/COPY_IMAGES, #340B mutations, #345 metrics, #341 cutover, or #342 retirement.

Native WAYNX routes remain the only shell. Unleashed familiarity is limited to generic business navigation, filter/column order and operating mental model. Raw `unleashed_*` staging snapshots are not operational truth.

## Reuse matrix

| #340A surface | Decision | Existing authority/assets | Bounded implementation consequence |
| --- | --- | --- | --- |
| Control Room | REUSE | `DashboardPage`, existing intelligence/control-room contracts | No replacement dashboard shell. Later enrichment only consumes governed read models. |
| Products | COMPOSE | Ordermentum commercial/catalog facts + existing Product Identity and operational-detail read RPCs | `/products` reads Commercial Product Master plus explicit identity evidence. Product Master stays separate from `/inventory` and Physical SKU commissioning. |
| Suppliers | NEW | #338 governed mapping evidence exists; no complete native supplier directory is yet exposed as operational truth | Define a typed Supplier Master read contract. Until a governed canonical directory is bound, surface must be explicit UNAVAILABLE/DEGRADED rather than read raw Unleashed JSON. |
| Purchases | ADAPT | `purchaseOrders.ts`, `WarehousePurchaseOrderReceiving.tsx`, `WarehouseReceivingFlow.tsx`, `DesktopReceivingHistory.tsx`, `PurchaseOrderReconciliation.tsx` | New `/purchases` office read route adapts the existing read RPC. Mutation/receiving entry points remain governed separately. |
| Inventory | REUSE / ADAPT | `inventoryControl.ts`, `InventoryControlCenter.tsx`, `InventoryMasterCatalog.tsx`, #339 reference/ledger semantics | Enrich current native inventory surface. Never overwrite balances from browser state. |
| Customers | REUSE / ADAPT | `customerStoreCenter.ts`, `OwnerStoreIntelligence.tsx`, existing `/customers` route | Extend existing customer/store model; do not create a duplicate customer shell. |
| Product Identity | REUSE | `/commissioning/product-identity`, `productIdentity.ts` | Remains distinct commissioning authority; #340A composes its governed read output and exposes no commissioning command. |
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

## Final read-parity contract

- Owner/Admin navigation follows the frozen order: Control Room, Sales Orders, Purchases, Products, Inventory, Product Identity, Customers, Suppliers, Exceptions, Delivery, Returns, Accounts, Analytics, Logs, Settings. `/ordermentum` remains routable but is not promoted as a second office navigation entry.
- Products, Suppliers and Purchases retain URL-backed search/filter/sort/page state and report exact filtered record counts.
- Product identity composition reads `ecoflow_read_product_identity_commissioning_v1` and `ecoflow_read_operational_record_detail_v1`. It discards inventory quantities and exposes no Product Identity command.
- The first production fixture remains Commercial SKU `R-360Y` (`6946f415-68ea-484a-91f4-848b7ec048ec`) → preferred Physical SKU `R-360Y` (`8905b519-6418-4bb1-a2a4-bdd8d48157f7`) → active carton barcode `19344062000652`. Runtime values come from governed reads; the UI does not infer or create this identity.
- Purchase familiarity is display-only. A conservative explicit mapping retains every underlying WAYNX state alongside its familiar label; unmapped states remain unavailable rather than guessed.
- Warehouse, supplier reference, sales-order reference, printed/export state and PO total remain explicitly unavailable where the current governed summary does not supply them. No browser-side total, AvailableQty or inventory formula is introduced.
