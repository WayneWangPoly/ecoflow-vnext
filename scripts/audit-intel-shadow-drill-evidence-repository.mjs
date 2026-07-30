import assert from 'node:assert/strict';
import fs from 'node:fs';

const contractPath = 'src/features/intelligence/crossFilter/shadowDrillEvidenceContract.ts';
const repositoryPath = 'src/data/repositories/shadowDrillEvidenceRepository.ts';
const indexPath = 'src/features/intelligence/crossFilter/index.ts';
const testPath = 'scripts/intel-shadow-drill-evidence-repository-contract.test.mjs';
const packagePath = 'package.json';

for (const file of [contractPath, repositoryPath, indexPath, testPath, packagePath]) {
  assert.ok(fs.existsSync(file), `missing Shadow drill evidence repository file: ${file}`);
}

const contract = fs.readFileSync(contractPath, 'utf8');
const repository = fs.readFileSync(repositoryPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const tests = fs.readFileSync(testPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const dashboard = fs.readFileSync('src/features/dashboard/DashboardPage.tsx', 'utf8');
const pulse = fs.readFileSync('src/features/intelligence/operationalPulse/OperationalPulse.tsx', 'utf8');
const status = fs.readFileSync('src/features/intelligence/crossFilter/MetricDrillAccessStatus.tsx', 'utf8');
const surface = fs.readFileSync('src/features/intelligence/crossFilter/CrossFilterDrillSurface.tsx', 'utf8');
const workspace = fs.readFileSync('src/features/intelligence/analytics/OperationalPulseReadinessWorkspace.tsx', 'utf8');
const app = fs.readFileSync('src/app/App.tsx', 'utf8');

for (const marker of [
  "shadowDrillEvidenceRpcName = 'get_initial_kpi_shadow_drill_evidence'",
  "shadowDrillEvidenceDimensions = ['date', 'commercial_sku']",
  'normaliseShadowDrillEvidenceRequest',
  'normaliseAnalyticsDateRange',
  'breakdownLimit: 25',
  'entityLimit: 25',
  "evidenceCapability: 'SHADOW_ONLY'",
  "metricStatus: 'DRAFT'",
  "projectionStatus: 'SHADOW'",
  'COUNT_CONSERVATION_MISMATCH',
  'STATE_INVARIANT_MISMATCH',
  'ENTITY_COUNT_MISMATCH',
  'READ_TIMESTAMP_MISMATCH',
  "row.evidenceState = 'UNKNOWN'",
  'row.entities = []',
  'shadowDrillEvidenceInvalid',
  'shadowDrillEvidenceFailure',
]) {
  assert.ok(contract.includes(marker), `missing Shadow drill evidence contract marker: ${marker}`);
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
  /numerator_quantity/i,
  /denominator_quantity/i,
  /fulfilled_quantity/i,
  /ordered_quantity/i,
  /line_total/i,
  /unit_price/i,
  /localStorage/,
  /sessionStorage/,
  /window\./,
  /document\./,
  /MutationObserver/,
  /CustomEvent/,
]) {
  assert.ok(!forbidden.test(contract), `Shadow drill evidence contract scope expansion: ${forbidden}`);
}

for (const marker of [
  'createShadowDrillEvidenceRepository',
  'readShadowDrillEvidence:',
  'normaliseShadowDrillEvidenceRequest(input)',
  'shadowDrillEvidenceInvalid(normalisedRequest.issue)',
  ".schema('analytics')",
  '.rpc(shadowDrillEvidenceRpcName, {',
  'p_metric_key: request.metricKey',
  'p_dimension_key: request.dimensionKey',
  'p_date_from: request.dateFrom',
  'p_date_to: request.dateTo',
  'p_breakdown_limit: request.breakdownLimit',
  'p_entity_limit: request.entityLimit',
  'normaliseShadowDrillEvidenceRows(result.data, request)',
  "code: 'NOT_CONFIGURED'",
]) {
  assert.ok(repository.includes(marker), `missing Shadow drill evidence repository marker: ${marker}`);
}

assert.equal(
  (repository.match(/\.rpc\s*\(/g) ?? []).length,
  1,
  'Shadow drill evidence repository must issue exactly one RPC call',
);

for (const forbidden of [
  /get_initial_kpi_shadow_projection/,
  /get_initial_kpi_reconciliation/,
  /get_metric_drill_access/,
  /\.from\s*\(/,
  /metric_value/i,
  /numerator/i,
  /denominator/i,
  /fulfilled_quantity/i,
  /ordered_quantity/i,
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
  assert.ok(!forbidden.test(repository), `Shadow drill evidence repository scope expansion: ${forbidden}`);
}

for (const marker of [
  'normaliseShadowDrillEvidenceRequest',
  'normaliseShadowDrillEvidenceRows',
  'shadowDrillEvidenceRpcName',
  'ShadowDrillEvidenceRecord',
  'ShadowDrillEvidenceResult',
]) {
  assert.ok(index.includes(marker), `Shadow drill evidence export missing: ${marker}`);
}

for (const testName of [
  'Shadow evidence request canonicalises metric dimension range and bounded defaults',
  'invalid metric dimension date range and limits fail locally',
  'valid Shadow evidence preserves counts blockers and bounded Order entities',
  'line-state count conservation failures omit unsafe rows',
  'state invariant mismatch clears entities and becomes UNKNOWN',
  'affected entity truncation must match affected count',
  'duplicate and non-canonical breakdowns remain partial and canonicalised',
  'cross-row read timestamp mismatch removes all routeable evidence',
  'server governance mismatch is omitted rather than promoted',
  'Shadow evidence permission errors classify as forbidden and never empty',
]) {
  assert.ok(tests.includes(testName), `Shadow drill evidence contract test missing: ${testName}`);
}

for (const forbidden of [
  'shadowDrillEvidenceRepository',
  'readShadowDrillEvidence',
  'shadowDrillEvidenceContract',
  'get_initial_kpi_shadow_drill_evidence',
]) {
  assert.ok(
    !dashboard.includes(forbidden)
      && !pulse.includes(forbidden)
      && !status.includes(forbidden)
      && !surface.includes(forbidden)
      && !workspace.includes(forbidden)
      && !app.includes(forbidden),
    `premature Shadow drill evidence page adoption: ${forbidden}`,
  );
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
assert.equal(typeof frontendAudit, 'string', 'audit:intel-frontend command missing');
assert.ok(
  frontendAudit.includes('audit-intel-shadow-drill-evidence-repository.mjs')
    && frontendAudit.includes('intel-shadow-drill-evidence-repository-contract.test.mjs'),
  'Shadow drill evidence repository checks are not wired to audit:intel-frontend',
);

console.log('INTEL-FE-008B Shadow drill evidence repository audit passed.');
