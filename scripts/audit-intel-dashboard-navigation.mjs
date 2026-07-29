import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_001C_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const app = read('src/app/App.tsx');
const contract = read('src/features/dashboard/dashboardNavigationContract.ts');
const test = read('scripts/intel-dashboard-navigation-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

for (const banned of ['document.querySelector', 'document.querySelectorAll', '.textContent', 'openSection(']) {
  if (dashboard.includes(banned)) throw new Error(`INTEL_FE_001C_DASHBOARD_TEXT_NAVIGATION_REMAINS: ${banned}`);
}

for (const required of [
  "onOpenTab: (tab: DashboardNavigationTab) => void",
  "onClick={() => onOpenTab('orders')}",
  'Review orders',
  "onClick={() => onOpenTab('reconciliation')}",
  'Reconciliation',
  'onClick={() => onOpenTab(stage.tab)}',
  'dashboardStageTarget',
]) {
  if (!dashboard.includes(required)) throw new Error(`INTEL_FE_001C_TYPED_NAVIGATION_MISSING: ${required}`);
}

if (!app.includes('onReload={onReload} onOpenTab={setTab} />')) {
  throw new Error('INTEL_FE_001C_SHELL_CALLBACK_NOT_CONNECTED');
}
if (app.includes("onOpenOrders={() => setTab('orders')}")) {
  throw new Error('INTEL_FE_001C_OLD_DASHBOARD_CALLBACK_REMAINS');
}

for (const required of ['DashboardNavigationTab', 'DashboardStage', 'dashboardStageTarget']) {
  if (!contract.includes(required)) throw new Error(`INTEL_FE_001C_CONTRACT_MISSING: ${required}`);
}
for (const testName of [
  'operational and ready stages open Orders',
  'Accounts finance review opens Reconciliation',
  'warehouse execution stages open Delivery',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_FE_001C_TEST_MISSING: ${testName}`);
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-dashboard-navigation.mjs')
  || !auditCommand.includes('intel-dashboard-navigation-contract.test.mjs')) {
  throw new Error('INTEL_FE_001C_PACKAGE_AUDIT_WIRING_MISSING');
}

if (fs.existsSync(path.join(root, 'scripts/materialise-intel-fe-001c.mjs'))) {
  throw new Error('INTEL_FE_001C_MATERIALISER_REMAINS');
}
if (fs.existsSync(path.join(root, '.github/workflows/apply-intel-fe-001c-dashboard-navigation.yml'))) {
  throw new Error('INTEL_FE_001C_TEMPORARY_WORKFLOW_REMAINS');
}

console.log('INTEL-FE-001C dashboard navigation audit passed.');
