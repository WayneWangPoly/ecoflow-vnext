import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const receiving = read('src/WarehouseReceivingFlow.tsx');
const stagedReceiving = read('src/data/repositories/stagedReceiving.ts');
const barcodeSetup = read('src/WarehouseBarcodeSprint.tsx');
const firstStocktake = read('src/FirstStocktakeFlow.tsx');
const firstStocktakeWorkspace = read('src/FirstStocktakeWorkspace.tsx');
const warehouseMount = read('src/WarehouseBarcodeSprintMount.tsx');
const identityResolution = read('src/data/repositories/productIdentityBarcodeResolution.ts');
const main = read('src/main.tsx');
const authTypes = read('src/features/auth/authTypes.ts');
const ownerBundle = read('src/enhancers/OwnerEnhancers.tsx');
const accountBundle = read('src/enhancers/AccountEnhancers.tsx');
const driverBundle = read('src/enhancers/DriverEnhancers.tsx');
const warehouseBundle = read('src/enhancers/WarehouseOpsEnhancers.tsx');
const mapModules = read('src/enhancers/WarehouseMapRouteModules.tsx');
const mapRoute = read('src/features/warehouse/WarehouseMapRoute.tsx');
const mapOwnerEdit = read('src/WarehouseMapOwnerEdit.tsx');
const mapPutaway = read('src/WarehouseMapPutawayControl.tsx');
const mapInteraction = read('src/WarehouseMapInteractionFix.tsx');
const mapRackEnhancer = read('src/WarehouseMapRackEnhancer.tsx');
const layoutRepository = read('src/data/repositories/warehouseLayout.ts');
const layoutMetadata = read('src/lib/warehouseLayoutMetadata.ts');
const driverApp = read('src/app/DriverApp.tsx');
const app = read('src/app/App.tsx');
const driverRun = read('src/domain/driverRun.ts');
const pickSync = read('src/data/repositories/pickSync.ts');
const inventory = read('src/InventoryControlCenter.tsx');
const pickOwnership = read('src/PickTaskOwnership.tsx');
const pickClaims = read('src/data/repositories/pickTaskClaims.ts');
const podRepository = read('src/data/repositories/deliveryPodQuality.ts');
const tracker = read('src/DriverLocationTracker.tsx');
const ownerTracking = read('src/OwnerDriverTrackingMap.tsx');
const departure = read('src/DriverDepartureControl.tsx');
const departureRepo = read('src/data/repositories/driverDeparture.ts');
const ownerGovernance = read('src/OwnerDeliveryGovernance.tsx');
const notificationFunction = read('supabase/functions/notify-route-start/index.ts');
const cloudWorkflow = read('.github/workflows/ordermentum-cloud-sync.yml');
const cloudScript = read('scripts/ordermentum-cloud-sync.mjs');
const integrationPanel = read('src/features/settings/OrdermentumIntegrationSettingsPanel.tsx');
const warehouseMigration = read('supabase/migrations/20260710130000_warehouse_backend_hardening.sql');
const pickClaimMigration = read('supabase/migrations/20260711170000_pick_task_ownership.sql');
const trackingMigration = read('supabase/migrations/20260710140000_owner_driver_location_tracking.sql');
const departureMigration = read('supabase/migrations/20260711100000_driver_departure_and_delivery_notifications.sql');
const unknownMigration = read('supabase/migrations/20260711180000_unknown_barcode_quarantine.sql');
const stateHardeningMigration = read('supabase/migrations/20260711181000_operational_state_auth_hardening.sql');
const multiRunMigration = read('supabase/migrations/20260711182000_multi_run_day_state.sql');
const warehouseWriteGuardMigration = read('supabase/migrations/20260727110000_restore_warehouse_write_guards.sql');
const warehouseMapPage = read('src/features/warehouse/WarehouseMapPage.tsx');

// Receiving and inventory source of truth.
has(receiving, 'Open receiving work', 'Receiving must expose resumable open batches.');
has(receiving, 'Multiple deliveries are open', 'Receiving must warn about multiple active batches.');
has(receiving, 'Complete batch and post stock', 'Receiving must keep one explicit stock-posting gate.');
has(receiving, 'Number.isInteger(qty)', 'Receiving package quantity must be a positive whole number.');
has(receiving, 'crypto.randomUUID()', 'Receiving scans must generate idempotency keys.');
has(stagedReceiving, 'ecoflow_stage_receiving_scan_v2', 'Receiving must use the idempotent database RPC.');
has(receiving, 'stageUnknownBarcodeIntake', 'Unknown barcodes must be preserved in a TEMP quarantine intake.');
has(receiving, 'Retry after mapping', 'Warehouse must be able to convert a quarantined barcode after Owner publication.');
has(unknownMigration, 'UNRESOLVED_UNKNOWN_BARCODES', 'Unresolved unknown codes must block stock posting.');
has(unknownMigration, 'uq_unknown_barcode_intake_idempotency', 'Unknown intake retries must be idempotent.');
lacks(warehouseMapPage, 'receiveWarehouseStock', 'Warehouse Map must not contain a hidden direct receiving implementation.');
lacks(warehouseMapPage, 'Receive + putaway', 'Warehouse Map must be read-only for stock changes.');
has(warehouseMigration, 'DIRECT_RECEIVE_DISABLED', 'Database must block legacy direct receiving.');
has(warehouseMigration, 'WAREHOUSE_RECEIVING_LINE', 'Ledger and location balance must share receiving-line references.');
has(warehouseWriteGuardMigration, 'revoke insert, update, delete on public.ecoflow_inventory_movements', 'Browser roles must not write the inventory ledger directly.');
has(warehouseWriteGuardMigration, 'if not public.ecoflow_can_manage_warehouse()', 'Warehouse write commands must enforce the active warehouse role.');
has(warehouseWriteGuardMigration, 'BARCODE_CONFLICT', 'A barcode conflict must be rejected instead of silently remapped.');
has(warehouseWriteGuardMigration, 'BARCODE_SETUP_CANNOT_RECEIVE_STOCK', 'Barcode mapping must not become a direct receiving path.');
has(warehouseWriteGuardMigration, "'INVENTORY_CONTROL'", 'Movement source metadata must be server controlled.');
lacks(barcodeSetup, 'Save + receive stock', 'Historical barcode setup must never become a stock receiving path.');
lacks(inventory, '<option value="RECEIVE">', 'Inventory ledger must not expose uncontrolled Receive.');

// Guided first stocktake: Product Identity owns package facts; Stocktake counts.
has(warehouseMount, 'FirstStocktakeWorkspace', 'Warehouse preparation must expose one guided first-stocktake entry.');
has(warehouseMount, "return 'stocktake'", 'First stocktake must be the default warehouse preparation mode.');
has(firstStocktakeWorkspace, '/commissioning/product-identity', 'First stocktake identity setup must route to canonical Product Identity.');
has(firstStocktake, 'Step 1: enter or scan a warehouse location.', 'First stocktake must be location-first.');
has(firstStocktake, 'resolveOperationalBarcode', 'First stocktake must validate the published physical barcode before counting.');
has(identityResolution, 'ecoflow_resolve_operational_barcode', 'First stocktake and Pick must share the server operational resolver.');
has(firstStocktake, 'recordBarcodeScan', 'First stocktake must record a canonical-validated count observation.');
has(firstStocktake, "actionMode: 'MAP_AND_COUNT'", 'First stocktake must record observed count evidence without directly posting stock.');
has(firstStocktake, 'stageReceivingScan', 'First stocktake must stage the observed packages through the controlled receiving batch.');
has(firstStocktake, 'setReceivingLineTick', 'Every first-stocktake line must require an explicit verification tick.');
has(firstStocktake, 'finishStagedReceivingBatch', 'Opening stock must post through the existing controlled batch completion transaction.');
has(firstStocktake, 'crypto.randomUUID()', 'First-stocktake retries must use idempotency keys.');
has(firstStocktake, 'Product Identity owns barcode and package conversion facts', 'Stocktake must explain that package facts come from Product Identity.');
lacks(firstStocktake, 'setSkuPackagePolicy', 'First stocktake must not author legacy package identity policy.');
lacks(firstStocktake, 'unitsPerPackage', 'First stocktake must not ask the operator to author units-per-package.');
lacks(firstStocktake, 'recordInventoryMovement', 'First stocktake must not write the stock ledger directly.');
lacks(firstStocktake, 'receiveByBarcode', 'First stocktake must not use the legacy direct receive RPC.');
lacks(warehouseMount, "from './WarehouseBarcodeSprint'", 'Warehouse operations must not mount legacy barcode commissioning.');
lacks(warehouseBundle, 'QuickSleeveBarcodeCapture', 'Warehouse operations must not mount legacy quick sleeve commissioning.');
lacks(warehouseBundle, 'WarehouseBarcodeTargetBridge', 'Warehouse operations must not mount the retired barcode sprint target bridge.');

// Warehouse Map is read-only; layout editing may change presentation only.
lacks(mapInteraction, 'incrementWarehouseSkuSlot', 'Warehouse Map must not expose + SKU position capacity changes.');
lacks(mapInteraction, 'ADD_SKU_SLOT', 'Legacy add-SKU-slot events must not remain active.');
lacks(mapRackEnhancer, 'appendOpenSlots', 'Warehouse cells must not render artificial empty SKU positions.');
lacks(mapRackEnhancer, "item.className = 'slot-mini slot-placeholder'", 'Warehouse cells must not create artificial SKU placeholder cards.');
has(layoutRepository, 'skuOrder?: string[]', 'Layout metadata must support visual-only SKU ordering.');
has(layoutRepository, 'never changes SKU assignment, quantity or the stock ledger', 'The visual-order data boundary must be explicit.');
has(layoutMetadata, 'skuVisualOrdersFromLayout', 'Visual SKU order must load from the shared cloud layout.');
has(layoutMetadata, 'mergeSkuVisualOrders', 'Visual SKU order must persist through one layout metadata path.');
has(mapRackEnhancer, 'activeSkuRef', 'Layout edit must implement a dedicated SKU visual drag state.');
has(mapRackEnhancer, "closest<HTMLElement>('.slot-item-wrap')", 'A dragged SKU must remain attached to its original location wrapper.');
has(mapRackEnhancer, 'captureVisibleSkuOrders', 'Layout Save must capture the visual SKU order.');
has(mapRackEnhancer, 'skuOrdersRef.current = structuredClone(skuSnapshotRef.current)', 'Layout Cancel must restore the previous SKU visual order.');
has(mapPutaway, 'Warehouse Map never changes stock quantity or SKU assignment directly', 'Map location actions must explain the read-only stock boundary.');
has(mapPutaway, 'Start stocktake here', 'Map may start the controlled first-stocktake workflow for a selected location.');

// Authentication, roles and bundle isolation.
has(main, 'ProductionConfigurationError', 'Missing production auth configuration must lock the application.');
has(main, 'SurfaceModuleGate', 'Role-specific modules must be lazy loaded by operational surface.');
has(main, 'Warehouse Map is a protected route feature, not an authentication role', 'Warehouse Map must be a feature, not a role.');
lacks(authTypes, 'WAREHOUSE_MAP', 'Warehouse Map must not appear in authentication roles.');
has(mapRoute, "['OWNER', 'ADMIN', 'WAREHOUSE']", 'Map access must be restricted to Owner, Admin and Warehouse.');
has(mapRoute, 'EmailLoginScreen', 'Warehouse Map must require secure sign-in.');
has(mapModules, 'WarehouseMapOwnerEdit', 'Map route must mount owner layout editing.');
has(mapModules, 'WarehouseMapPutawayControl', 'Map route must mount controlled putaway guidance.');
lacks(mapModules, 'WarehouseCameraScanner', 'Map route must not download warehouse scanner observers.');
has(warehouseBundle, 'WarehouseCameraScanner', 'Warehouse operations must retain the camera scanner.');
has(warehouseBundle, 'firstStocktakeFlow.css', 'Warehouse operations must load the guided field UI.');
has(ownerBundle, 'OwnerDriverTrackingMap', 'Owner bundle must include driver tracking.');
lacks(accountBundle, 'OwnerDriverTrackingMap', 'Accounts must not download owner tracking.');
lacks(driverBundle, 'DriverPodQualityEnhancer', 'Legacy overlay POD must be removed after native consolidation.');
has(mapOwnerEdit, 'saveWarehouseLayout', 'Owner layout edits must persist with cloud versioning.');

// Route ownership, loading and shared state.
has(app, 'Office route approval', 'Owner desktop must provide route planning and approval.');
has(app, 'Approve &amp; lock route', 'Office must explicitly lock the route.');
has(driverApp, 'Waiting for Owner or office to approve', 'Driver must wait for office route approval.');
lacks(driverApp, 'Review &amp; lock route', 'Driver must not own route locking.');
lacks(driverApp, 'Confirm route &amp; lock', 'Driver must not lock the route.');
has(driverApp, 'Undo last load', 'The most recent load confirmation must be reversible.');
has(driverRun, 'Math.floor(value / 26) - 1', 'Box codes must continue A-Z, AA, AB without wrapping.');
lacks(driverRun, 'index % BOX_CODES.length', 'Box codes must never repeat through modulo.');
has(pickSync, 'Authenticated EcoFlow session is required', 'Shared operational state must require a signed-in user.');
has(pickSync, 'data.session?.access_token', 'Shared operational state must use the user JWT.');
has(driverRun, 'runCode: string', 'Day state must identify the active sequential delivery run.');
has(driverRun, 'startFreshRun', 'Completed Run A must be able to start a separate Run B state.');
has(pickSync, "'run-control'", 'Shared state must publish the active run control record.');
has(pickSync, 'run:${day.runCode', 'Operational scopes must be namespaced by run.');
has(app, 'Start next delivery run', 'Owner or Accounts must be able to open the next run after completion.');
has(app, "if (appRole === 'ADMIN') return 'admin'", 'Admin must remain a distinct full-access desktop role.');
has(app, "if (appRole === 'VIEWER') return 'viewer'", 'Viewer must never be mapped to Owner.');
has(app, 'Viewer workspace is read-only', 'Viewer must receive an explicit read-only surface.');
has(app, 'Open workspace…', 'Owner/Admin must have an explicit workspace switcher.');
has(app, '/?workspace=warehouse', 'Workspace switcher must open warehouse operations without changing identity.');
lacks(driverApp, 'RUN_SIZE_WARNING', 'Driver route size must not infer van capacity from stop count.');
lacks(driverRun, 'RUN_SIZE_WARNING', 'Domain rules must not contain an unsupported van-capacity threshold.');
has(multiRunMigration, 'v_ecoflow_active_run', 'Database projections must follow the active run namespace.');

// Shared pick ownership.
has(pickOwnership, 'Take task', 'Warehouse staff must explicitly claim a shared pick task.');
has(pickOwnership, 'loadActivePickTaskClaims', 'The floor must display database-authoritative ownership.');
has(pickClaims, 'ecoflow_claim_pick_task', 'Claims must use the controlled database RPC.');
has(pickClaimMigration, 'pg_advisory_xact_lock', 'Concurrent claims must be serialised.');
has(pickClaimMigration, 'TASK_ALREADY_CLAIMED_BY', 'A second active claimant must be rejected.');
has(pickClaimMigration, 'PICK_TASK_CLAIM_REQUIRED', 'Stock deduction must require ownership.');

// Proof of delivery is one native, two-photo transaction.
has(driverApp, 'Take POD 1 · store / placement point', 'DriverApp must request POD 1.');
has(driverApp, 'Take POD 2 · all goods', 'DriverApp must request POD 2.');
has(driverApp, 'saveDropPointProof', 'POD 1 must upload through the typed proof repository.');
has(driverApp, 'saveGoodsPlacedProof', 'POD 2 must upload through the typed proof repository.');
has(driverApp, 'await queueDeliveryNotifications', 'Notification queueing must occur before Delivered is committed.');
lacks(driverApp, 'function SignaturePad', 'Driver POD must not request a signature.');
lacks(driverApp, 'Received by', 'Driver POD must not request or display a receiver name.');
has(podRepository, 'POD1_DROP_POINT', 'POD 1 must persist with a typed proof kind.');
has(podRepository, 'POD2_GOODS_PLACED', 'POD 2 must persist with a typed proof kind.');
has(pickSync, 'createPodAssetSignedUrl', 'Private POD evidence must use signed URLs.');
lacks(pickSync, '/object/public/', 'POD evidence must not use public Storage URLs.');
has(stateHardeningMigration, 'update storage.buckets set public=false', 'POD Storage bucket must be private.');
has(stateHardeningMigration, "POD1_DROP_POINT','POD2_GOODS_PLACED", 'Database must accept exactly the two required POD proof types.');
has(stateHardeningMigration, 'revoke all on public.ecoflow_day_state from anon', 'Anonymous shared-state access must be removed.');
has(stateHardeningMigration, 'ecoflow_can_write_day_scope', 'Shared-state writes must be role and scope constrained.');

// Web location tracking and driver declaration privacy.
has(tracker, '10 * 60 * 1000', 'Automatic web location persistence must use the ten-minute cadence.');
has(tracker, 'watchPosition', 'Driver web surface must use best-effort geolocation watch.');
has(tracker, "window.addEventListener('pageshow'", 'Returning from navigation must request a new point.');
has(ownerTracking, 'Driver position timeline', 'Owner must see a time-labelled location history.');
has(ownerTracking, 'staleMinutes > 10', 'Owner map must flag stale positions.');
has(ownerTracking, 'loadOwnerDriverLocationTimeline(businessDay, run.id)', 'Owner map must isolate samples to the active run ID.');
has(trackingMigration, 'ecoflow_can_view_driver_location', 'Location history must remain Owner/Admin gated.');
has(departure, 'Accept declaration and start route', 'Driver must explicitly accept the departure declaration.');
has(departure, 'locationConsent', 'Route-location consent must be explicit.');
has(departureRepo, 'ecoflow_record_driver_departure_acknowledgement', 'Departure acceptance must use a controlled RPC.');
has(ownerGovernance, 'Store delivery-notification emails', 'Owner must manage protected customer notification contacts.');
has(departureMigration, 'does not displace statutory', 'Declaration must not claim to waive statutory duties.');
has(notificationFunction, 'RESEND_API_KEY', 'Customer notices must use a server-side provider secret.');
lacks(notificationFunction, 'body.email', 'Browser must not provide arbitrary customer email recipients.');

// Ordermentum sync isolation.
has(cloudWorkflow, 'SYNC_MODE=orders_invoices', 'Scheduled sync must process only order and invoice deltas.');
has(cloudScript, "--overlap-minutes', '20'", 'Normal delta sync must use a narrow overlap.');
has(cloudScript, "--max-pages', '10'", 'Normal delta sync must have a bounded page limit.');
has(cloudScript, 'purchasers,price_groups', 'Store sync must remain isolated.');
has(cloudScript, 'products,variants', 'SKU sync must remain isolated.');
has(integrationPanel, 'Sync orders + invoices now', 'Owner must have a clear delta-sync action.');
has(integrationPanel, 'Sync stores', 'Owner must have an isolated store sync action.');
has(integrationPanel, 'Sync SKU', 'Owner must have an isolated SKU sync action.');

console.log('EcoFlow production workflow, canonical Product Identity warehouse authority, read-only Warehouse Map and visual SKU-order audit passed.');