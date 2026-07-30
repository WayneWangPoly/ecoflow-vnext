import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_UI_004A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const contractPath = 'src/features/intelligence/operationalFlow/operationalFlowContract.ts';
const indexPath = 'src/features/intelligence/operationalFlow/index.ts';
const testPath = 'scripts/intel-operational-flow-contract.test.mjs';
const contract = read(contractPath);
const index = read(indexPath);
const test = read(testPath);
const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const app = read('src/app/App.tsx');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  "{ key: 'NEW', label: 'New' }",
  "{ key: 'NEEDS_ACTION', label: 'Needs Action' }",
  "{ key: 'FINANCE_REVIEW', label: 'Finance Review' }",
  "{ key: 'READY', label: 'Ready' }",
  "{ key: 'WAREHOUSE', label: 'Warehouse' }",
  "{ key: 'STAGED', label: 'Staged' }",
  "{ key: 'ROUTE', label: 'Route' }",
  "{ key: 'DELIVERED', label: 'Delivered' }",
  "if (status === 'CANCELLED')",
  "reason: 'CANCELLED'",
  "RELEASED: 'WAREHOUSE'",
  "PICKING: 'WAREHOUSE'",
  "PACKED: 'WAREHOUSE'",
  "STAGED: 'STAGED'",
  "OUT_FOR_DELIVERY: 'ROUTE'",
  "DELIVERED: 'DELIVERED'",
  "CLOSED: 'DELIVERED'",
  "stage: 'NEEDS_ACTION'",
  "stage: 'FINANCE_REVIEW'",
  "stage: 'READY'",
  "stage: 'NEW'",
  'STALE_RELEASE_GATE_IGNORED',
  'CONFLICTING_PRE_RELEASE_SIGNAL',
  'UNKNOWN_RELEASE_GATE',
  'DUPLICATE_ORDER_ID',
  'conservationOk',
  'nodes.reduce((total, node) => total + node.count, 0) === classifiedCount',
]) {
  if (!contract.includes(marker)) throw new Error(`INTEL_UI_004A_CONTRACT_MARKER_MISSING: ${marker}`);
}

if ((contract.match(/\{ key: '[A-Z_]+'/g) ?? []).length !== 8) {
  throw new Error('INTEL_UI_004A_STAGE_COUNT_INVALID');
}

for (const forbidden of [
  /react/i,
  /\.tsx['"]/,
  /\.css['"]/,
  /supabase/i,
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /fetch\s*\(/,
  /DashboardPage/,
  /ActionableExceptionQueue/,
  /localStorage/,
  /sessionStorage/,
  /MutationObserver/,
  /CustomEvent/,
  /document\./,
  /window\./,
  /recommendedAction/,
  /businessImpact/,
  /severity/,
  /\bsla\b/i,
]) {
  if (forbidden.test(contract)) throw new Error(`INTEL_UI_004A_CONTRACT_SCOPE_EXPANSION: ${forbidden}`);
}

for (const marker of [
  'buildOperationalFlow',
  'classifyOperationalFlowOrder',
  'operationalFlowStages',
  'OperationalFlowStage',
  'OperationalFlowIssueCode',
]) {
  if (!index.includes(marker)) throw new Error(`INTEL_UI_004A_EXPORT_MISSING: ${marker}`);
}

for (const testName of [
  'canonical flow exposes exactly eight ordered mutually exclusive stages',
  'pre-release orders follow exception and governed release-gate precedence',
  'execution status is authoritative and keeps Warehouse separate from Staged',
  'cancelled orders are excluded rather than presented as delivered',
  'stale release gates never pull execution orders backwards',
  'contradictory ready status and blocking gate remains blocked and explicit',
  'unknown pre-release signals fail closed instead of manufacturing a stage',
  'flow counts conserve every source row without double-classifying orders',
  'duplicates invalid rows and unknown orders remain explicit partial coverage',
  'empty and non-array sources remain explicit without fabricated orders',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_UI_004A_TEST_MISSING: ${testName}`);
}

for (const forbidden of [
  "@/features/intelligence/operationalFlow",
  'operationalFlowContract',
  'buildOperationalFlow',
  'OperationalFlowStage',
]) {
  if (dashboard.includes(forbidden) || app.includes(forbidden)) {
    throw new Error(`INTEL_UI_004A_PREMATURE_PAGE_ADOPTION: ${forbidden}`);
  }
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
if (typeof frontendAudit !== 'string'
  || !frontendAudit.includes('audit-intel-operational-flow-contract.mjs')
  || !frontendAudit.includes('intel-operational-flow-contract.test.mjs')) {
  throw new Error('INTEL_UI_004A_PACKAGE_WIRING_MISSING');
}

console.log('INTEL-UI-004A operational flow contract audit passed.');
