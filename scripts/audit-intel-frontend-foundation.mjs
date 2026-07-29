import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const files = {
  route: 'src/features/intelligence/navigation/routeContract.ts',
  query: 'src/features/intelligence/navigation/queryState.ts',
  overlay: 'src/features/intelligence/navigation/overlayState.ts',
  flags: 'src/features/intelligence/featureFlags.ts',
  test: 'scripts/intel-frontend-navigation-contract.test.mjs',
  package: 'package.json',
};

function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_001A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const sources = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, read(value)]));
const nativeSource = [sources.route, sources.query, sources.overlay, sources.flags].join('\n');

for (const banned of [
  'document.querySelector',
  'document.querySelectorAll',
  'window.dispatchEvent',
  'CustomEvent(',
  'observeBody',
  'MutationObserver',
  'createPortal',
  'window.open(',
  'localStorage',
]) {
  if (nativeSource.includes(banned)) {
    throw new Error(`INTEL_FE_001A_ENHANCER_PATTERN_FORBIDDEN: ${banned}`);
  }
}

for (const requiredPath of [
  '/control-room',
  '/orders/:orderId',
  '/inventory/commercial/:skuId',
  '/inventory/physical/:itemId',
  '/customers/:customerId',
  '/stores/:storeId',
  '/delivery/runs/:runCode',
  '/returns',
  '/exceptions',
  '/analytics',
  '/settings',
]) {
  if (!sources.route.includes(requiredPath)) {
    throw new Error(`INTEL_FE_001A_CANONICAL_ROUTE_MISSING: ${requiredPath}`);
  }
}

for (const requiredSymbol of [
  'resolveIntelligenceRoute',
  'pathForLegacyDesktopTab',
  'ROLE_NOT_AUTHORISED',
  'ROUTE_NOT_FOUND',
  'INVALID_ENTITY_ID',
]) {
  if (!sources.route.includes(requiredSymbol)) {
    throw new Error(`INTEL_FE_001A_ROUTE_CONTRACT_MISSING: ${requiredSymbol}`);
  }
}

for (const requiredKey of [
  "'date'",
  "'from'",
  "'to'",
  "'compare'",
  "'filter'",
  "'sort'",
  "'cursor'",
  "'selected'",
  "'drawer'",
  "'inspector'",
  "'view'",
]) {
  if (!sources.query.includes(requiredKey)) {
    throw new Error(`INTEL_FE_001A_QUERY_KEY_MISSING: ${requiredKey}`);
  }
}

if (!sources.query.includes('INVALID_DATE_RANGE') || !sources.query.includes('issues: WorkspaceQueryIssue[]')) {
  throw new Error('INTEL_FE_001A_QUERY_FAILURE_STATE_MISSING');
}

if (!sources.overlay.includes("primary: InformationOverlay | null")
  || !sources.overlay.includes("secondary: InformationOverlay | null")
  || !sources.overlay.includes("case 'OPEN_RELATED'")
  || !sources.overlay.includes('secondary: informationOverlay(action.entity')) {
  throw new Error('INTEL_FE_001A_BOUNDED_OVERLAY_CONTRACT_MISSING');
}

if (sources.overlay.includes('tertiary') || sources.overlay.includes('overlayStack')) {
  throw new Error('INTEL_FE_001A_UNBOUNDED_OVERLAY_STACK_FORBIDDEN');
}

if (!sources.flags.includes('overlay_navigation_v1: parseBooleanFlag')
  || !sources.flags.includes('source: Record<string, unknown> = {}')) {
  throw new Error('INTEL_FE_001A_FLAG_DEFAULT_FALSE_CONTRACT_MISSING');
}

const packageJson = JSON.parse(sources.package);
const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
const operationalCommand = packageJson.scripts?.['audit:operational-safety'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-frontend-foundation.mjs')
  || !auditCommand.includes('intel-frontend-navigation-contract.test.mjs')) {
  throw new Error('INTEL_FE_001A_PACKAGE_AUDIT_SCRIPT_MISSING');
}
if (typeof operationalCommand !== 'string' || !operationalCommand.includes('npm run audit:intel-frontend')) {
  throw new Error('INTEL_FE_001A_OPERATIONAL_CI_WIRING_MISSING');
}

for (const testPhrase of [
  'unknown routes and role violations fail closed',
  'query parsing preserves valid context',
  'overlay reducer enforces one primary and one replaceable secondary',
  'overlay navigation flag is opt-in and false by default',
]) {
  if (!sources.test.includes(testPhrase)) {
    throw new Error(`INTEL_FE_001A_BEHAVIOUR_TEST_MISSING: ${testPhrase}`);
  }
}

console.log('INTEL-FE-001A frontend foundation audit passed.');
