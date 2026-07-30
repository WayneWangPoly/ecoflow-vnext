import assert from 'node:assert/strict';
import fs from 'node:fs';

const contractPath = 'src/features/intelligence/crossFilter/metricDrillAccessContract.ts';
const repositoryPath = 'src/data/repositories/metricDrillAccessRepository.ts';
const indexPath = 'src/features/intelligence/crossFilter/index.ts';
const testPath = 'scripts/intel-metric-drill-access-repository-contract.test.mjs';
const packagePath = 'package.json';

for (const file of [contractPath, repositoryPath, indexPath, testPath, packagePath]) {
  assert.ok(fs.existsSync(file), `missing metric drill access repository file: ${file}`);
}

const contract = fs.readFileSync(contractPath, 'utf8');
const repository = fs.readFileSync(repositoryPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const tests = fs.readFileSync(testPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const dashboard = fs.readFileSync('src/features/dashboard/DashboardPage.tsx', 'utf8');
const pulse = fs.readFileSync('src/features/intelligence/operationalPulse/OperationalPulse.tsx', 'utf8');
const surface = fs.readFileSync('src/features/intelligence/crossFilter/CrossFilterDrillSurface.tsx', 'utf8');
const app = fs.readFileSync('src/app/App.tsx', 'utf8');

for (const marker of [
  "metricDrillAccessRpcName = 'get_metric_drill_access'",
  'operationalPulseMetricKeys',
  "MetricDrillAccessCapability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN'",
  "metricStatus === 'ACTIVE'",
  "projection === 'READY'",
  'safeAuthorised.length > 0',
  'safeReasons.length === 0',
  "capability = 'UNKNOWN'",
  'safeAuthorised = []',
  "code: 'AUTHORISED_DIMENSION_MISMATCH'",
  "code: 'AVAILABLE_INVARIANT_MISMATCH'",
  "code: 'UNAVAILABLE_DIMENSION_LEAK'",
  "code: 'READ_TIMESTAMP_MISMATCH'",
  "code: 'MISSING_METRIC_KEY'",
  "code: 'NON_CANONICAL_ORDER'",
  'rows.sort(',
  'metricDrillAccessFailure',
]) {
  assert.ok(contract.includes(marker), `missing metric drill access contract marker: ${marker}`);
}

for (const forbidden of [
  /react/i,
  /\.tsx\b/i,
  /\.css\b/i,
  /supabase/i,
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /metric_value/i,
  /breakdown_values?/i,
  /affected_entit(?:y|ies)/i,
  /localStorage/,
  /sessionStorage/,
  /window\./,
  /document\./,
]) {
  assert.ok(!forbidden.test(contract), `metric drill access contract scope expansion: ${forbidden}`);
}

for (const marker of [
  'createMetricDrillAccessRepository',
  'readMetricDrillAccess: () => Promise<MetricDrillAccessResult>',
  ".schema('analytics')",
  '.rpc(metricDrillAccessRpcName)',
  'normaliseMetricDrillAccessRows(result.data)',
  'metricDrillAccessFailure(result.error)',
  "code: 'NOT_CONFIGURED'",
]) {
  assert.ok(repository.includes(marker), `missing metric drill access repository marker: ${marker}`);
}

assert.equal(
  (repository.match(/\.rpc\s*\(/g) ?? []).length,
  1,
  'metric drill access repository must issue exactly one RPC call',
);

for (const forbidden of [
  /\.from\s*\(/,
  /get_metric_projection_readiness/,
  /get_initial_kpi_shadow_projection/,
  /get_initial_kpi_reconciliation/,
  /metric_value/i,
  /breakdown/i,
  /affected_entit(?:y|ies)/i,
  /insert\s*\(/i,
  /update\s*\(/i,
  /upsert\s*\(/i,
  /delete\s*\(/i,
  /setTimeout/,
  /setInterval/,
  /while\s*\(/,
  /Math\.random/,
  /localStorage/,
  /sessionStorage/,
  /MutationObserver/,
  /CustomEvent/,
  /dispatchEvent/,
]) {
  assert.ok(!forbidden.test(repository), `metric drill access repository scope expansion: ${forbidden}`);
}

for (const marker of [
  'metricDrillAccessRpcName',
  'normaliseMetricDrillAccessRows',
  'MetricDrillAccessRecord',
  'MetricDrillAccessResult',
]) {
  assert.ok(index.includes(marker), `metric drill access export missing: ${marker}`);
}

for (const testName of [
  'current ten-metric access envelope remains ready but fully unavailable',
  'AVAILABLE survives only with ACTIVE READY governed dimensions and no reason codes',
  'server AVAILABLE with non-ready governance fails closed to UNKNOWN',
  'authorised dimensions outside declared governance fail closed',
  'UNAVAILABLE rows cannot leak authorised dimensions',
  'unknown capability and projection states never gain authority',
  'missing duplicate and non-canonical metric rows remain partial and canonicalised',
  'cross-row server timestamp mismatch removes all drill authority',
  'invalid access rows are omitted and never replaced with invented metrics',
  'metric drill permission errors classify as forbidden and never empty',
]) {
  assert.ok(tests.includes(testName), `metric drill access repository test missing: ${testName}`);
}

for (const forbidden of [
  'metricDrillAccessRepository',
  'readMetricDrillAccess',
  'metricDrillAccessContract',
  'get_metric_drill_access',
]) {
  assert.ok(
    !dashboard.includes(forbidden)
      && !pulse.includes(forbidden)
      && !surface.includes(forbidden)
      && !app.includes(forbidden),
    `premature metric drill access page adoption: ${forbidden}`,
  );
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
assert.equal(typeof frontendAudit, 'string', 'audit:intel-frontend command missing');
assert.ok(
  frontendAudit.includes('audit-intel-metric-drill-access-repository.mjs')
    && frontendAudit.includes('intel-metric-drill-access-repository-contract.test.mjs'),
  'metric drill access repository checks are not wired to audit:intel-frontend',
);

console.log('INTEL-FE-008A metric drill access repository audit passed.');
