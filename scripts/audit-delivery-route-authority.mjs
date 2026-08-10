import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const app = read('src/app/App.tsx');
const driverWrapper = read('src/app/DriverApp.tsx');
const driverCore = read('src/app/DriverAppCore.tsx');
const sequencePanel = read('src/app/DriverRouteSequencePanel.tsx');
const repository = read('src/data/repositories/deliveryRouteAuthority.ts');
const driverDirectoryRepository = read('src/data/repositories/deliveryDispatchDrivers.ts');
const migration = read('supabase/migrations/20260809212500_delivery_route_authority.sql');
const assignmentMigration = read('supabase/migrations/20260809221000_delivery_route_driver_assignment.sql');
const directoryMigration = read('supabase/migrations/20260809221500_delivery_dispatch_driver_directory.sql');
const sequenceMigration = read('supabase/migrations/20260811010000_delivery_driver_execution_sequence.sql');
const replayMigration = read('supabase/migrations/20260811011000_delivery_driver_sequence_replay_consistency.sql');

// Office remains the sole dispatch authority: membership, immutable stop facts
// and Driver assignment are approved before the shared run becomes active.
has(app, 'buildLockedDeliveryRouteSnapshot', 'Office route approval must build the exact locked dispatch snapshot.');
has(app, 'await lockDeliveryRouteSnapshot', 'Office must cross the server dispatch-authority boundary before local lock state.');
has(app, 'assignedDriverUserId', 'Office route approval must require an explicit Driver assignment.');
has(app, 'loadActiveDispatchDrivers', 'Office must choose Driver identity from the controlled active Driver directory.');
has(app, 'No active Driver account is available.', 'Office must fail closed when no active Driver can be assigned.');
has(app, 'lockedRouteRecord?.assignedDriverLabel', 'Locked route UI must display the server-authoritative Driver assignment.');
has(app, 'await unlockDeliveryRouteSnapshot', 'Office unlock must supersede server dispatch authority before clearing local lock state.');

const lockStart = app.indexOf('async function lockRoute()');
const lockEnd = app.indexOf('async function unlockRoute()', lockStart);
assert.ok(lockStart >= 0 && lockEnd > lockStart, 'Office route lock function is missing.');
const lockBody = app.slice(lockStart, lockEnd);
const snapshotCall = lockBody.indexOf('await lockDeliveryRouteSnapshot');
const runActivation = lockBody.indexOf('await setActiveRunCode');
assert.ok(snapshotCall >= 0 && runActivation > snapshotCall, 'Server-authoritative dispatch snapshot + Driver assignment must exist before shared run activation.');
has(lockBody, 'assignedDriverUserId,', 'Office lock must send the selected Driver user ID to the authority RPC.');

// Stable Driver execution still begins from the assignment-scoped server route.
// The wrapper adds sequence controls but is not allowed to replace this loading
// boundary with broad Ordermentum/local reconstruction after office lock.
has(driverWrapper, 'DriverAppCore', 'Driver wrapper must preserve the proven execution core.');
has(driverWrapper, 'DriverRouteSequencePanel', 'Driver wrapper must expose the separate execution-sequence controller.');
has(driverCore, 'loadLockedDeliveryRouteSnapshot', 'Driver core must load the office-approved/effective route snapshot.');
has(driverCore, 'driverRunFromLockedSnapshot', 'Driver locked execution must be reconstructed from the server snapshot.');
has(driverCore, "if (!day.pick) return draftRun;", 'Local order reconstruction may only be used before office route lock.');
has(driverCore, 'if (lockedRoute) return driverRunFromLockedSnapshot(lockedRoute.snapshot);', 'Locked Driver execution must consume the authoritative server snapshot.');
has(driverCore, 'return { ...draftRun, stops: [], totalCartons: 0, readyStops: 0 };', 'Missing locked authority must fail closed instead of falling back to local orders.');
has(driverCore, 'Approved route snapshot is unavailable. Ask office to re-approve the route before departure.', 'Driver departure must fail closed when route authority is unavailable.');
lacks(driverWrapper, 'lockDeliveryRouteSnapshot(', 'Driver wrapper must never create dispatch authority.');
lacks(driverWrapper, 'unlockDeliveryRouteSnapshot(', 'Driver wrapper must never supersede dispatch authority.');
lacks(driverCore, 'lockDeliveryRouteSnapshot(', 'Driver core must never create dispatch authority.');
lacks(driverCore, 'unlockDeliveryRouteSnapshot(', 'Driver core must never supersede dispatch authority.');
lacks(sequencePanel, 'lockDeliveryRouteSnapshot(', 'Driver sequence controller must not acquire office route-lock authority.');
lacks(sequencePanel, 'unlockDeliveryRouteSnapshot(', 'Driver sequence controller must not acquire office unlock authority.');

// Execution order is intentionally a second, narrower server authority. Driver
// can reorder only assigned route members through CAS/idempotency; it cannot edit
// the immutable office snapshot, membership, addresses, cartons or assignment.
has(sequencePanel, 'loadDeliveryRouteExecutionSequence', 'Driver sequence UI must read the server execution authority.');
has(sequencePanel, 'reorderDeliveryRouteExecution', 'Driver sequence UI must write through the controlled reorder command.');
has(sequencePanel, 'expectedSequenceRevision', 'Driver sequence writes must carry an expected revision.');
has(sequencePanel, 'pendingIntent', 'Uncertain Driver reorder writes must retain stable retry intent.');
has(repository, "rpc('ecoflow_get_delivery_route_execution_sequence'", 'Execution sequence reads must use the controlled RPC.');
has(repository, "rpc('ecoflow_reorder_delivery_route_execution'", 'Execution sequence writes must use the controlled RPC.');
has(repository, 'p_expected_sequence_revision', 'Execution reorder repository must transmit the expected sequence revision.');
has(repository, 'p_command_id', 'Execution reorder repository must transmit an idempotency command ID.');
has(sequenceMigration, "v_role not in ('OWNER','ADMIN','ACCOUNT','DRIVER')", 'Only assigned Driver or governed office roles may reorder execution sequence.');
has(sequenceMigration, "v_role='DRIVER' and v_route.assigned_driver_user_id<>auth.uid()", 'Driver sequence mutation must be assignment-bound.');
has(sequenceMigration, 'ROUTE_SEQUENCE_REVISION_CONFLICT', 'Stale execution-sequence writers must fail closed.');
has(sequenceMigration, 'STOP_ORDER_ROUTE_MEMBERSHIP_MISMATCH', 'Driver reorder must be an exact permutation of approved route membership.');
has(sequenceMigration, 'STOP_ORDER_DUPLICATE_STOP', 'Driver reorder must reject duplicate stops.');
has(sequenceMigration, 'EXECUTED_STOP_POSITION_IMMUTABLE', 'Begun or closed stops must remain position-immutable.');
has(sequenceMigration, 'ecoflow_delivery_route_sequence_revisions', 'Execution-sequence history must be append-only and separately persisted.');
has(sequenceMigration, 'revoke all on table public.ecoflow_delivery_route_sequence_revisions', 'Browser roles must not directly mutate execution-sequence history.');
lacks(sequenceMigration, 'update public.ecoflow_delivery_route_snapshots', 'Driver execution reorder must not mutate the immutable dispatch snapshot.');
lacks(sequenceMigration, 'delete from public.ecoflow_delivery_route_snapshots', 'Driver execution reorder must not delete dispatch authority.');
has(replayMigration, 'ecoflow_delivery_route_snapshot_for_stop_order', 'Idempotent replay must render a snapshot from the exact historical command order.');
has(replayMigration, 'pre_replay_consistency_20260811', 'Canonical sequence mutation must remain private behind replay-consistency hardening.');

// Existing route/assignment repository boundaries remain controlled.
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
has(migration, 'ROUTE_ALREADY_LOCKED_DIFFERENT_SNAPSHOT', 'A changed dispatch route must not silently overwrite an approved snapshot.');
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

console.log('TRANSFORM-006 split dispatch + Driver execution-sequence authority audit passed.');
