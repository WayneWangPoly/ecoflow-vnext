import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`INTEL_DATA_004B_FILE_MISSING: ${relativePath}`);
  }
  return fs.readFileSync(absolute, 'utf8');
}

const migrationPath = 'supabase/migrations/20260730190000_actionable_exception_lifecycle_ledger.sql';
const testPath = 'scripts/actionable-exception-lifecycle-ledger-contract-test.sql';
const migration = read(migrationPath);
const test = read(testPath);
const workflow = read('.github/workflows/warehouse-productisation-check.yml');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  'analytics.actionable_exception_lifecycle',
  'analytics.actionable_exception_lifecycle_event',
  'analytics.ecoflow_can_write_actionable_exception_lifecycle',
  'analytics.apply_actionable_exception_lifecycle_command',
  'analytics.get_actionable_exception_lifecycle',
  'p_command_id uuid',
  'request_fingerprint text not null',
  'ACTIONABLE_EXCEPTION_COMMAND_ID_CONFLICT',
  'pg_advisory_xact_lock',
  'ACTIONABLE_EXCEPTION_SOURCE_NOT_ACTIVE',
  'ACTIONABLE_EXCEPTION_REOPEN_SOURCE_NOT_ACTIVE',
  'ACTIONABLE_EXCEPTION_EVENT_IMMUTABLE',
  'actionable_exception_event_immutable',
  "p.app_role in ('OWNER','ADMIN','ACCOUNT')",
  "lifecycle_status in ('OPEN','ACKNOWLEDGED','SNOOZED','RESOLVED')",
  "'ACKNOWLEDGE','ASSIGN','UNASSIGN','SNOOZE','UNSNOOZE'",
  "'RESOLVE','REOPEN','ADD_NOTE'",
  "interval '30 days'",
  "limit 50",
  "'AVAILABLE'::text as lifecycle_capability",
  "'AVAILABLE'::text as ownership_capability",
  "'AVAILABLE'::text as action_capability",
  "'AVAILABLE'::text as history_capability",
]) {
  if (!migration.includes(marker)) {
    throw new Error(`INTEL_DATA_004B_CONTRACT_MARKER_MISSING: ${marker}`);
  }
}

for (const forbiddenMarker of [
  "'DISMISS'",
  "'DELETE_EXCEPTION'",
  'analytics.data_quality_status',
  'ecoflow_day_state',
  'ecoflow_inventory_',
  'ecoflow_warehouse_',
  'ecoflow_delivery_',
  'fact_order',
  'fact_fulfilment',
  'fact_inventory',
  'fact_delivery',
  'fact_return',
]) {
  if (migration.includes(forbiddenMarker)) {
    throw new Error(`INTEL_DATA_004B_FORBIDDEN_SCOPE_MARKER: ${forbiddenMarker}`);
  }
}

const commandStart = migration.indexOf(
  'create or replace function analytics.apply_actionable_exception_lifecycle_command',
);
const commandEnd = migration.indexOf(
  'revoke all on function analytics.apply_actionable_exception_lifecycle_command',
  commandStart,
);
if (commandStart < 0 || commandEnd < 0) {
  throw new Error('INTEL_DATA_004B_COMMAND_BOUNDARY_MISSING');
}
const commandBody = migration.slice(commandStart, commandEnd);

for (const requiredWrite of [
  'insert into analytics.actionable_exception_lifecycle(',
  'update analytics.actionable_exception_lifecycle l',
  'insert into analytics.actionable_exception_lifecycle_event(',
]) {
  if (!commandBody.includes(requiredWrite)) {
    throw new Error(`INTEL_DATA_004B_REQUIRED_LEDGER_WRITE_MISSING: ${requiredWrite}`);
  }
}

for (const forbidden of [
  /\bdelete\s+from\b/i,
  /\btruncate\b/i,
  /\bmerge\s+into\b/i,
  /\bexecute\s+/i,
  /update\s+public\./i,
  /insert\s+into\s+public\./i,
  /delete\s+from\s+public\./i,
  /update\s+auth\./i,
  /insert\s+into\s+auth\./i,
  /delete\s+from\s+auth\./i,
  /severity\s*:=/i,
  /impact\s*:=/i,
  /due_at\s*:=/i,
]) {
  if (forbidden.test(commandBody)) {
    throw new Error(`INTEL_DATA_004B_FORBIDDEN_COMMAND_PATTERN: ${forbidden}`);
  }
}

if (!commandBody.includes('public.v_ecoflow_ordermentum_ui_active_exceptions')) {
  throw new Error('INTEL_DATA_004B_SOURCE_VERIFICATION_MISSING');
}
if (!commandBody.includes("v_action='REOPEN' and not v_source_found")) {
  throw new Error('INTEL_DATA_004B_REOPEN_SOURCE_GUARD_MISSING');
}
if (!commandBody.includes("'REPLAYED'::text") || !commandBody.includes("'APPLIED'::text")) {
  throw new Error('INTEL_DATA_004B_IDEMPOTENCY_RESULT_STATE_MISSING');
}

for (const directGrant of [
  'grant select on analytics.actionable_exception_lifecycle to authenticated',
  'grant insert on analytics.actionable_exception_lifecycle to authenticated',
  'grant update on analytics.actionable_exception_lifecycle to authenticated',
  'grant delete on analytics.actionable_exception_lifecycle to authenticated',
  'grant select on analytics.actionable_exception_lifecycle_event to authenticated',
  'grant insert on analytics.actionable_exception_lifecycle_event to authenticated',
]) {
  if (migration.toLowerCase().includes(directGrant)) {
    throw new Error(`INTEL_DATA_004B_DIRECT_BROWSER_TABLE_GRANT: ${directGrant}`);
  }
}

for (const testMarker of [
  'actionable exception lifecycle table missing',
  'actionable exception lifecycle event table missing',
  'actionable exception lifecycle command RPC missing',
  'actionable exception immutable event trigger missing',
  'owner_ack_ok',
  'replay_ok',
  'account_assign_ok',
  'snooze_ok',
  'unsnooze_ok',
  'resolve_ok',
  'reopen_ok',
  'note_ok',
  'viewer_read_ok',
  'event_count_ok',
  'ACTIONABLE_EXCEPTION_COMMAND_ID_CONFLICT',
  'ACTIONABLE_EXCEPTION_OWNER_ADMIN_OR_ACCOUNT_REQUIRED',
  'ACTIONABLE_EXCEPTION_SOURCE_NOT_ACTIVE',
  'ACTIONABLE_EXCEPTION_EVENT_IMMUTABLE',
]) {
  if (!test.includes(testMarker)) {
    throw new Error(`INTEL_DATA_004B_TEST_MARKER_MISSING: ${testMarker}`);
  }
}

if (!workflow.includes(migrationPath)
  || !workflow.includes('Execute actionable exception lifecycle ledger tests')
  || !workflow.includes(testPath)) {
  throw new Error('INTEL_DATA_004B_WORKFLOW_WIRING_MISSING');
}

const analyticsAudit = packageJson.scripts?.['audit:analytics'];
if (typeof analyticsAudit !== 'string'
  || !analyticsAudit.includes('audit-actionable-exception-lifecycle-ledger.mjs')) {
  throw new Error('INTEL_DATA_004B_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-DATA-004B actionable exception lifecycle ledger audit passed.');
