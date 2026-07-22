import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const migration = read('supabase/migrations/20260722194500_stocktake_package_unit_integrity.sql');
const readiness = read('src/FirstStocktakeGoLiveCheck.tsx');
const warehouseBundle = read('src/enhancers/WarehouseOpsEnhancers.tsx');
const receivingRepo = read('src/data/repositories/stagedReceiving.ts');
const receivingUi = read('src/WarehouseReceivingFlow.tsx');
const pickBoard = read('src/app/PickBoard.tsx');

has(migration, "'RECEIVE',v_line.units_received", 'Inventory ledger must retain converted/base units.');
has(migration, "v_line.qty_packages,'ACTIVE'", 'Warehouse location balance must use package-level quantity.');
has(migration, 'v_unit_level,v_line.qty_packages', 'Warehouse movement must use the quantity named by its unit level.');
lacks(migration, 'v_unit_level,v_line.units_received', 'Warehouse movement must not relabel base units as carton or sleeve counts.');
has(migration, 'v_ecoflow_stocktake_uom_integrity', 'Posted receiving UOM integrity must remain auditable.');
has(migration, "when wm.quantity <> l.qty_packages then 'PACKAGE_QUANTITY_MISMATCH'", 'Historic package mismatch detection must be explicit.');

has(warehouseBundle, '<FirstStocktakeGoLiveCheck />', 'Warehouse stocktake must mount the go-live self-check.');
has(readiness, 'LIVE STOCK · PICK DATA READY', 'Readiness must distinguish live pickable stock.');
has(readiness, 'MAPPED · COUNT NOT POSTED', 'Readiness must distinguish mapping from live stock.');
has(readiness, 'CLOUD STAGED · NOT LIVE', 'Readiness must distinguish staged counts from posted stock.');
has(readiness, 'Ordermentum order ≠ stock deduction', 'Readiness must reject order-presence auto-deduction.');
has(readiness, "from('v_ecoflow_stocktake_uom_integrity')", 'Readiness must query package-unit integrity.');
has(readiness, 'loadReceivingBarcodeLookup()', 'Readiness must verify the active barcode registry.');
has(readiness, 'loadWarehouseLocationItems()', 'Readiness must verify live location stock.');
has(pickBoard, 'pickWarehouseStock', 'Pick must remain the controlled stock-deduction point.');
has(pickBoard, 'Live warehouse stock is not enough. Record shortage first.', 'Pick must fail closed on insufficient stock.');

has(receivingRepo, 'supplierName?: string | null', 'Receiving repository must accept supplier identity.');
has(receivingRepo, 'supplierOrderRef?: string | null', 'Receiving repository must accept a supplier delivery/order reference.');
has(receivingRepo, 'invoiceRef?: string | null', 'Receiving repository must accept an invoice reference.');
has(receivingRepo, 'p_supplier_order_ref: input.supplierOrderRef?.trim() || null', 'Receiving metadata must reach the controlled RPC.');
has(receivingUi, 'Delivery docket / order ref (optional)', 'Daily receiving must accept overseas or undocumented inbound deliveries.');
has(receivingUi, 'UNREFERENCED-${date}-${time}', 'A delivery without supplier paperwork must receive a stable EcoFlow audit reference.');
has(receivingUi, 'resolveDelivery()', 'The source identity must be resolved before the controlled batch RPC.');
has(receivingUi, 'startStagedReceivingBatch({', 'Unreferenced inbound must still use the controlled receiving batch RPC.');
lacks(receivingUi, 'before the first scan', 'The first scan must not be blocked merely because supplier paperwork is unavailable.');
has(receivingUi, 'Complete batch and post stock', 'Daily receiving must retain one explicit posting gate.');

console.log('Stocktake SKU → barcode → package UOM → location → live stock → controlled Pick audit passed.');
