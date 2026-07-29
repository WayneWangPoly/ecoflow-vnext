import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_003A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const manager = read('src/features/intelligence/overlays/OverlayManager.tsx');
const contract = read('src/features/intelligence/overlays/overlayManagerContract.ts');
const css = read('src/features/intelligence/overlays/overlayManager.css');
const barrel = read('src/features/intelligence/overlays/index.ts');
const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const main = read('src/main.tsx');
const overlayState = read('src/features/intelligence/navigation/overlayState.ts');
const test = read('scripts/intel-overlay-manager-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

for (const required of [
  'createPortal',
  'reduceIntelligenceOverlay',
  'OverlayManagerProvider',
  'openPrimaryRecord',
  'openRelatedRecord',
  'openCommit',
  'closeTop',
  "event.key === 'Escape'",
  'trapTab(event)',
  "document.getElementById('root')",
  'root.inert = true',
  "document.body.style.overflow = 'hidden'",
  'restoreFocus',
  'useLocation',
  'useNavigate',
  'overlay_navigation_v1',
]) {
  if (!manager.includes(required)) throw new Error(`INTEL_FE_003A_MANAGER_CONTRACT_MISSING: ${required}`);
}

for (const required of [
  "primary: InformationOverlay | null",
  "secondary: InformationOverlay | null",
  "commit: CommitModalState | null",
  "case 'OPEN_RELATED'",
  "case 'CLOSE_TOP'",
]) {
  if (!overlayState.includes(required)) throw new Error(`INTEL_FE_003A_BOUNDED_STATE_MISSING: ${required}`);
}

for (const banned of [
  'window.dispatchEvent',
  'CustomEvent(',
  'observeBody',
  'MutationObserver',
  'document.querySelector',
  'localStorage',
  'overlayStack',
  'tertiary',
]) {
  if (`${manager}\n${contract}\n${dashboard}`.includes(banned)) {
    throw new Error(`INTEL_FE_003A_LEGACY_OR_UNBOUNDED_PATTERN: ${banned}`);
  }
}

for (const phrase of ['How to', 'Learn more', 'Getting started', 'Click here', 'You should', 'Next step', 'Tip:']) {
  if (`${manager}\n${css}\n${dashboard}`.includes(phrase)) {
    throw new Error(`INTEL_FE_003A_DEFAULT_GUIDANCE_COPY: ${phrase}`);
  }
}

for (const required of [
  '.ef-overlay-panel--primary',
  '.ef-overlay-panel--secondary',
  '.ef-overlay-commit',
  '.ef-overlay-record-grid',
  '@media (max-width: 720px)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!css.includes(required)) throw new Error(`INTEL_FE_003A_VISUAL_CONTRACT_MISSING: ${required}`);
}

for (const banned of ['!important', 'url(', '@font-face']) {
  if (css.includes(banned)) throw new Error(`INTEL_FE_003A_VISUAL_SCOPE_EXPANSION: ${banned}`);
}

for (const required of [
  "import { useOverlayManager } from '@/features/intelligence/overlays';",
  'const { openPrimaryRecord } = useOverlayManager();',
  "entity: { kind: 'exception', id: `queue-${item.id}` }",
  "entity: { kind: 'order', id: order.id }",
  "eyebrow: 'Action queue'",
  "eyebrow: 'Order'",
]) {
  if (!dashboard.includes(required)) throw new Error(`INTEL_FE_003A_DASHBOARD_DRAWER_MIGRATION_MISSING: ${required}`);
}

for (const legacy of ['ecoflow:open-work-item', 'openWorkItem(', 'window.dispatchEvent', 'CustomEvent(']) {
  if (dashboard.includes(legacy)) throw new Error(`INTEL_FE_003A_DASHBOARD_EVENT_BRIDGE_REMAINS: ${legacy}`);
}

for (const preserved of [
  "{ label: 'Open items', value: String(item.count) }",
  "{ label: 'Role view', value: roleName }",
  "{ label: 'Next action', value: item.next }",
  "{ label: 'Order', value: order.orderNo }",
  "{ label: 'Invoice', value: order.invoiceNo || '—' }",
  "{ label: 'Release gate', value: gateLabel(order) }",
  "{ label: 'POD', value: order.podStatus }",
]) {
  if (!dashboard.includes(preserved)) throw new Error(`INTEL_FE_003A_EXISTING_DETAIL_FIELD_LOST: ${preserved}`);
}

if (!main.includes("import { OverlayManagerProvider } from './features/intelligence/overlays';")
  || !main.includes('<OverlayManagerProvider>')
  || !main.includes('</OverlayManagerProvider>')) {
  throw new Error('INTEL_FE_003A_ROOT_PROVIDER_NOT_MOUNTED');
}

for (const required of [
  'normaliseOverlayRecord',
  'overlayLayerSequence',
  'topOverlayLayer',
  'OverlayRecordInput',
]) {
  if (!contract.includes(required) && !barrel.includes(required)) {
    throw new Error(`INTEL_FE_003A_TYPED_EXPORT_MISSING: ${required}`);
  }
}

for (const testName of [
  'overlay records are trimmed, bounded and keep explicit business copy',
  'overlay runtime remains one primary, one replaceable secondary and one commit',
  'opening related content without a primary promotes it to the primary drawer',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_FE_003A_TEST_MISSING: ${testName}`);
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-overlay-manager.mjs')
  || !auditCommand.includes('intel-overlay-manager-contract.test.mjs')) {
  throw new Error('INTEL_FE_003A_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-003A overlay manager audit passed.');
