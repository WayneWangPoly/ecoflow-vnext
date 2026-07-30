import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_UI_005A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const contractPath = 'src/features/intelligence/crossFilter/crossFilterDrillContract.ts';
const indexPath = 'src/features/intelligence/crossFilter/index.ts';
const testPath = 'scripts/intel-cross-filter-drill-contract.test.mjs';
const contract = read(contractPath);
const index = read(indexPath);
const test = read(testPath);
const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const pulse = read('src/features/intelligence/operationalPulse/OperationalPulse.tsx');
const app = read('src/app/App.tsx');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  "crossFilterDrillCapabilities = ['AVAILABLE', 'UNAVAILABLE']",
  "metric.availability === 'READY' && drillCapability === 'AVAILABLE'",
  'NON_DRILLABLE_DATA_SUPPRESSED',
  'UNSUPPORTED_BREAKDOWN_DIMENSION',
  'DUPLICATE_BREAKDOWN_KEY',
  'DUPLICATE_ENTITY',
  'AFFECTED_COUNT_MISMATCH',
  'OPERATIONAL_ROUTE_UNAVAILABLE',
  "'order'",
  "'commercial-sku'",
  "'physical-sku'",
  "'customer'",
  "'store'",
  "'delivery-run'",
  "if (kind === 'order') return `/orders/${encoded}`",
  "if (kind === 'commercial-sku') return `/inventory/commercial/${encoded}`",
  "if (kind === 'physical-sku') return `/inventory/physical/${encoded}`",
  "if (kind === 'customer') return `/customers/${encoded}`",
  "if (kind === 'store') return `/stores/${encoded}`",
  'return `/delivery/runs/${encoded}`',
  'matchIntelligenceRoute(pathname)',
  'selected: entity.id',
  'primaryDrawer: `${entity.kind}:${entity.id}`',
  'withWorkspaceQuery(pathname, query)',
  'buildCrossFilterDrillModel',
  'buildCrossFilterDrillPath',
  "status: 'READY'",
  "reason: 'DRILL_NOT_AVAILABLE'",
  "reason: 'BREAKDOWN_NOT_FOUND'",
  "reason: 'ENTITY_NOT_FOUND'",
]) {
  if (!contract.includes(marker)) throw new Error(`INTEL_UI_005A_CONTRACT_MARKER_MISSING: ${marker}`);
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
  /localStorage/,
  /sessionStorage/,
  /MutationObserver/,
  /CustomEvent/,
  /dispatchEvent/,
  /document\./,
  /window\./,
  /\bowner\b/i,
  /\badmin\b/i,
  /\baccount\b/i,
  /\bviewer\b/i,
  /recommendedAction/,
  /businessImpact/,
  /severity/,
  /\bsla\b/i,
  /Math\.random/,
]) {
  if (forbidden.test(contract)) throw new Error(`INTEL_UI_005A_CONTRACT_SCOPE_EXPANSION: ${forbidden}`);
}

if ((contract.match(/routePathForEntity\(/g) ?? []).length !== 2) {
  throw new Error('INTEL_UI_005A_ROUTE_BUILDER_USAGE_INVALID');
}
if ((contract.match(/withWorkspaceQuery\(/g) ?? []).length !== 1) {
  throw new Error('INTEL_UI_005A_QUERY_ROUTE_COUNT_INVALID');
}
if ((contract.match(/matchIntelligenceRoute\(/g) ?? []).length !== 1) {
  throw new Error('INTEL_UI_005A_CANONICAL_ROUTE_VALIDATION_COUNT_INVALID');
}

for (const marker of [
  'buildCrossFilterDrillModel',
  'buildCrossFilterDrillPath',
  'CrossFilterDrillModel',
  'CrossFilterDrillPath',
  'CrossFilterOperationalRoute',
]) {
  if (!index.includes(marker)) throw new Error(`INTEL_UI_005A_EXPORT_MISSING: ${marker}`);
}

for (const testName of [
  'READY metric builds KPI to breakdown to entity to drawer to operational route chain',
  'SHADOW and BLOCKED metrics suppress supplied drill data',
  'explicit unavailable drill capability blocks an otherwise READY KPI',
  'unknown metric, availability and drill capability fail closed',
  'breakdown dimensions must be explicitly supported',
  'all existing routed entity kinds produce matching drawers and operational routes',
  'duplicate and invalid entities are omitted and reported without inventing routes',
  'affected counts distinguish complete and truncated entity lists',
  'duplicate dimensions and breakdown keys remain explicit partial coverage',
  'path selection fails explicitly for missing breakdown or entity',
  'empty, malformed and non-array drill collections remain explicit',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_UI_005A_TEST_MISSING: ${testName}`);
}

for (const forbidden of [
  "@/features/intelligence/crossFilter",
  'crossFilterDrillContract',
  'buildCrossFilterDrillModel',
  'buildCrossFilterDrillPath',
]) {
  if (dashboard.includes(forbidden) || pulse.includes(forbidden) || app.includes(forbidden)) {
    throw new Error(`INTEL_UI_005A_PREMATURE_ADOPTION: ${forbidden}`);
  }
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
if (typeof frontendAudit !== 'string'
  || !frontendAudit.includes('audit-intel-cross-filter-drill-contract.mjs')
  || !frontendAudit.includes('intel-cross-filter-drill-contract.test.mjs')) {
  throw new Error('INTEL_UI_005A_PACKAGE_WIRING_MISSING');
}

console.log('INTEL-UI-005A cross-filter drill contract audit passed.');
