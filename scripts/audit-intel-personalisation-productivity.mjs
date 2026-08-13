import './audit-transform-008a-analytics-productivity-truth.mjs';
import './audit-transform-008b-governed-comparison.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) { assert.ok(fs.existsSync(path), `Phase 6 prerequisite missing: ${path}`); return fs.readFileSync(path, 'utf8'); }

const contract = read('src/features/intelligence/analytics/productivity/productivityContract.ts');
const repository = read('src/data/repositories/savedViewRepository.ts');
const comparisonRepository = read('src/data/repositories/comparisonCandidates.ts');
const panel = read('src/features/intelligence/analytics/productivity/PersonalisationProductivityPanel.tsx');
const style = read('src/features/intelligence/analytics/productivity/personalisationProductivityWorkspace.css');
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const migration = read('supabase/migrations/20260731160000_intelligence_saved_views.sql');
const sqlTest = read('scripts/intelligence-saved-view-contract-test.sql');

for (const marker of ["'CREATE'","'DUPLICATE'","'RENAME'","'DELETE'","'SET_ROLE_DEFAULT'","'CLEAR_ROLE_DEFAULT'",'filters','sort','visibleColumns','dateRange','comparisonSettings','searchTerm',"'CUSTOMER'","'COMMERCIAL_SKU'","'PHYSICAL_SKU'","'DELIVERY_RUN'",'buildCsvExport','validateQuickActions']) assert.ok(contract.includes(marker), `Phase 6 contract marker missing: ${marker}`);
for (const marker of ['Saved Views','Quick Actions','Command palette','⌘/Ctrl K','Comparison Tray']) assert.ok(panel.includes(marker), `Phase 6 governed presentation marker missing: ${marker}`);
for (const forbidden of ['Export current table view','Export selected records','Export current chart dataset']) assert.ok(!panel.includes(forbidden), `Withdrawn export presentation returned: ${forbidden}`);
assert.ok(!/permission\s*:\s*['"]ALLOWED['"]/.test(panel), 'Browser-declared comparison permission returned');
assert.ok(!/Comparison entity ID|setEntityId\s*\(/.test(panel), 'Arbitrary comparison candidate input returned');
assert.ok(!/buildCsvExport\s*\(|saveCsv\s*\(/.test(panel), 'Client-built current-data export returned');
assert.ok(panel.includes('comparisonRepository.readCandidates'), 'Comparison must use governed repository');
assert.ok(comparisonRepository.includes("rpc('ecoflow_read_comparison_candidates_v1'"), 'Comparison RPC missing');
assert.ok(workspace.includes('<PersonalisationProductivityPanel />'), 'Phase 6 panel is not mounted in Analytics');
assert.ok(repository.includes(".schema('analytics')"), 'Saved View repository must use analytics RPC schema');
for (const marker of ['analytics.intelligence_saved_view','get_intelligence_saved_views','apply_intelligence_saved_view_command','owner_user_id=v_user','role_scope=v_role',"app_role in ('OWNER','ADMIN','ACCOUNT','VIEWER')","v_role not in ('OWNER','ADMIN')",'enable row level security','revoke all on analytics.intelligence_saved_view from public,anon,authenticated']) assert.ok(migration.includes(marker), `Saved View database marker missing: ${marker}`);
for (const marker of ['Private Saved Views leaked across users','Viewer role default not visible','ROLE_DEFAULT_ADMIN_REQUIRED']) assert.ok(sqlTest.includes(marker), `Saved View database test marker missing: ${marker}`);
for (const forbidden of ['localStorage','sessionStorage','indexedDB','xlsx','exceljs','sheetjs']) assert.ok(!`${contract}\n${repository}\n${comparisonRepository}\n${panel}`.toLowerCase().includes(forbidden.toLowerCase()), `Phase 6 forbidden persistence/dependency marker: ${forbidden}`);
for (const marker of ['@media (max-width: 900px)','@media (max-width: 640px)','@media (prefers-reduced-motion: reduce)']) assert.ok(style.includes(marker), `Phase 6 responsive/accessibility marker missing: ${marker}`);
for (const forbidden of ['!important','@font-face','url(','#root']) assert.ok(!style.includes(forbidden), `Phase 6 style scope expansion: ${forbidden}`);
console.log('INTEL-PER production audit passed: Saved Views, Quick Actions and governed Comparison are active; current-data exports remain withdrawn pending 008C.');
