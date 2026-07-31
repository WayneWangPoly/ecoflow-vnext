import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260731190000_intelligence_release_control.sql';
assert.ok(fs.existsSync(migrationPath), `Missing migration: ${migrationPath}`);
const sql = fs.readFileSync(migrationPath, 'utf8');

for (const marker of [
  'analytics.intelligence_release_flag',
  'analytics.intelligence_release_check_definition',
  'analytics.intelligence_release_verification',
  'analytics.intelligence_release_event',
  'get_intelligence_release_readiness',
  'apply_intelligence_release_flag_command',
  'record_intelligence_release_verification',
  'INTELLIGENCE_RELEASE_CUTOVER_EVIDENCE_INCOMPLETE',
  'INTELLIGENCE_RELEASE_FLAG_VERSION_CONFLICT',
  'INTELLIGENCE_RELEASE_COMMAND_REPLAY_CONFLICT',
  'INTELLIGENCE_RELEASE_EVENT_IMMUTABLE',
  "rollout_state in ('OFF','SHADOW','ON')",
  "check_status in ('PASS','FAIL','BLOCKED','UNAVAILABLE')",
  "v_role in ('OWNER','ADMIN')",
  "p_expected_version",
  'for update',
  'command_fingerprint',
  'previous_state',
  'next_state',
]) {
  assert.ok(sql.toLowerCase().includes(marker.toLowerCase()), `Release control marker missing: ${marker}`);
}

for (const table of [
  'intelligence_release_flag',
  'intelligence_release_check_definition',
  'intelligence_release_verification',
  'intelligence_release_event',
]) {
  assert.ok(
    sql.includes(`alter table analytics.${table} enable row level security`),
    `RLS missing: ${table}`,
  );
  assert.ok(
    sql.includes(`revoke all on analytics.${table} from public,anon,authenticated,service_role`),
    `Direct access revoke missing: ${table}`,
  );
}

assert.equal((sql.match(/'control_room_v2'/g) ?? []).length >= 3, true, 'Control Room flag is not fully wired');
assert.equal((sql.match(/'METRIC_DEFINITION_APPROVED'/g) ?? []).length >= 2, true, 'Required check registry is incomplete');
assert.ok(sql.includes("coalesce(v.check_status,'UNAVAILABLE'::text)"), 'Missing verification must remain UNAVAILABLE');
assert.ok(!/coalesce\([^)]*,\s*0\)/i.test(sql), 'Release control must not convert missing evidence to numeric zero');
assert.ok(!/drop\s+(table|schema)/i.test(sql), 'Release control migration must not delete analytics history');

console.log('Intelligence release control migration audit passed.');
