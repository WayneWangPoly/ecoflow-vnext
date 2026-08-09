import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const app = read('src/app/App.tsx');
const driver = read('src/app/DriverApp.tsx');
const repository = read('src/data/repositories/deliveryRouteAuthority.ts');
const migration = read('supabase/migrations/20260809212500_delivery_route_authority.sql');

has(app, 'buildLockedDeliveryRouteSnapshot', 'Office route approval must build the exact locked snapshot.');
has(app, 'await lockDeliveryRouteSnapshot', 'Office must cross the server route-authority boundary before local lock state.');
has(app, 'await unlockDeliveryRouteSnapshot', 'Office unlock must supersede server route authority before clearing local lock state.');

const lockStart = app.indexOf('async function lockRoute()');
const lockEnd = app.indexOf('async function unlockRoute()', lockStart);
assert.ok(lockStart >= 0 && lockEnd > lockStart, 'Office route lock function is missing.');
const lockBody = app.slice(lockStart, lockEnd);
const snapshotCall = lockBody.indexOf('await lockDeliveryRouteSnapshot');
const runActivation = lockBody.indexOf('await setActiveRunCode');
assert.ok(snapshotCall >= 0 && runActivation > snapshotCall, 'Server-authoritative snapshot must exist before shared run activation.');

has(driver, 'loadLockedDeliveryRouteSnapshot', 'Driver must load the office-approved route snapshot.');
has(driver, 'driverRunFromLockedSnapshot', 'Driver locked execution must be reconstructed from the server snapshot.');
has(driver, "if (!day.pick) return draftRun;", 'Local order reconstruction may only be used before office route lock.');
has(driver, 'if (lockedRoute) return driverRunFromLockedSnapshot(lockedRoute.snapshot);', 'Locked Driver execution must consume the authoritative snapshot.');
has(driver, 'return { ...draftRun, stops: [], totalCartons: 0, readyStops: 0 };', 'Missing locked authority must fail closed instead of falling back to local orders.');
has(driver, 'Approved route snapshot is unavailable. Ask office to re-approve the route before departure.', 'Driver departure must fail closed when route authority is unavailable.');
lacks(driver, 'lockDeliveryRouteSnapshot(', 'Driver must never create route authority.');
lacks(driver, 'unlockDeliveryRouteSnapshot(', 'Driver must never supersede route authority.');

has(repository, "rpc('ecoflow_lock_delivery_route_snapshot'", 'Route lock must use the controlled RPC.');
has(repository, "rpc('ecoflow_get_locked_delivery_route_snapshot'", 'Driver route reads must use the controlled RPC.');
has(migration, "not in ('OWNER','ADMIN','ACCOUNT')", 'Only office roles may lock or unlock routes.');
has(migration, "not in ('OWNER','ADMIN','ACCOUNT','WAREHOUSE','DRIVER')", 'Driver route access must be explicitly read-only through the read RPC.');
has(migration, 'pg_advisory_xact_lock', 'Concurrent route lock/unlock mutations must serialize.');
has(migration, 'uq_ecoflow_delivery_route_one_locked', 'Only one active locked revision may exist per business day/run.');
has(migration, 'ROUTE_ALREADY_LOCKED_DIFFERENT_SNAPSHOT', 'A changed route must not silently overwrite an approved snapshot.');
has(migration, 'revoke all on table public.ecoflow_delivery_route_snapshots from public, anon, authenticated', 'Browser roles must not gain direct route snapshot DML.');

assert.equal(existsSync('scripts/transform-006-wire-route-authority.mjs'), false, 'Temporary source-rewrite script must not remain in the product branch.');
assert.equal(existsSync('.github/workflows/transform-006-wire-route-authority.yml'), false, 'Temporary source-rewrite workflow must not remain in the product branch.');

console.log('TRANSFORM-006 delivery route authority static audit passed.');
