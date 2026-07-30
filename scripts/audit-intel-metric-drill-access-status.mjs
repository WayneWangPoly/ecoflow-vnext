import assert from 'node:assert/strict';
import fs from 'node:fs';

const componentPath = 'src/features/intelligence/crossFilter/MetricDrillAccessStatus.tsx';
const presentationPath = 'src/features/intelligence/crossFilter/metricDrillAccessPresentationContract.ts';
const stylePath = 'src/features/intelligence/crossFilter/metricDrillAccessStatus.css';
const testPath = 'scripts/intel-metric-drill-access-status-contract.test.mjs';
const workspacePath = 'src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx';
const indexPath = 'src/features/intelligence/crossFilter/index.ts';
const packagePath = 'package.json';

for (const file of [componentPath, presentationPath, stylePath, testPath, workspacePath, indexPath, packagePath]) {
  assert.ok(fs.existsSync(file), `missing metric drill access status file: ${file}`);
}

const component = fs.readFileSync(componentPath, 'utf8');
const presentation = fs.readFileSync(presentationPath, 'utf8');
const style = fs.readFileSync(stylePath, 'utf8');
const tests = fs.readFileSync(testPath, 'utf8');
const workspace = fs.readFileSync(workspacePath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const designTokens = fs.readFileSync('src/features/intelligence/designSystem/tokens.css', 'utf8');
const dashboard = fs.readFileSync('src/features/dashboard/DashboardPage.tsx', 'utf8');
const pulse = fs.readFileSync('src/features/intelligence/operationalPulse/OperationalPulse.tsx', 'utf8');
const drillSurface = fs.readFileSync('src/features/intelligence/crossFilter/CrossFilterDrillSurface.tsx', 'utf8');
const app = fs.readFileSync('src/app/App.tsx', 'utf8');

for (const marker of [
  'MetricDrillAccessStatus',
  'repository = metricDrillAccessRepository',
  'repository.readMetricDrillAccess()',
  'metricDrillAccessFailure(error)',
  'setReloadVersion((version) => version + 1)',
  'Metric drill access',
  'Refresh access',
  'Metric drill access unavailable',
  'No metric drill access rows',
  'Metric drill access summary',
  '<table className="ef-metric-drill-access__table">',
  '<th scope="col">Declared dimensions</th>',
  '<th scope="col">Authorised dimensions</th>',
  'Authority metadata only · No KPI values, breakdowns or affected entities are read.',
]) {
  assert.ok(component.includes(marker), `missing metric drill access status marker: ${marker}`);
}

assert.equal(
  (component.match(/repository\.readMetricDrillAccess\(\)/g) ?? []).length,
  1,
  'metric drill access status must perform exactly one access read per load',
);
assert.equal(
  (component.match(/onClick=/g) ?? []).length,
  1,
  'metric drill access status may expose only the refresh interaction',
);

for (const forbidden of [
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /get_metric_drill_access/,
  /metric_value/i,
  /buildCrossFilterDrillModel/,
  /buildCrossFilterDrillPath/,
  /CrossFilterDrillSurface/,
  /useOverlayManager/,
  /onInspect/i,
  /onOpenOperationalRoute/,
  /Open workspace/i,
  /Inspect/i,
  /href=/,
  /<a\s/i,
  /navigate\s*\(/,
  /window\./,
  /document\./,
  /localStorage/,
  /sessionStorage/,
  /MutationObserver/,
  /CustomEvent/,
  /setTimeout/,
  /setInterval/,
  /Math\.random/,
]) {
  assert.ok(!forbidden.test(component), `metric drill access status scope expansion: ${forbidden}`);
}

for (const marker of [
  'metricDrillAccessSummary',
  'operationalPulseMetricKeys',
  "row.drillCapability === 'AVAILABLE'",
  "row.drillCapability === 'UNAVAILABLE'",
  "row.drillCapability === 'UNKNOWN'",
  'canonicalCoverage:',
  'readTimes.size === 1',
  "if (capability === 'AVAILABLE') return 'success'",
  "if (capability === 'UNKNOWN') return 'warning'",
  "timeZone: 'Australia/Adelaide'",
]) {
  assert.ok(presentation.includes(marker), `missing metric drill access presentation marker: ${marker}`);
}

for (const forbidden of [/react/i, /supabase/i, /\.schema\s*\(/, /\.rpc\s*\(/, /\.from\s*\(/, /metric_value/i, /window\./, /document\./]) {
  assert.ok(!forbidden.test(presentation), `metric drill access presentation scope expansion: ${forbidden}`);
}

for (const marker of [
  '.ef-metric-drill-access__actions',
  '.ef-metric-drill-access__summary',
  '.ef-metric-drill-access__table',
  '.ef-metric-drill-access__boundary',
  '@media (max-width: 920px)',
  '@media (max-width: 640px)',
  '@media (prefers-contrast: more)',
]) {
  assert.ok(style.includes(marker), `missing metric drill access style marker: ${marker}`);
}
for (const forbidden of ['!important', '@font-face', 'url(', '#root', '.orders-', '.warehouse-', '.delivery-']) {
  assert.ok(!style.includes(forbidden), `metric drill access style scope expansion: ${forbidden}`);
}

const publishedTokens = new Set(
  Array.from(designTokens.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
for (const reference of Array.from(style.matchAll(/var\((--ef-[a-z0-9-]+)/gi), (match) => match[1])) {
  assert.ok(publishedTokens.has(reference), `metric drill access status uses unpublished design token: ${reference}`);
}

for (const testName of [
  'current ten-metric access summary remains canonical and fully unavailable',
  'access summary separates available unavailable unknown and issue counts',
  'non-canonical coverage and mixed server timestamps remain explicit',
  'capability labels and tones remain bounded to governance states',
  'dimension and reason lists preserve exact server order without invention',
  'Adelaide timestamp formatting rejects invalid or missing timestamps',
]) {
  assert.ok(tests.includes(testName), `metric drill access status test missing: ${testName}`);
}

assert.ok(workspace.includes('MetricDrillAccessStatus'), 'metric drill access workspace import missing');
assert.equal(
  (workspace.match(/<MetricDrillAccessStatus \/>/g) ?? []).length,
  1,
  'Analytics workspace must adopt the metric drill access status exactly once',
);
for (const forbidden of ['metricDrillAccessRepository', 'readMetricDrillAccess', 'metricDrillAccessContract', 'get_metric_drill_access']) {
  assert.ok(!workspace.includes(forbidden), `Analytics workspace directly couples to drill access data: ${forbidden}`);
}

for (const marker of [
  'MetricDrillAccessStatus',
  'MetricDrillAccessStatusProps',
  'metricDrillAccessSummary',
  'metricDrillAccessCapabilityLabel',
  'formatMetricDrillAccessMoment',
]) {
  assert.ok(index.includes(marker), `metric drill access status export missing: ${marker}`);
}

for (const forbidden of ['MetricDrillAccessStatus', 'metricDrillAccessRepository', 'readMetricDrillAccess']) {
  assert.ok(!dashboard.includes(forbidden), `Dashboard adopted metric drill access status: ${forbidden}`);
  assert.ok(!pulse.includes(forbidden), `Operational Pulse card adopted metric drill access status: ${forbidden}`);
  assert.ok(!drillSurface.includes(forbidden), `Drill surface adopted metric drill access repository: ${forbidden}`);
  assert.ok(!app.includes(forbidden), `App adopted metric drill access status: ${forbidden}`);
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
assert.equal(typeof frontendAudit, 'string', 'audit:intel-frontend command missing');
assert.ok(
  frontendAudit.includes('audit-intel-metric-drill-access-status.mjs')
    && frontendAudit.includes('intel-metric-drill-access-status-contract.test.mjs'),
  'metric drill access status checks are not wired to audit:intel-frontend',
);

console.log('INTEL-UI-005D metric drill access status audit passed.');
