import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => {
  assert.ok(fs.existsSync(path), `Missing ${path}`);
  return fs.readFileSync(path, 'utf8');
};

const app = read('src/app/App.tsx');
const analyticsIndex = read('src/features/intelligence/analytics/index.ts');
const consoleSource = read('src/features/intelligence/analytics/healthConsole/AnalyticsHealthConsole.tsx');
const productivityIndex = read('src/features/intelligence/analytics/productivity/index.ts');
const panel = read('src/features/intelligence/analytics/productivity/PersonalisationProductivityPanel.tsx');
const exportPanel = read('src/features/intelligence/analytics/productivity/AuthoritativeExportPanel.tsx');
const comparisonRepository = read('src/data/repositories/comparisonCandidates.ts');
const exportRepository = read('src/data/repositories/authoritativeExport.ts');
const savedViewsRepository = read('src/data/repositories/savedViewRepository.ts');

assert.ok(app.includes("{tab === 'analytics' ? <AnalyticsHealthConsole /> : null}"), 'Analytics desktop route must render AnalyticsHealthConsole.');
assert.ok(analyticsIndex.includes("export { AnalyticsHealthConsole } from './healthConsole/AnalyticsHealthConsole';"), 'Analytics route export missing.');
assert.ok(productivityIndex.includes("export { PersonalisationProductivityPanel } from './PersonalisationProductivityPanel';"), 'Productivity panel export missing.');
assert.ok(consoleSource.includes("import { PersonalisationProductivityPanel } from '../productivity';"), 'Analytics console must import the governed Phase 6 productivity surface.');
assert.equal((consoleSource.match(/<PersonalisationProductivityPanel\s*\/>/g) || []).length, 1, 'Analytics console must render the Phase 6 productivity surface exactly once.');

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
