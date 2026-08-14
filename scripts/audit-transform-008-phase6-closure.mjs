import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => {
  assert.ok(fs.existsSync(path), `Missing ${path}`);
  return fs.readFileSync(path, 'utf8');
};

const app = read('src/app/App.tsx');
const analyticsIndex = read('src/features/intelligence/analytics/index.ts');
const healthIndex = read('src/features/intelligence/analytics/healthConsole/index.ts');
const workspace = read('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx');
const baseConsole = read('src/features/intelligence/analytics/healthConsole/AnalyticsHealthConsole.tsx');
const productivityIndex = read('src/features/intelligence/analytics/productivity/index.ts');
const panel = read('src/features/intelligence/analytics/productivity/PersonalisationProductivityPanel.tsx');
const exportPanel = read('src/features/intelligence/analytics/productivity/AuthoritativeExportPanel.tsx');
const comparisonRepository = read('src/data/repositories/comparisonCandidates.ts');
const exportRepository = read('src/data/repositories/authoritativeExport.ts');
const savedViewsRepository = read('src/data/repositories/savedViewRepository.ts');

assert.ok(app.includes("{ id: 'analytics', label: 'Analytics' }"), 'Desktop shell must retain the Analytics workspace control.');
assert.ok(app.includes('availableDesktopTabs(role).map((item) => ('), 'Desktop shell must derive visible workspace controls from the role-aware tab set.');
assert.ok(app.includes('onClick={() => setTab(item.id)}'), 'Desktop workspace controls must continue to select their governed tab through setTab.');
assert.ok(app.includes("{tab === 'analytics' ? <AnalyticsHealthConsole /> : null}"), 'Selecting Analytics must render the exported AnalyticsHealthConsole product workspace.');
assert.ok(analyticsIndex.includes("export * from './healthConsole';"), 'Analytics barrel must expose the health-console product workspace.');
assert.ok(healthIndex.includes('OperationalPulseReadinessWorkspace as AnalyticsHealthConsole'), 'AnalyticsHealthConsole must remain the governed OperationalPulseReadinessWorkspace alias.');
assert.ok(workspace.includes("import { PersonalisationProductivityPanel } from './productivity';"), 'Real Analytics product workspace must import the governed Phase 6 productivity surface.');
assert.equal((workspace.match(/<PersonalisationProductivityPanel\s*\/>/g) || []).length, 1, 'Real Analytics product workspace must render the Phase 6 productivity surface exactly once.');
assert.equal((baseConsole.match(/<PersonalisationProductivityPanel\s*\/>/g) || []).length, 0, 'Base health console must not duplicate the Phase 6 productivity surface.');
assert.ok(productivityIndex.includes("export { PersonalisationProductivityPanel } from './PersonalisationProductivityPanel';"), 'Productivity panel export missing.');

for (const marker of ['Saved Views', 'Quick Actions', 'Comparison Tray', 'Command palette']) {
  assert.ok(panel.includes(marker), `Phase 6 surface missing: ${marker}`);
}
assert.ok(panel.includes('<AuthoritativeExportPanel'), 'Authoritative Export must remain mounted in the Phase 6 surface.');
assert.ok(exportPanel.includes('Authoritative Export'), 'Authoritative Export surface missing.');

assert.ok(savedViewsRepository.includes(".schema('analytics').rpc(intelligenceSavedViewReadRpcName"), 'Saved Views must remain on server RPC authority.');
assert.ok(comparisonRepository.includes(".rpc('ecoflow_read_comparison_candidates_v1'"), 'Comparison Tray must remain on governed server candidates.');
assert.ok(exportRepository.includes("rpc('ecoflow_read_authoritative_export_v1'"), 'Export must remain server-authoritative.');

const browserAuthority = `${panel}\n${exportPanel}`;
for (const forbidden of [
  'Comparison entity ID',
  'setEntityId(',
  "permission: 'ALLOWED'",
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'XLSX',
]) {
  assert.ok(!browserAuthority.includes(forbidden), `Phase 6 closure forbids browser authority marker: ${forbidden}`);
}

for (const forbiddenRpc of [
  'ecoflow_set_account_release_hold_v1',
  'ecoflow_record_return_disposition_v1',
  'ecoflow_close_return_v1',
  'ecoflow_commit_actionable_exception_lifecycle',
]) {
  assert.ok(!browserAuthority.includes(forbiddenRpc), `Analytics productivity surface must not expose operational mutation RPC: ${forbiddenRpc}`);
}

console.log('TRANSFORM-008 Phase 6 closure audit passed.');
console.log('- Role-aware desktop shell retains the real Analytics workspace control.');
console.log('- Analytics export chain resolves to OperationalPulseReadinessWorkspace.');
console.log('- PersonalisationProductivityPanel is mounted exactly once in the real product workspace.');
console.log('- Saved Views, comparison and export remain governed server-authoritative capabilities.');
