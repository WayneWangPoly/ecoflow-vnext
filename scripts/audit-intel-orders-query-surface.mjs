import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_004B_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const app = read('src/app/App.tsx');
const page = read('src/features/orders/OrdersControlPage.tsx');
const contract = read('src/features/orders/ordersQueryContract.ts');
const css = read('src/features/orders/ordersControlPage.css');
const test = read('scripts/intel-orders-query-surface-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

for (const required of [
  "import { OrdersControlPage } from '@/features/orders/OrdersControlPage';",
  'function OrdersPanel({ orders }: { orders: ImportedOrder[] })',
  'return <OrdersControlPage orders={orders} />;',
]) {
  if (!app.includes(required)) throw new Error(`INTEL_FE_004B_APP_ADOPTION_MISSING: ${required}`);
}

for (const required of [
  'useWorkspaceListQuery(orders, ordersListQuerySchema)',
  'ControlInput',
  'ControlSelect',
  'ControlButton',
  'ControlStatus',
  'openPrimaryRecord(buildOrderOverlayRecord(order))',
  "setFilter('status'",
  "setFilter('payment'",
  "setFilter('pod'",
  'setPageSize',
  'setPage(result.query.page - 1)',
  'setPage(result.query.page + 1)',
  'Order control',
  'orders from Ordermentum · status follows the real workflow',
]) {
  if (!page.includes(required)) throw new Error(`INTEL_FE_004B_CONTROL_SURFACE_MISSING: ${required}`);
}

for (const required of [
  'ordersListQuerySchema',
  "defaultSort: { key: 'updated', direction: 'desc' }",
  'pageSizes: [25, 50, 100]',
  'buildOrderOverlayRecord',
  'orderStatusTone',
  'paymentStatusTone',
  'podStatusTone',
  "currency: 'AUD'",
  "timeZone: 'Australia/Adelaide'",
]) {
  if (!contract.includes(required)) throw new Error(`INTEL_FE_004B_ORDER_CONTRACT_MISSING: ${required}`);
}

for (const banned of [
  'setOrders(',
  'callInternaliseOrders',
  'setActiveRunCode',
  'saveDriverDayState',
  'supabase',
  '@/data/repositories/',
  'window.alert',
  'window.confirm',
  'fetch(',
  '.insert(',
  '.update(',
  '.delete(',
]) {
  if (`${page}\n${contract}`.includes(banned)) {
    throw new Error(`INTEL_FE_004B_WRITE_OR_REPOSITORY_COUPLING: ${banned}`);
  }
}

for (const banned of [
  'document.querySelector',
  'document.querySelectorAll',
  'MutationObserver',
  'observeBody',
  'CustomEvent(',
  'window.dispatchEvent',
  'localStorage',
  'sessionStorage',
]) {
  if (`${page}\n${contract}`.includes(banned)) {
    throw new Error(`INTEL_FE_004B_DOM_OR_STORAGE_PATTERN: ${banned}`);
  }
}

for (const phrase of ['How to', 'Learn more', 'Getting started', 'Click here', 'You should', 'Next step', 'Tip:']) {
  if (`${page}\n${contract}\n${css}`.includes(phrase)) {
    throw new Error(`INTEL_FE_004B_DEFAULT_GUIDANCE_COPY: ${phrase}`);
  }
}

for (const required of [
  '.orders-control-header',
  '.orders-control-query__grid',
  '.orders-control-table',
  '.orders-control-row--head',
  '.orders-control-pager',
  '@media (max-width: 760px)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!css.includes(required)) throw new Error(`INTEL_FE_004B_VISUAL_CONTRACT_MISSING: ${required}`);
}

for (const banned of ['!important', 'url(', '@font-face', '.dashboard-', '.inventory-', '.delivery-']) {
  if (css.includes(banned)) throw new Error(`INTEL_FE_004B_VISUAL_SCOPE_EXPANSION: ${banned}`);
}

for (const testName of [
  'Orders query schema searches verified identifiers and applies typed filters',
  'Orders query pagination remains bounded to configured page sizes',
  'Order signal tones distinguish completed, active and blocked states',
  'Order drawer record preserves operational fields without write actions',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_FE_004B_TEST_MISSING: ${testName}`);
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-orders-query-surface.mjs')
  || !auditCommand.includes('intel-orders-query-surface-contract.test.mjs')) {
  throw new Error('INTEL_FE_004B_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-004B Orders query surface audit passed.');
