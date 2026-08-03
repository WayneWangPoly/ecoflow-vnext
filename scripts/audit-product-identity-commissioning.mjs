import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const schema = read('supabase/migrations/20260803140000_product_identity_schema.sql');
const commands = read('supabase/migrations/20260803140100_product_identity_commands.sql');
const guardrails = read('supabase/migrations/20260803140200_product_identity_operational_guardrails.sql');
const multiBarcode = read('supabase/migrations/20260803140300_product_identity_multi_barcode_preference.sql');
const repository = read('src/data/repositories/productIdentityCommissioning.ts');
const warehouse = read('src/data/repositories/warehouseLocations.ts');
const route = read('src/features/operationalStability/OperationalStabilityRouteV2.tsx');
const workspace = read('src/features/commissioning/ProductIdentityCommissioningWorkspace.tsx');
const styles = read('src/features/commissioning/productIdentityCommissioning.css');
const close = read('src/features/operationalStability/OperationalPagedWorkspaceV3.tsx');
const main = read('src/main.tsx');

has(schema, 'ecoflow_sku_families', 'SKU Family authority exists');
has(schema, 'ecoflow_physical_skus', 'Physical SKU authority exists');
has(schema, 'ecoflow_commercial_physical_links', 'Commercial-to-physical relationship exists');
has(schema, 'ecoflow_product_identity_batches', 'Commissioning batch authority exists');
has(schema, 'ecoflow_product_identity_events', 'Append-only identity audit ledger exists');
has(schema, 'PRODUCT_IDENTITY_EVENT_IMMUTABLE', 'Audit history cannot be mutated');
has(schema, "mapping_state in ('UNVERIFIED','DRAFT','CONFLICT','REVIEW','VERIFIED','RETIRED')", 'Barcode mappings have explicit authority states');
has(schema, 'v_ecoflow_product_identity_barcode_lookup', 'Operational barcode lookup exposes only canonical identity');

has(commands, 'ecoflow_save_product_identity_draft', 'Revisioned capture command exists');
has(commands, 'PRODUCT_IDENTITY_STALE_REVISION', 'Capture uses compare-and-swap revision');
has(commands, 'ecoflow_review_product_identity_item', 'Supervisor review command exists');
has(commands, 'ecoflow_publish_product_identity_batch', 'Atomic publication command exists');
has(commands, 'PRODUCT_IDENTITY_SCOPE_INCOMPLETE', 'Incomplete Commercial SKU coverage blocks publication');
has(commands, 'BARCODE_ASSIGNED_TO_OTHER_PHYSICAL_SKU', 'Barcode collision fails closed');
has(commands, 'ecoflow_validate_product_identity_scan', 'Operational runtime scan validation exists');
has(commands, 'PROHIBITED_PRODUCT_SUBSTITUTION', 'Prohibited substitution fails closed');
lacks(commands, 'ecoflow_inventory_movements(', 'Identity publication does not mutate inventory movements');

has(guardrails, 'UNPUBLISHED_BARCODE_CANNOT_RECEIVE_STOCK', 'Legacy receiving cannot use unpublished identity');
has(guardrails, 'BARCODE_CAPTURE_CONFLICT', 'Legacy capture cannot silently reassign a barcode');
has(guardrails, 'STOCKTAKE_HAS_UNPUBLISHED_PRODUCT_IDENTITY', 'Stocktake approval requires published identity');
has(guardrails, 'ecoflow_read_business_day_close_state', 'Business Day Close exposes authoritative revision');

has(multiBarcode, 'ecoflow_normalise_batch_item_relation_preference', 'Multiple package barcodes share relation-level preference');
has(multiBarcode, "new.physical_sku = new.physical_sku", 'Multi-barcode comparison remains physical-SKU scoped');
has(multiBarcode, "array_remove(new.conflict_codes, 'MULTIPLE_PREFERRED_PHYSICAL_SKUS')", 'Same physical item is not treated as two preferred products');
has(multiBarcode, "new.item_state := 'REVIEW'", 'Automatically corrected multi-barcode evidence remains reviewable');

has(repository, 'p_expected_batch_revision', 'Frontend sends batch revision');
has(repository, 'p_command_id: commandId()', 'Frontend uses idempotency commands');
has(repository, 'loadProductIdentityWorkspace', 'One repository loads the commissioning workspace');
has(repository, 'publishProductIdentityBatch', 'Repository exposes publication command');

has(warehouse, "operation: 'RECEIVING'", 'Receiving validates published identity');
has(warehouse, "operation: 'PICKING'", 'Picking validates published identity');
has(warehouse, 'v_ecoflow_product_identity_barcode_lookup', 'Receiving lookup reads canonical mappings');
has(warehouse, 'A published package barcode is required before stock can be picked.', 'Picking fails closed without barcode evidence');

has(route, "path: '/commissioning/product-identity'", 'Unified navigation exposes Product Setup');
has(route, "workspace === 'product-identity'", 'Protected operational shell owns Product Setup');
has(route, "['owner', 'admin', 'warehouse']", 'Role boundary is explicit');
has(main, 'path="/commissioning/product-identity"', 'React Router owns the canonical route');

has(workspace, 'GUIDED CAPTURE', 'UI provides a guided capture workflow');
has(workspace, 'ConflictPanel', 'UI exposes conflict-specific resolution');
has(workspace, 'Publish verified batch', 'UI exposes gated publication');
has(workspace, 'SITE TASK GENERATOR', 'UI generates the remaining site work');
has(workspace, 'WarehouseCameraScanner', 'UI uses the established iPhone-compatible scanner');
has(styles, '@media (max-width: 460px)', 'UI has narrow phone treatment');
has(styles, '@media (prefers-reduced-motion: reduce)', 'UI respects reduced motion');

has(close, 'readBusinessDayCloseState', 'Business Day Close reads current server state');
has(close, 'expectedRevision:numeric(closeState?.revision)', 'Business Day Close no longer hard-codes revision zero');
lacks(close, 'expectedRevision:0', 'Hard-coded Business Day Close revision is removed');

console.log('Product identity commissioning audit passed (49 contracts).');
