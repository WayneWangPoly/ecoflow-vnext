import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_007A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const contract = read('src/features/intelligence/attention/actionableExceptionReadContract.ts');
const repository = read('src/data/repositories/actionableExceptionRepository.ts');
const barrel = read('src/features/intelligence/attention/index.ts');
const tests = read('scripts/intel-actionable-exception-repository-contract.test.mjs');
const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const app = read('src/app/App.tsx');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  "actionableExceptionRpcName = 'get_actionable_exception_queue'",
  'actionableExceptionDefaultLimit = 100',
  'actionableExceptionMaximumLimit = 300',
  'ActionableExceptionCapabilities',
  'ActionableExceptionRecord',
  'ActionableExceptionReadResult',
  'normaliseActionableExceptionRequest',
  'normaliseActionableExceptionRows',
  'classifyActionableExceptionError',
  "candidate === 'CURRENT_ACTIVE_ONLY'",
  "candidate === 'UNAVAILABLE'",
  "status: capabilities.lifecycle === 'CURRENT_ACTIVE_ONLY' ? 'open' : 'unknown'",
  'UNAVAILABLE_FIELD_SUPPRESSED',
  'sourceStatus: nullableText(raw.source_status',
  'readAt: timestamp(raw.read_at',
  'rawOrderId: nullableText(raw.raw_order_id',
  "workspace: 'orders', entityKind: 'order'",
]) {
  if (!contract.includes(marker)) throw new Error(`INTEL_FE_007A_CONTRACT_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  'Date.now(',
  'new Date()',
  '.reduce(',
  'impactTotal',
  'totalImpact',
  'sumImpact',
  'averageImpact',
  'Number(null)',
  'value ?? 0',
  'value || 0',
  "severity: 'critical'",
  "severity: 'high'",
  "ownerTeam: 'Operations'",
  "recommendedAction: 'Review",
  "recommendedAction: 'Open",
  'MAPPING_EXCEPTION',
  'PAYMENT_REVIEW',
  'STOCK_BLOCKED',
  'react',
  '.tsx',
  '.css',
]) {
  if (contract.includes(forbidden)) throw new Error(`INTEL_FE_007A_GUESS_OR_AGGREGATION_PATTERN: ${forbidden}`);
}

for (const marker of [
  'createActionableExceptionRepository',
  'readActionableExceptions',
  'normaliseActionableExceptionRequest(limit)',
  'if (!request.ok)',
  'const active = activeClient(client)',
  ".schema('analytics')",
  '.rpc(actionableExceptionRpcName, { p_limit: request.request.limit })',
  'normaliseActionableExceptionRows(result.data)',
  'actionableExceptionReadSuccess',
  'actionableExceptionReadFailure',
]) {
  if (!repository.includes(marker)) throw new Error(`INTEL_FE_007A_REPOSITORY_MARKER_MISSING: ${marker}`);
}

if ((repository.match(/\.rpc\(/g) ?? []).length !== 1) {
  throw new Error('INTEL_FE_007A_RPC_COUNT_INVALID');
}
const requestIndex = repository.indexOf('const request = normaliseActionableExceptionRequest(limit)');
const clientIndex = repository.indexOf('const active = activeClient(client)');
const rpcIndex = repository.indexOf('.rpc(actionableExceptionRpcName');
if (requestIndex < 0 || clientIndex < 0 || rpcIndex < 0 || !(requestIndex < clientIndex && clientIndex < rpcIndex)) {
  throw new Error('INTEL_FE_007A_LOCAL_VALIDATION_ORDER_INVALID');
}

for (const forbidden of [
  '.from(',
  'fetch(',
  '.insert(',
  '.update(',
  '.upsert(',
  '.delete(',
  'readShadowProjection',
  'readReconciliation',
  'get_initial_kpi',
  'v_ecoflow_ordermentum_ui_active_exceptions',
  'localStorage',
  'sessionStorage',
  'window.',
  'document.',
  'MutationObserver',
  'CustomEvent(',
  'dispatchEvent(',
  'react',
  '.tsx',
  '.css',
]) {
  if (repository.includes(forbidden)) throw new Error(`INTEL_FE_007A_REPOSITORY_SCOPE_EXPANSION: ${forbidden}`);
}

for (const marker of [
  'actionableExceptionRpcName',
  'normaliseActionableExceptionRows',
  'type ActionableExceptionRecord',
  'type ActionableExceptionReadResult',
  'type ActionableExceptionCapabilities',
]) {
  if (!barrel.includes(marker)) throw new Error(`INTEL_FE_007A_EXPORT_MISSING: ${marker}`);
}

for (const testName of [
  'request defaults to 100 and accepts only bounded integer limits',
  'current-active capability maps lifecycle to open while preserving source status',
  'unavailable fields remain null and non-null drift is suppressed',
  'unknown lifecycle fails closed instead of promoting a record to active work',
  'unknown source and severity states remain explicit',
  'invalid entity handoff degrades to workspace-only or null',
  'invalid rows and duplicate identities are omitted and reported',
  'invalid read timestamp does not replace the valid detected timestamp',
  'repository errors classify forbidden invalid unavailable and failed states',
  'empty source remains empty rather than a failed or fabricated queue',
]) {
  if (!tests.includes(testName)) throw new Error(`INTEL_FE_007A_TEST_MISSING: ${testName}`);
}

// Later packages may render a bounded public component that internally owns the
// repository. Pages must never import or call the repository/read contract.
for (const [surfaceName, pageSource] of [
  ['Dashboard', dashboard],
  ['App', app],
]) {
  for (const forbidden of [
    'actionableExceptionRepository',
    'readActionableExceptions',
    'actionableExceptionReadContract',
    'normaliseActionableExceptionRows',
    'normaliseActionableExceptionRequest',
  ]) {
    if (pageSource.includes(forbidden)) {
      throw new Error(`INTEL_FE_007A_${surfaceName.toUpperCase()}_DIRECT_REPOSITORY_COUPLING: ${forbidden}`);
    }
  }
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-actionable-exception-repository.mjs')
  || !auditCommand.includes('intel-actionable-exception-repository-contract.test.mjs')) {
  throw new Error('INTEL_FE_007A_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-007A actionable exception repository audit passed.');
