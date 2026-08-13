import './audit-intel-personalisation-productivity.mjs';
import './audit-intelligence-saved-views.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Phase 6 gate prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const root = 'src/features/intelligence/analytics/productivity';
const contract = read(`${root}/productivityContract.ts`);
const panel = read(`${root}/PersonalisationProductivityPanel.tsx`);
const style = read(`${root}/personalisationProductivityWorkspace.css`);
const repository = read('src/data/repositories/savedViewRepository.ts');
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const migration = read('supabase/migrations/20260731160000_intelligence_saved_views.sql');
const accessMigration = read('supabase/migrations/20260731160100_intelligence_saved_view_schema_access.sql');
const sqlTest = read('scripts/intelligence-saved-view-contract-test.sql');
const workflow = read('.github/workflows/intelligence-productivity-check.yml');
const documentation = read('docs/INTEL-PHASE-6-PERSONALISATION-PRODUCTIVITY.md');

const packages = ['INTEL-PER-001', 'INTEL-PER-002', 'INTEL-PER-003', 'INTEL-PER-004'];
for (const packageId of packages) {
  assert.ok(panel.includes(packageId) || documentation.includes(packageId), `Phase 6 package missing: ${packageId}`);
}

for (const marker of [
  "'CREATE'",
  "'DUPLICATE'",
  "'RENAME'",
  "'DELETE'",
  "'SET_ROLE_DEFAULT'",
  "'CLEAR_ROLE_DEFAULT'",
  'filters',
  'sort',
  'visibleColumns',
  'dateRange',
  'comparisonSettings',
  'searchTerm',
]) {
  assert.ok(contract.includes(marker), `Phase 6 Saved View marker missing: ${marker}`);
}

for (const marker of [
  'create table analytics.intelligence_saved_view',
  'get_intelligence_saved_views',
  'apply_intelligence_saved_view_command',
  'owner_user_id=v_user',
  'role_scope=v_role',
  "v_role not in ('OWNER','ADMIN')",
  'enable row level security',
  'revoke all on analytics.intelligence_saved_view from public,anon,authenticated',
]) {
  assert.ok(migration.includes(marker), `Phase 6 durable Saved View marker missing: ${marker}`);
}
assert.ok(accessMigration.includes('grant usage on schema analytics to authenticated'), 'Authenticated Saved View RPC schema usage missing');
assert.ok(accessMigration.includes('revoke all on analytics.intelligence_saved_view from public,anon,authenticated'), 'Saved View direct-table access was not re-locked');

for (const marker of [
  'Private Saved Views leaked across users',
  'Viewer role default not visible',
  'ROLE_DEFAULT_ADMIN_REQUIRED',
  'Authenticated role must not access Saved View table directly',
]) {
  assert.ok(sqlTest.includes(marker), `Phase 6 Saved View contract test missing: ${marker}`);
}

const quickPaths = ['/control-room', '/orders', '/inventory', '/customers', '/delivery', '/returns', '/analytics'];
for (const path of quickPaths) {
  assert.ok(contract.includes(`path: '${path}'`), `Phase 6 Quick Action missing: ${path}`);
}
for (const marker of ['Command palette', '⌘/Ctrl K', 'quickActionDefinitions']) {
  assert.ok(panel.includes(marker), `Phase 6 Quick Action presentation missing: ${marker}`);
}

// Historical comparison/export contracts remain available for future governed adapters,
// but TRANSFORM-008A intentionally withdraws their browser-authored production presentation.
const comparisonKinds = ['PRODUCT', 'CUSTOMER', 'STORE', 'ORDER', 'DELIVERY_RUN', 'METRIC'];
for (const kind of comparisonKinds) {
  assert.ok(contract.includes(`'${kind}'`), `Phase 6 comparison contract kind missing: ${kind}`);
}
for (const marker of ['maximum: 4', 'TRAY_LIMIT_REACHED', 'DUPLICATE_ITEM', 'comparisonAlignment', 'PERMISSION_']) {
  assert.ok(contract.includes(marker), `Phase 6 comparison contract boundary missing: ${marker}`);
}
for (const marker of ['5_000', '50', '4_000', "text = `'${text}`", 'ROW_LIMIT_EXCEEDED', 'NO_SELECTED_ROWS']) {
  assert.ok(contract.includes(marker), `Phase 6 export contract boundary missing: ${marker}`);
}
for (const forbidden of [
  'Side-by-side governed comparison',
  'Comparison Tray',
  'Export current table view',
  'Export selected records',
  'Export current chart dataset',
]) {
  assert.ok(!panel.includes(forbidden), `TRANSFORM-008A withdrawn production presentation returned: ${forbidden}`);
}
assert.ok(!/permission\s*:\s*['"]ALLOWED['"]/.test(panel), 'Browser-declared comparison permission returned');
assert.ok(!/Comparison entity ID|setEntityId\s*\(|createComparisonItem\s*\(|pinComparisonItem\s*\(/.test(panel), 'Browser-declared comparison candidate returned');
assert.ok(!/buildCsvExport\s*\(|saveCsv\s*\(/.test(panel), 'Client-built current-data export returned');

assert.ok(repository.includes(".schema('analytics')"), 'Saved View repository is not using analytics RPC schema');
assert.ok(repository.includes('intelligenceSavedViewReadRpcName'), 'Saved View read repository contract missing');
assert.ok(repository.includes('intelligenceSavedViewCommandRpcName'), 'Saved View command repository contract missing');
for (const forbidden of [/\.from\s*\(/, /\.insert\s*\(/, /\.update\s*\(/, /\.delete\s*\(/]) {
  assert.ok(!forbidden.test(repository), `Saved View repository crossed RPC-only boundary: ${forbidden}`);
}

assert.ok(workspace.includes('<PersonalisationProductivityPanel />'), 'Phase 6 productivity panel is not mounted in Analytics');
for (const marker of ['@media (max-width: 900px)', '@media (max-width: 640px)', '@media (prefers-reduced-motion: reduce)']) {
  assert.ok(style.includes(marker), `Phase 6 responsive/accessibility marker missing: ${marker}`);
}
for (const forbidden of ['!important', '@font-face', 'url(', '#root']) {
  assert.ok(!style.includes(forbidden), `Phase 6 style scope expansion: ${forbidden}`);
}

for (const marker of [
  'Audit Phase 6 completion gate',
  'TypeScript check',
  'Vite production bundle',
  'Apply Saved View migrations',
  'Execute Saved View privacy and role-default tests',
  'Audit Saved View migration',
]) {
  assert.ok(workflow.includes(marker), `Phase 6 CI marker missing: ${marker}`);
}

for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'xlsx', 'exceljs', 'sheetjs']) {
  assert.ok(!`${contract}\n${panel}\n${repository}`.toLowerCase().includes(forbidden.toLowerCase()), `Phase 6 forbidden persistence/dependency detected: ${forbidden}`);
}

for (const marker of [
  'all four roadmap packages',
  'private view belongs to one user',
  'role default belongs to one desktop role',
  'limited to four items',
  'Missing comparison values remain unavailable rather than becoming numeric zero',
  'limited to 5,000 rows',
  'XLSX is intentionally not included',
  'RPC-only browser access',
]) {
  assert.ok(documentation.toLowerCase().includes(marker.toLowerCase()), `Phase 6 documentation marker missing: ${marker}`);
}

console.log('INTEL-GATE-006 production truth gate passed: durable Saved Views and Quick Actions remain active; comparison/export contracts are retained but their browser-authored production presentation is withdrawn pending authoritative adapters.');
