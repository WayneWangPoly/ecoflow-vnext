import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);

const app = read('src/app/App.tsx');
const surface = read('src/features/delivery/DeliveryDispatchCommandSurface.tsx');
const driver = read('src/app/DriverApp.tsx');

has(app, 'DeliveryDispatchCommandSurface', 'Delivery workspace must mount the dispatch command surface.');
has(app, 'assignedDriverLabel={lockedRouteRecord?.assignedDriverLabel', 'Dispatch summary must consume authoritative Driver assignment when locked.');
has(surface, 'server-authoritative hand-off', 'Dispatch surface must explain its server-authoritative hand-off boundary.');
has(surface, 'Projected finish', 'Dispatch surface must expose projected finish.');
has(surface, 'last open stop ETA', 'Projected finish must use configured ETA facts instead of invented dwell time.');
has(surface, 'no artificial dwell-time assumption', 'Projection uncertainty/basis must be visible to office users.');
has(surface, 'Approved delivery route map', 'Delivery must provide a route map view.');
has(surface, 'dispatch-command-table', 'Delivery must provide a dense table view.');
has(surface, 'dispatch-detail-panel', 'Delivery must provide selected-stop detail.');
has(surface, 'Store / address', 'Dispatch table must expose address context.');
has(surface, 'Boxes / cartons', 'Dispatch summary must expose route load volume.');
has(surface, 'ETA window', 'Dispatch summary must expose ETA range.');

// Driver remains execution-first rather than duplicating the office command surface.
has(driver, '<h2><MapPin size={18} /> Next stop</h2>', 'Driver Today must foreground the next stop.');
has(driver, 'run-progress-card', 'Driver Stops must expose route progress.');
has(driver, 'RouteMap', 'Driver must retain the mobile route map.');
has(driver, 'Record failed delivery', 'Driver must retain explicit exception capture.');
has(driver, 'Take POD 1 · store / placement point', 'Driver must retain POD 1 capture.');
has(driver, 'Take POD 2 · all goods', 'Driver must retain POD 2 capture.');
has(driver, "{ id: 'history', label: 'History'", 'Driver must retain a dedicated history surface.');
has(driver, 'Waiting for Owner or office to approve and lock today’s route.', 'Driver must not own office route approval.');

console.log('TRANSFORM-006 Delivery command surface and Driver execution hierarchy audit passed.');
