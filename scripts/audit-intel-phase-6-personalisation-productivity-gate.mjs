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
const exportPanel = read(`${root}/AuthoritativeExportPanel.tsx`);
const style = read(`${root}/personalisationProductivityWorkspace.css`);
const savedViewRepository = read('src/data/repositories/savedViewRepository.ts');
const comparisonRepository = read('src/data/repositories/comparisonCandidates.ts');
const exportRepository = read('src/data/repositories/authoritativeExport.ts');
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const migration = read('supabase/migrations/20260731160000_intelligence_saved_views.sql');
const accessMigration = read('supabase/migrations/20260731160100_intelligence_saved_view_schema_access.sql');
const comparisonMigration = read('supabase/migrations/20260813190000_governed_comparison_candidates.sql');
const exportMigration = read('supabase/migrations/20260813200000_authoritative_export.sql');
const sqlTest = read('scripts/intelligence-saved-view-contract-test.sql');
const workflow = read('.github/workflows/intelligence-productivity-check.yml');

for (const packageId of ['INTEL-PER-001', 'INTEL-PER-002', 'INTEL-PER-003']) {
  assert.ok(panel.includes(packageId), `Phase 6 package missing: ${packageId}`);
}
assert.ok(exportPanel.includes('INTEL-PER-004'), 'Phase 6 authoritative export package missing: INTEL-PER-004');

for (const marker of ["'CREATE'","'DUPLICATE'","'RENAME'","'DELETE'","'SET_ROLE_DEFAULT'","'CLEAR_ROLE_DEFAULT'",'filters','sort','visibleColumns','dateRange','comparisonSettings','searchTerm']) {
  assert.ok(contract.includes(marker), `Phase 6 Saved View marker missing: ${marker}`);
}
for (const marker of ['create table analytics.intelligence_saved_view','get_intelligence_saved_views','apply_intelligence_saved_view_command','owner_user_id=v_user','role_scope=v_role',"v_role not in ('OWNER','ADMIN')",'enable row level security','revoke all on analytics.intelligence_saved_view from public,anon,authenticated']) {
  assert.ok(migration.includes(marker), `Phase 6 durable Saved View marker missing: ${marker}`);
}
assert.ok(accessMigration.includes('grant usage on schema analytics to authenticated'), 'Authenticated Saved View RPC schema usage missing');
assert.ok(accessMigration.includes('revoke all on analytics.intelligence_saved_view from public,anon,authenticated'), 'Saved View direct-table access was not re-locked');
for (const marker of ['Private Saved Views leaked across users','Viewer role default not visible','ROLE_DEFAULT_ADMIN_REQUIRED','Authenticated role must not access Saved View table directly']) {
  assert.ok(sqlTest.includes(marker), `Phase 6 Saved View contract test missing: ${marker}`);
}

for (const path of ['/control-room','/orders','/inventory','/customers','/delivery','/returns','/analytics']) {
  assert.ok(contract.includes(`path:'${path}'`) || contract.includes(`path: '${path}'`), `Phase 6 Quick Action missing: ${path}`);
}
for (const marker of ['Command palette','⌘/Ctrl K','quickActionDefinitions']) assert.ok(panel.includes(marker), `Phase 6 Quick Action presentation missing: ${marker}`);

for (const kind of ['CUSTOMER','COMMERCIAL_SKU','PHYSICAL_SKU','DELIVERY_RUN']) {
  assert.ok(contract.includes(`'${kind}'`), `Governed comparison kind missing: ${kind}`);
  assert.ok(comparisonMigration.includes(`'${kind}'`), `Comparison authority missing kind: ${kind}`);
}
for (const legacyKind of ['PRODUCT','STORE','ORDER','METRIC']) {
  assert.ok(!contract.includes(`'${legacyKind}'`), `Legacy ambiguous comparison kind remains: ${legacyKind}`);
}
for (const marker of ['CUSTOMER:2','COMMERCIAL_SKU:2','PHYSICAL_SKU:6','DELIVERY_RUN:2','TRAY_LIMIT_REACHED','DUPLICATE_ITEM','comparisonAlignment']) {
  assert.ok(contract.includes(marker), `Comparison contract boundary missing: ${marker}`);
}
assert.ok(panel.includes('Comparison Tray'), 'Governed Comparison Tray is not mounted');
assert.ok(panel.includes('comparisonRepository.readCandidates'), 'Comparison panel is not using governed candidate repository');
assert.ok(comparisonRepository.includes("rpc('ecoflow_read_comparison_candidates_v1'"), 'Governed candidate RPC missing');
assert.ok(comparisonRepository.includes("permission !== 'ALLOWED'"), 'Comparison repository is not fail closed');
assert.ok(!comparisonRepository.includes('.from('), 'Comparison repository crossed RPC-only boundary');
assert.ok(comparisonMigration.includes("l.identity_status='ACTIVE'") && comparisonMigration.includes("p.identity_status='ACTIVE'") && comparisonMigration.includes("r.route_status='LOCKED'"), 'Server eligibility filters missing');
assert.ok(!/Comparison entity ID|setEntityId\s*\(/.test(panel), 'Arbitrary comparison ID input returned');
assert.ok(!/permission\s*:\s*['"]ALLOWED['"]/.test(panel), 'Browser-declared comparison permission returned');

for (const marker of ['5_000','50','4_000',"text=`'${text}`",'ROW_LIMIT_EXCEEDED','NO_SELECTED_ROWS']) {
  assert.ok(contract.replaceAll(' ', '').includes(marker.replaceAll(' ', '')) || contract.includes(marker), `Dormant export safety contract missing: ${marker}`);
}
assert.ok(panel.includes('<AuthoritativeExportPanel'), 'Authoritative Export is not mounted');
for (const marker of ['Export current governed table','Export selected governed records','Export governed chart dataset']) assert.ok(exportPanel.includes(marker), `Authoritative export presentation missing: ${marker}`);
assert.ok(exportRepository.includes("rpc('ecoflow_read_authoritative_export_v1'"), 'Authoritative export RPC missing');
assert.ok(!exportRepository.includes('.from('), 'Authoritative export repository crossed RPC-only boundary');
for (const marker of ["('TABLE_VIEW','SELECTED_RECORDS','CHART_DATASET')",'public.ecoflow_read_comparison_candidates_v1','AUTHORITATIVE_EXPORT_SELECTOR_STALE_OR_FORBIDDEN','analytics.get_initial_kpi_shadow_projection',"public.ecoflow_active_app_role() not in ('OWNER','ADMIN')",'grant execute on function public.ecoflow_read_authoritative_export_v1']) {
  assert.ok(exportMigration.includes(marker), `Authoritative export server boundary missing: ${marker}`);
}
assert.ok(!/buildCsvExport\s*\(|saveCsv\s*\(/.test(`${panel}\n${exportPanel}`), 'Browser current-data CSV builder returned');
for (const forbidden of ['tableExportRows','selectedRecordExportRows','chartExportRows','exportColumns']) assert.ok(!`${exportRepository}\n${panel}\n${exportPanel}`.includes(forbidden), `Browser export authority detected: ${forbidden}`);

assert.ok(savedViewRepository.includes(".schema('analytics')"), 'Saved View repository is not using analytics RPC schema');
for (const forbidden of [/\.from\s*\(/,/\.insert\s*\(/,/\.update\s*\(/,/\.delete\s*\(/]) assert.ok(!forbidden.test(savedViewRepository), `Saved View repository crossed RPC-only boundary: ${forbidden}`);
assert.ok(workspace.includes('<PersonalisationProductivityPanel />'), 'Phase 6 productivity panel is not mounted in Analytics');
for (const marker of ['@media (max-width: 900px)','@media (max-width: 640px)','@media (prefers-reduced-motion: reduce)']) assert.ok(style.includes(marker), `Phase 6 responsive/accessibility marker missing: ${marker}`);
for (const forbidden of ['!important','@font-face','url(','#root']) assert.ok(!style.includes(forbidden), `Phase 6 style scope expansion: ${forbidden}`);

for (const marker of ['Audit Phase 6 completion gate','TypeScript check','Vite production bundle','Apply Saved View migrations','Execute Saved View privacy and role-default tests','Audit Saved View migration']) {
  assert.ok(workflow.includes(marker), `Phase 6 CI marker missing: ${marker}`);
}
for (const forbidden of ['localStorage','sessionStorage','indexedDB','xlsx','exceljs','sheetjs']) {
  assert.ok(!`${contract}\n${panel}\n${exportPanel}\n${savedViewRepository}\n${comparisonRepository}\n${exportRepository}`.toLowerCase().includes(forbidden.toLowerCase()), `Phase 6 forbidden persistence/dependency detected: ${forbidden}`);
}

console.log('INTEL-GATE-006 passed: durable Saved Views, Quick Actions, governed Comparison and authoritative Export are active.');
