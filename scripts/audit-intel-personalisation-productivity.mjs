import './audit-transform-008a-analytics-productivity-truth.mjs';
import './audit-transform-008b-governed-comparison.mjs';
import './audit-transform-008c-authoritative-export.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) { assert.ok(fs.existsSync(path), `Phase 6 prerequisite missing: ${path}`); return fs.readFileSync(path, 'utf8'); }

const contract = read('src/features/intelligence/analytics/productivity/productivityContract.ts');
const repository = read('src/data/repositories/savedViewRepository.ts');
const comparisonRepository = read('src/data/repositories/comparisonCandidates.ts');
const exportRepository = read('src/data/repositories/authoritativeExport.ts');
const panel = read('src/features/intelligence/analytics/productivity/PersonalisationProductivityPanel.tsx');
const exportPanel = read('src/features/intelligence/analytics/productivity/AuthoritativeExportPanel.tsx');
const style = read('src/features/intelligence/analytics/productivity/personalisationProductivityWorkspace.css');
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const migration = read('supabase/migrations/20260731160000_intelligence_saved_views.sql');
const exportMigration = read('supabase/migrations/20260813200000_authoritative_export.sql');
const sqlTest = read('scripts/intelligence-saved-view-contract-test.sql');

for (const marker of ["'CREATE'","'DUPLICATE'","'RENAME'","'DELETE'","'SET_ROLE_DEFAULT'","'CLEAR_ROLE_DEFAULT'",'filters','sort','visibleColumns','dateRange','comparisonSettings','searchTerm',"'CUSTOMER'","'COMMERCIAL_SKU'","'PHYSICAL_SKU'","'DELIVERY_RUN'",'buildCsvExport','validateQuickActions']) assert.ok(contract.includes(marker), `Phase 6 contract marker missing: ${marker}`);
for (const marker of ['Saved Views','Quick Actions','Command palette','⌘/Ctrl K','Comparison Tray','<AuthoritativeExportPanel']) assert.ok(panel.includes(marker), `Phase 6 governed presentation marker missing: ${marker}`);
for (const marker of ['INTEL-PER-004','Export current governed table','Export selected governed records','Export governed chart dataset']) assert.ok(exportPanel.includes(marker), `Phase 6 authoritative export presentation marker missing: ${marker}`);
assert.ok(!/permission\s*:\s*['"]ALLOWED['"]/.test(panel), 'Browser-declared comparison permission returned');
assert.ok(!/Comparison entity ID|setEntityId\s*\(/.test(panel), 'Arbitrary comparison candidate input returned');
assert.ok(!/buildCsvExport\s*\(|saveCsv\s*\(/.test(`${panel}\n${exportPanel}`), 'Client-built current-data export returned');
assert.ok(panel.includes('comparisonRepository.readCandidates'), 'Comparison must use governed repository');
assert.ok(comparisonRepository.includes("rpc('ecoflow_read_comparison_candidates_v1'"), 'Comparison RPC missing');
assert.ok(exportRepository.includes("rpc('ecoflow_read_authoritative_export_v1'"), 'Authoritative export RPC missing');
assert.ok(!exportRepository.includes('.from('), 'Authoritative export repository crossed RPC-only boundary');
assert.ok(exportMigration.includes('analytics.get_initial_kpi_shadow_projection'), 'Chart dataset export is not server-resolved');
assert.ok(exportMigration.includes('AUTHORITATIVE_EXPORT_SELECTOR_STALE_OR_FORBIDDEN'), 'Selected export is not fail closed on stale selectors');
assert.ok(workspace.includes('<PersonalisationProductivityPanel />'), 'Phase 6 panel is not mounted in Analytics workspace');
assert.ok(repository.includes(".schema('analytics')"), 'Saved View repository must use analytics RPC schema');
for (const marker of ['analytics.intelligence_saved_view','get_intelligence_saved_views','apply_intelligence_saved_view_command','owner_user_id=v_user','role_scope=v_role',"app_role in ('OWNER','ADMIN','ACCOUNT','VIEWER')","v_role not in ('OWNER','ADMIN')",'enable row level security','revoke all on analytics.intelligence_saved_view from public,anon,authenticated']) assert.ok(migration.includes(marker), `Saved View database marker missing: ${marker}`);
for (const marker of ['Private Saved Views leaked across users','Viewer role default not visible','ROLE_DEFAULT_ADMIN_REQUIRED']) assert.ok(sqlTest.includes(marker), `Saved View database test marker missing: ${marker}`);
for (const forbidden of ['localStorage','sessionStorage','indexedDB','xlsx','exceljs','sheetjs','tableExportRows','selectedRecordExportRows','chartExportRows','exportColumns']) assert.ok(!`${contract}\n${repository}\n${comparisonRepository}\n${exportRepository}\n${panel}\n${exportPanel}`.toLowerCase().includes(forbidden.toLowerCase()), `Phase 6 forbidden persistence/dependency/authority marker: ${forbidden}`);
for (const marker of ['@media (max-width: 900px)','@media (max-width: 640px)','@media (prefers-reduced-motion: reduce)']) assert.ok(style.includes(marker), `Phase 6 responsive/accessibility marker missing: ${marker}`);
for (const forbidden of ['!important','@font-face','url(','#root']) assert.ok(!style.includes(forbidden), `Phase 6 style scope expansion: ${forbidden}`);
console.log('INTEL-PER production audit passed: Saved Views, Quick Actions, governed Comparison and authoritative server-resolved exports are active.');
