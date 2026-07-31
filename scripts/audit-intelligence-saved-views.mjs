import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260731160000_intelligence_saved_views.sql';
const testPath = 'scripts/intelligence-saved-view-contract-test.sql';
assert.ok(fs.existsSync(migrationPath), 'Saved View migration missing');
assert.ok(fs.existsSync(testPath), 'Saved View SQL contract test missing');
const migration = fs.readFileSync(migrationPath, 'utf8');
const test = fs.readFileSync(testPath, 'utf8');

for (const marker of [
  'create table analytics.intelligence_saved_view',
  'enable row level security',
  'get_intelligence_saved_views',
  'apply_intelligence_saved_view_command',
  "'CREATE','DUPLICATE','RENAME','DELETE','SET_ROLE_DEFAULT','CLEAR_ROLE_DEFAULT'",
  'owner_user_id=v_user',
  'role_scope=v_role',
  "v_role not in ('OWNER','ADMIN')",
  'PRIVATE_LIMIT',
  'grant execute',
]) {
  assert.ok(migration.includes(marker), `Saved View migration marker missing: ${marker}`);
}
for (const forbidden of [
  /grant\s+(select|insert|update|delete).*authenticated/i,
  /grant\s+all.*authenticated/i,
]) {
  assert.ok(!forbidden.test(migration), `Saved View table browser grant detected: ${forbidden}`);
}
for (const marker of [
  'Private Saved Views leaked across users',
  'Viewer role default not visible',
  'ROLE_DEFAULT_ADMIN_REQUIRED',
  'Authenticated role must not access Saved View table directly',
]) {
  assert.ok(test.includes(marker), `Saved View test marker missing: ${marker}`);
}
console.log('INTEL-PER-001 Saved View database audit passed.');
