import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Phase 6 prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const contract = read('src/features/intelligence/analytics/productivity/productivityContract.ts');
const repository = read('src/data/repositories/savedViewRepository.ts');
const panel = read('src/features/intelligence/analytics/productivity/PersonalisationProductivityPanel.tsx');
const style = read('src/features/intelligence/analytics/productivity/personalisationProductivityWorkspace.css');
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const migration = read('supabase/migrations/20260731160000_intelligence_saved_views.sql');
const sqlTest = read('scripts/intelligence-saved-view-contract-test.sql');

for (const marker of [
  "'CREATE'", "'DUPLICATE'", "'RENAME'", "'DELETE'", "'SET_ROLE_DEFAULT'", "'CLEAR_ROLE_DEFAULT'",
  'filters', 'sort', 'visibleColumns', 'dateRange', 'comparisonSettings', 'searchTerm',
  "'PRODUCT'", "'CUSTOMER'", "'STORE'", "'ORDER'", "'DELIVERY_RUN'", "'METRIC'",
  'maximum: 4', '5_000', '50', '4_000', 'buildCsvExport', 'validateQuickActions',
]) {
  assert.ok(contract.includes(marker), `Phase 6 contract marker missing: ${marker}`);
}

for (const marker of [
  'Saved Views', 'Quick Actions', 'Comparison Tray', 'Bounded CSV Export',
  'Command palette', '⌘/Ctrl K', 'Export current table view', 'Export selected records',
  'Export current chart dataset', 'spreadsheet formula protection',
]) {
  assert.ok(panel.includes(marker), `Phase 6 presentation marker missing: ${marker}`);
}

assert.ok(workspace.includes('<PersonalisationProductivityPanel />'), 'Phase 6 panel is not mounted in Analytics');
assert.ok(repository.includes(".schema('analytics')"), 'Saved View repository must use analytics RPC schema');
assert.ok(repository.includes('intelligenceSavedViewReadRpcName'), 'Saved View read RPC missing');
assert.ok(repository.includes('intelligenceSavedViewCommandRpcName'), 'Saved View command RPC missing');

for (const marker of [
  'analytics.intelligence_saved_view',
  'get_intelligence_saved_views',
  'apply_intelligence_saved_view_command',
  'owner_user_id=v_user',
  'role_scope=v_role',
  "app_role in ('OWNER','ADMIN','ACCOUNT','VIEWER')",
  "v_role not in ('OWNER','ADMIN')",
  'enable row level security',
  'revoke all on analytics.intelligence_saved_view from public,anon,authenticated',
]) {
  assert.ok(migration.includes(marker), `Saved View database marker missing: ${marker}`);
}

for (const marker of ['Private Saved Views leaked across users', 'Viewer role default not visible', 'ROLE_DEFAULT_ADMIN_REQUIRED']) {
  assert.ok(sqlTest.includes(marker), `Saved View database test marker missing: ${marker}`);
}

for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'xlsx', 'exceljs', 'sheetjs']) {
  assert.ok(!`${contract}\n${repository}\n${panel}`.toLowerCase().includes(forbidden.toLowerCase()), `Phase 6 forbidden persistence/dependency marker: ${forbidden}`);
}
for (const forbidden of [/\.from\s*\(/, /\.insert\s*\(/, /\.update\s*\(/, /\.delete\s*\(/]) {
  assert.ok(!forbidden.test(repository), `Saved View repository crossed RPC-only boundary: ${forbidden}`);
}
for (const marker of ['@media (max-width: 900px)', '@media (max-width: 640px)', '@media (prefers-reduced-motion: reduce)']) {
  assert.ok(style.includes(marker), `Phase 6 responsive/accessibility marker missing: ${marker}`);
}
for (const forbidden of ['!important', '@font-face', 'url(', '#root']) {
  assert.ok(!style.includes(forbidden), `Phase 6 style scope expansion: ${forbidden}`);
}

console.log('INTEL-PER-001 through INTEL-PER-004 personalisation and productivity audit passed.');
