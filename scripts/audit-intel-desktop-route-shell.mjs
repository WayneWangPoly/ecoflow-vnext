import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_001B_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const app = read('src/app/App.tsx');
const adapter = read('src/features/intelligence/navigation/useDesktopRouteAdapter.ts');
const boundary = read('src/features/intelligence/navigation/DesktopRouteBoundary.tsx');
const test = read('scripts/intel-desktop-route-adapter-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

for (const required of [
  "import { DesktopRouteBoundary } from '@/features/intelligence/navigation/DesktopRouteBoundary';",
  "import { useDesktopRouteAdapter } from '@/features/intelligence/navigation/useDesktopRouteAdapter';",
  'const { tab, setTab, boundary } = useDesktopRouteAdapter(role);',
  '<DesktopRouteBoundary boundary={boundary} />',
]) {
  if (!app.includes(required)) throw new Error(`INTEL_FE_001B_APP_WIRING_MISSING: ${required}`);
}

if (app.includes("const [tab, setTab] = useState<DesktopTab>('dashboard');")) {
  throw new Error('INTEL_FE_001B_LOCAL_DESKTOP_TAB_AUTHORITY_REMAINS');
}

for (const banned of [
  'document.querySelector',
  'document.querySelectorAll',
  'window.dispatchEvent',
  'CustomEvent(',
  'MutationObserver',
  'observeBody',
  'createPortal',
  'localStorage',
]) {
  if (adapter.includes(banned) || boundary.includes(banned)) {
    throw new Error(`INTEL_FE_001B_NATIVE_ROUTE_BANNED_PATTERN: ${banned}`);
  }
}

for (const required of [
  'deriveDesktopRouteAdapterModel',
  'desktopTabNavigationTarget',
  'useLocation()',
  'useNavigate()',
  'canonicalRedirect',
  'WORKSPACE_NOT_MIGRATED',
  'ROLE_NOT_AUTHORISED',
]) {
  if (!adapter.includes(required)) throw new Error(`INTEL_FE_001B_ADAPTER_CONTRACT_MISSING: ${required}`);
}

if (!adapter.includes('intelligenceFeatureFlags.overlay_navigation_v1')) {
  throw new Error('INTEL_FE_001B_ROUTE_FLAG_NOT_ENFORCED');
}

for (const copy of [
  'This workspace is not available to your role',
  'This workspace is not migrated yet',
  'The selected record link is invalid',
  'This route is not recognised',
]) {
  if (!boundary.includes(copy)) throw new Error(`INTEL_FE_001B_BOUNDARY_COPY_MISSING: ${copy}`);
}

for (const testName of [
  'flag-off mode preserves the existing local desktop tab',
  'canonical workspace and entity routes select the matching legacy panel',
  'forbidden routes remain explicit',
  'reserved routes without a migrated legacy panel',
  'sidebar navigation writes canonical paths',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_FE_001B_BEHAVIOUR_TEST_MISSING: ${testName}`);
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-desktop-route-shell.mjs')
  || !auditCommand.includes('intel-desktop-route-adapter-contract.test.mjs')) {
  throw new Error('INTEL_FE_001B_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-001B routed desktop shell audit passed.');
