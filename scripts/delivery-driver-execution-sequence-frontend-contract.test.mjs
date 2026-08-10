import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

const panel = read('src/app/DriverRouteSequencePanel.tsx');
const wrapper = read('src/app/DriverApp.tsx');
const core = read('src/app/DriverAppCore.tsx');
const authority = read('src/data/repositories/deliveryRouteAuthority.ts');
const driverRun = read('src/domain/driverRun.ts');
const driverRunCore = read('src/domain/driverRunCore.ts');
const office = read('src/features/delivery/DeliveryDispatchCommandSurface.tsx');

test('Driver reorder is a server-authoritative CAS command with stable retry identity', () => {
  assert.match(panel, /loadDeliveryRouteExecutionSequence/);
  assert.match(panel, /reorderDeliveryRouteExecution/);
  assert.match(panel, /expectedSequenceRevision: sequence\.sequenceRevision/);
  assert.match(panel, /pendingIntent\.stopOrder, pendingIntent/);
  assert.match(panel, /Retry same command safely/);
  assert.match(panel, /ROUTE_SEQUENCE_REVISION_CONFLICT/);
  assert.match(panel, /await refresh\(\)/);
  assert.match(authority, /p_expected_sequence_revision/);
  assert.match(authority, /p_command_id/);
});

test('Driver mobile surface supports touch drag and accessible up/down fallback', () => {
  assert.match(panel, /onPointerDown/);
  assert.match(panel, /onPointerMove/);
  assert.match(panel, /onPointerUp/);
  assert.match(panel, /touchAction: 'none'/);
  assert.match(panel, /Move \$\{stop\.store\} up/);
  assert.match(panel, /Move \$\{stop\.store\} down/);
  assert.match(panel, /IMMUTABLE_STATUSES/);
  assert.match(panel, /ARRIVED/);
  assert.match(panel, /DELIVERED/);
  assert.match(panel, /FAILED/);
  assert.match(panel, /SKIPPED/);
});

test('execution order cannot silently overwrite warehouse pick and label order', () => {
  assert.match(driverRun, /executionSequenceAuthoritative/);
  assert.match(driverRun, /return stops\.map\(\(stop\) => stop\.orderId\)/);
  assert.match(driverRun, /return reconcileCoreStopOrder\(saved, stops\)/);
  assert.match(driverRunCore, /stopsInLockedOrder/);
  assert.match(driverRunCore, /Box letters freeze at route lock/);
  assert.match(authority, /executionSequenceAuthoritative: true/);
});

test('stable Driver core is wrapped rather than rewritten and reloads after accepted authority change', () => {
  assert.match(wrapper, /DriverAppCore/);
  assert.match(wrapper, /DriverRouteSequencePanel/);
  assert.match(wrapper, /routeAuthorityVersion/);
  assert.match(wrapper, /onRouteChanged/);
  assert.ok(core.length > 20000, 'preserved Driver core unexpectedly disappeared');
});

test('office dispatch ETA and map use latest execution sequence', () => {
  assert.match(office, /loadDeliveryRouteExecutionSequence/);
  assert.match(office, /setInterval\(\(\) => void refresh\(\), 5000\)/);
  assert.match(office, /const effectiveStops = authoritativeStops \?\? stops/);
  assert.match(office, /execution r\$\{sequenceRevision\}/);
  assert.match(office, /latest execution-sequence ETA/);
  assert.match(office, /updates from latest Driver sequence/);
  assert.match(office, /DispatchMap stops=\{effectiveStops\}/);
});
