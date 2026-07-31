import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_INV_001A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const contractPath = 'src/features/intelligence/inventory/inventoryIntelligenceContract.ts';
const indexPath = 'src/features/intelligence/inventory/index.ts';
const testPath = 'scripts/intel-inventory-intelligence-contract.test.mjs';
const contract = read(contractPath);
const index = read(indexPath);
const test = read(testPath);
const app = read('src/app/App.tsx');
const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const currentInventory = read('src/InventoryControlCenter.tsx');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  "'OVERVIEW'",
  "'FILTERS'",
  "'TREND'",
  "'BREAKDOWN'",
  "'COMMERCIAL_TABLE'",
  "'PHYSICAL_TABLE'",
  "'DETAIL_DRAWER'",
  "'TIMELINE'",
  "'FRESHNESS'",
  "'OPERATIONAL_HANDOFF'",
  "inventoryIdentityStates = ['RESOLVED', 'AMBIGUOUS', 'UNRESOLVED']",
  "inventoryQuantityDomains = ['GLOBAL_BASE', 'LOCATION_PACKAGE']",
  "inventoryCoverageStates = ['FULL', 'PARTIAL', 'NONE', 'UNKNOWN']",
  "inventoryRiskStates = ['NONE', 'WATCH', 'REORDER', 'STOCKOUT', 'UNKNOWN']",
  'COMMERCIAL_PHYSICAL_IDENTITY_COLLISION',
  'NON_DATA_STATE_SUPPRESSED',
  'ROW_TIMESTAMP_INVALID',
  'buildInventoryIntelligenceModel',
  'buildInventoryIntelligenceHandoff',
  "if (kind === 'commercial-sku') return `/inventory/commercial/${encoded}`",
  "if (kind === 'physical-sku') return `/inventory/physical/${encoded}`",
  'return `/orders/${encoded}`',
  'matchIntelligenceRoute(pathname)',
  'withWorkspaceQuery(pathname, query)',
  'selected: id',
  'primaryDrawer: `${kind}:${id}`',
]) {
  if (!contract.includes(marker)) throw new Error(`INTEL_INV_001A_CONTRACT_MARKER_MISSING: ${marker}`);
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
  /unitCost/,
  /sellingPrice/,
  /purchasePrice/,
  /recommendedAction/,
  /businessImpact/,
  /severity/,
  /\bsla\b/i,
  /\.reduce\s*\(/,
  /Math\./,
  /insert\s*\(/,
  /update\s*\(/,
  /upsert\s*\(/,
  /delete\s*\(/,
]) {
  if (forbidden.test(contract)) throw new Error(`INTEL_INV_001A_CONTRACT_SCOPE_EXPANSION: ${forbidden}`);
}

if ((contract.match(/matchIntelligenceRoute\(/g) ?? []).length !== 1) {
  throw new Error('INTEL_INV_001A_CANONICAL_ROUTE_VALIDATION_COUNT_INVALID');
}
if ((contract.match(/withWorkspaceQuery\(/g) ?? []).length !== 1) {
  throw new Error('INTEL_INV_001A_QUERY_ROUTE_COUNT_INVALID');
}

for (const marker of [
  'buildInventoryIntelligenceModel',
  'buildInventoryIntelligenceHandoff',
  'InventoryIntelligenceModel',
  'InventoryCommercialSku',
  'InventoryPhysicalSku',
  'InventoryTimelineEvent',
  'InventoryIntelligenceHandoff',
]) {
  if (!index.includes(marker)) throw new Error(`INTEL_INV_001A_EXPORT_MISSING: ${marker}`);
}

for (const testName of [
  'domain manifest covers every required Inventory Intelligence surface',
  'READY inventory preserves confirmed zero and separate commercial and physical identities',
  'global base and location package quantities remain distinct server-owned domains',
  'non-data states suppress supplied rows instead of presenting stale facts',
  'duplicate and malformed records are omitted and remain explicit partial coverage',
  'commercial and physical identities cannot collapse into one identifier',
  'movement deltas preserve signed values while missing evidence remains null',
  'row and envelope timestamps fail closed when they exceed the server read',
  'commercial SKU, physical SKU and Order handoffs use canonical routed drawers',
  'invalid entity IDs and malformed envelopes remain unavailable instead of guessing',
  'a valid data-bearing envelope with no rows is explicitly empty',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_INV_001A_TEST_MISSING: ${testName}`);
}

for (const forbidden of [
  '@/features/intelligence/inventory',
  'inventoryIntelligenceContract',
  'buildInventoryIntelligenceModel',
  'buildInventoryIntelligenceHandoff',
]) {
  if (app.includes(forbidden) || dashboard.includes(forbidden) || currentInventory.includes(forbidden)) {
    throw new Error(`INTEL_INV_001A_PREMATURE_ADOPTION: ${forbidden}`);
  }
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
if (typeof frontendAudit !== 'string'
  || !frontendAudit.includes('audit-intel-inventory-intelligence-contract.mjs')
  || !frontendAudit.includes('intel-inventory-intelligence-contract.test.mjs')) {
  throw new Error('INTEL_INV_001A_PACKAGE_WIRING_MISSING');
}

console.log('INTEL-INV-001A Inventory Intelligence domain contract audit passed.');
