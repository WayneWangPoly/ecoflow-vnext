import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const app = read('src/app/App.tsx');
const driver = read('src/app/DriverApp.tsx');
const repository = read('src/data/repositories/deliveryRouteAuthority.ts');
const driverDirectoryRepository = read('src/data/repositories/deliveryDispatchDrivers.ts');
const migration = read('supabase/migrations/20260809212500_delivery_route_authority.sql');
const assignmentMigration = read('supabase/migrations/20260809221000_delivery_route_driver_assignment.sql');
const directoryMigration = read('supabase/migrations/20260809221500_delivery_dispatch_driver_directory.sql');

has(app, 'buildLockedDeliveryRouteSnapshot', 'Office route approval must build the exact locked snapshot.');
has(app, 'await lockDeliveryRouteSnapshot', 'Office must cross the server route-authority boundary before local lock state.');
has(app, 'assignedDriverUserId', 'Office route approval must require an explicit Driver assignment.');
has(app, 'loadActiveDispatchDrivers', 'Office must choose Driver identity from the controlled active Driver directory.');
has(app, 'No active Driver account is available.', 'Office must fail closed when no active Driver can be assigned.');
has(app, 'lockedRouteRecord?.assignedDriverLabel', 'Locked route UI must display the server-authoritative Driver assignment.');
has(app, 'await unlockDeliveryRouteSnapshot', 'Office unlock must supersede server route authority before clearing local lock state.');

const lockStart = app.indexOf('async function lockRoute()');
const lockEnd = app.indexOf('async function unlockRoute()', lockStart);
assert.ok(lockStart >= 0 && lockEnd > lockStart, 'Office route lock function is missing.');
const lockBody = app.slice(lockStart, lockEnd);
const snapshotCall = lockBody.indexOf('await lockDeliveryRouteSnapshot');
const runActivation = lockBody.indexOf('await setActiveRunCode');
assert.ok(snapshotCall >= 0 && runActivation > snapshotCall, 'Server-authoritative snapshot + Driver assignment must exist before shared run activation.');
has(lockBody, 'assignedDriverUserId,', 'Office lock must send the selected Driver user ID to the authority RPC.');

has(driver, 'loadLockedDeliveryRouteSnapshot', 'Driver must load the office-approved route snapshot.');
has(driver, 'driverRunFromLockedSnapshot', 'Driver locked execution must be reconstructed from the server snapshot.');
has(driver, "if (!day.pick) return draftRun;", 'Local order reconstruction may only be used before office route lock.');
has(driver, 'if (lockedRoute) return driverRunFromLockedSnapshot(lockedRoute.snapshot);', 'Locked Driver execution must consume the authoritative snapshot.');
has(driver, 'return { ...draftRun, stops: [], totalCartons: 0, readyStops: 0 };', 'Missing locked authority must fail closed instead of falling back to local orders.');
has(driver, 'Approved route snapshot is unavailable. Ask office to re-approve the route before departure.', 'Driver departure must fail closed when route authority is unavailable.');
lacks(driver, 'lockDeliveryRouteSnapshot(', 'Driver must never create route authority.');
lacks(driver, 'unlockDeliveryRouteSnapshot(', 'Driver must never supersede route authority.');

has(repository, "rpc('ecoflow_lock_delivery_route_snapshot_v2'", 'Route lock must use the assignment-aware controlled RPC.');
has(repository, 'p_assigned_driver_user_id: driverId', 'Route repository must transmit only Driver user ID; label remains server-derived.');
has(repository, "rpc('ecoflow_get_assigned_delivery_route_snapshot'", 'Driver route reads must use the assignment-aware controlled RPC.');
has(repository, 'assignedDriverUserId', 'Route record must retain the authoritative Driver user ID.');
has(repository, 'assignedDriverLabel', 'Route record must retain the server-derived Driver label.');
lacks(repository, "rpc('ecoflow_lock_delivery_route_snapshot',", 'Client repository must not expose the unassigned v1 lock API.');
lacks(repository, "rpc('ecoflow_get_locked_delivery_route_snapshot',", 'Client repository must not expose the unassigned v1 read API.');

has(driverDirectoryRepository, "rpc('ecoflow_list_active_dispatch_drivers'", 'Dispatch Driver selection must use the minimal office directory RPC.');
has(directoryMigration, "not in ('OWNER','ADMIN','ACCOUNT')", 'Only office roles may list dispatch Drivers.');
has(directoryMigration, "upper(coalesce(app_role,''))='DRIVER'", 'Dispatch directory must include Driver accounts only.');
has(directoryMigration, "upper(coalesce(team_status,''))='ACTIVE'", 'Dispatch directory must include active team status only.');

has(migration, "not in ('OWNER','ADMIN','ACCOUNT')", 'Only office roles may lock or unlock routes.');
has(migration, 'pg_advisory_xact_lock', 'Concurrent route lock/unlock mutations must serialize.');
has(migration, 'uq_ecoflow_delivery_route_one_locked', 'Only one active locked revision may exist per business day/run.');
has(migration, 'ROUTE_ALREADY_LOCKED_DIFFERENT_SNAPSHOT', 'A changed route must not silently overwrite an approved snapshot.');
has(migration, 'revoke all on table public.ecoflow_delivery_route_snapshots from public, anon, authenticated', 'Browser roles must not gain direct route snapshot DML.');

has(assignmentMigration, 'public.ecoflow_active_dispatch_driver_label', 'Server must resolve assignment against the active Driver directory.');
has(assignmentMigration, "upper(coalesce(app_role,''))='DRIVER'", 'Assignment validation must reject non-Driver accounts.');
has(assignmentMigration, "upper(coalesce(team_status,''))='ACTIVE'", 'Assignment validation must reject inactive Driver accounts.');
has(assignmentMigration, 'ROUTE_ALREADY_LOCKED_DIFFERENT_DRIVER', 'A locked route must not silently change Driver assignment.');
has(assignmentMigration, "v_role='DRIVER' and v_route.assigned_driver_user_id<>auth.uid()", 'Driver reads must be constrained to auth.uid() assignment.');
has(assignmentMigration, "message='DRIVER_ROUTE_ASSIGNMENT_REQUIRED'", 'Cross-Driver route reads must fail with an authorization error.');
has(assignmentMigration, 'revoke execute on function public.ecoflow_lock_delivery_route_snapshot(date,text,jsonb) from authenticated', 'The unassigned v1 lock API must be revoked from authenticated clients.');
has(assignmentMigration, 'revoke execute on function public.ecoflow_get_locked_delivery_route_snapshot(date,text) from authenticated', 'The unassigned v1 read API must be revoked from authenticated clients.');

assert.equal(existsSync('scripts/transform-006-wire-route-authority.mjs'), false, 'Temporary source-rewrite script must not remain in the product branch.');
assert.equal(existsSync('.github/workflows/transform-006-wire-route-authority.yml'), false, 'Temporary source-rewrite workflow must not remain in the product branch.');

console.log('TRANSFORM-006 delivery route + Driver assignment authority audit passed.');
