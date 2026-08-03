import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const inspection = read('supabase/migrations/20260803140500_return_product_identity_inspection.sql');
const idempotency = read('supabase/migrations/20260803140600_return_command_idempotency.sql');
const repository = read('src/data/repositories/returnIdentity.ts');
const workspace = read('src/features/returns/NativeReturnsWorkspace.tsx');
const styles = read('src/features/returns/nativeReturnsWorkspace.css');
const core = read('src/features/operationalRoutes/NativeCoreOperationalWorkspace.tsx');
const shell = read('src/features/operationalStability/OperationalStabilityRouteV2.tsx');
const main = read('src/main.tsx');

has(inspection, 'ecoflow_delivery_return_identity_inspections', 'Return item inspection history is durable');
has(inspection, "ecoflow_validate_product_identity_scan(v_barcode, null, 'RETURN')", 'Return packages require published product identity');
has(inspection, 'UNSALEABLE_RETURN_CANNOT_RESTOCK', 'Unsaleable goods cannot be restocked');
has(inspection, 'RESTOCK_LOCATION_REQUIRED', 'Restock requires an explicit sellable location');
has(inspection, "'MAP_AND_RECEIVE'", 'Restock uses the governed inventory movement command');
has(inspection, 'stock_movement_recorded', 'Return inspection reports whether stock changed');
has(inspection, "'MIXED_DISPOSITION'", 'Mixed restock and disposal remains explicit');
lacks(inspection, "mapping_state = 'UNVERIFIED'", 'Return restock never accepts unverified product identity');

has(idempotency, 'ecoflow_delivery_return_commands', 'Return receipt has a durable command ledger');
has(idempotency, 'where c.command_id = p_command_id', 'Return receipt replay resolves by command ID');
has(idempotency, "'RECEIVE_RETURN'", 'Return command type is explicit');
lacks(idempotency, "scan_note = 'COMMAND:'", 'Idempotency does not depend on free-text notes');

has(repository, 'p_command_id: commandId()', 'Return client sends idempotency keys');
has(repository, 'ecoflow_receive_delivery_return', 'Return receipt uses a server command');
has(repository, 'ecoflow_inspect_delivery_return_item', 'Return inspection uses a server command');
has(repository, 'UNSALEABLE_RETURN_CANNOT_RESTOCK', 'Client explains unsafe restock rejection');

has(workspace, 'Receive Return Code', 'UI separates receipt from product inspection');
has(workspace, 'Inspect product package', 'UI captures package-level product evidence');
has(workspace, 'A verified stock movement will be created', 'UI previews inventory impact');
has(workspace, 'No stock movement will be created', 'UI previews disposal impact');
has(workspace, 'WarehouseCameraScanner', 'Returns support camera scanning');
lacks(workspace, 'window.confirm', 'Returns use in-app command surfaces');
lacks(workspace, 'window.alert', 'Returns use persistent command results');
has(styles, '@media (max-width: 460px)', 'Returns support narrow warehouse phones');
has(styles, '@media (prefers-reduced-motion: reduce)', 'Returns respect reduced-motion preference');

has(core, "workspace === 'returns'", 'Unified core owns Returns content');
has(shell, "pathname === '/returns'", 'Unified authenticated shell owns Returns route');
has(shell, "role === 'warehouse' && workspace === 'returns'", 'Warehouse access is explicit');
has(main, 'path="/returns"', 'React Router owns Returns instead of the legacy wildcard');

console.log('Return product identity audit passed (29 contracts).');
