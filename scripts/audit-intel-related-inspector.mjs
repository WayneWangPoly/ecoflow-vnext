import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_003B_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const manager = read('src/features/intelligence/overlays/OverlayManager.tsx');
const contract = read('src/features/intelligence/overlays/overlayManagerContract.ts');
const css = read('src/features/intelligence/overlays/overlayManager.css');
const barrel = read('src/features/intelligence/overlays/index.ts');
const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const priorityComponent = read('src/features/intelligence/attention/PriorityWork.tsx');
const priorityPresentation = read('src/features/intelligence/attention/priorityWorkPresentationContract.ts');
const test = read('scripts/intel-related-inspector-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

for (const required of [
  'OverlayRelatedRecordInput',
  'MAX_RELATED_RECORDS = 6',
  'normaliseRelatedOverlayRecord',
  'relatedOverlayRecord',
  'relatedRecords?: readonly OverlayRelatedRecordInput[]',
]) {
  if (!contract.includes(required)) throw new Error(`INTEL_FE_003B_RELATED_CONTRACT_MISSING: ${required}`);
}

for (const required of [
  'record.relatedRecords?.length',
  'className="ef-overlay-related"',
  'aria-label="Related records"',
  'onOpenRelated(relatedOverlayRecord(related))',
  'onOpenRelated={openRelatedRecord}',
  '<ArrowRight aria-hidden="true" />',
]) {
  if (!manager.includes(required)) throw new Error(`INTEL_FE_003B_INSPECTOR_TRIGGER_MISSING: ${required}`);
}

for (const required of [
  '.ef-overlay-related',
  '.ef-overlay-related button::before',
  '.ef-overlay-related button:focus-visible',
]) {
  if (!css.includes(required)) throw new Error(`INTEL_FE_003B_RELATION_RAIL_STYLE_MISSING: ${required}`);
}

for (const required of [
  '<PriorityWork />',
  'priorityWorkOrderRoute(record)',
  'navigate(route.href)',
]) {
  if (!`${dashboard}\n${priorityComponent}`.includes(required)) {
    throw new Error(`INTEL_FE_003B_PRIORITY_WORK_ORDER_HANDOFF_MISSING: ${required}`);
  }
}

for (const required of [
  "matched.route.workspace !== 'orders'",
  "matched.route.entityKind !== 'order'",
  "primaryDrawer: `order:${record.orderEntityId}`",
]) {
  if (!priorityPresentation.includes(required)) {
    throw new Error(`INTEL_FE_003B_PRIORITY_WORK_IDENTITY_GUARD_MISSING: ${required}`);
  }
}

for (const forbidden of [
  'function storeForOrder(',
  'normalisedIdentity(store.name)',
  'normalisedIdentity(store.account)',
  'relatedRecords: storeProfile',
  "entity: { kind: 'store', id: order.store }",
  "entity: { kind: 'store', id: storeProfile.id }",
  'storeProfile.orderCount || 0',
  'storeProfile.totalValue || 0',
  'window.dispatchEvent',
  'CustomEvent(',
  'MutationObserver',
  'document.querySelector',
  'overlayStack',
  'tertiary',
]) {
  if (`${manager}\n${contract}\n${dashboard}\n${priorityComponent}\n${priorityPresentation}`.includes(forbidden)) {
    throw new Error(`INTEL_FE_003B_UNVERIFIED_OR_UNBOUNDED_PATTERN: ${forbidden}`);
  }
}

for (const phrase of ['How to', 'Learn more', 'Getting started', 'Click here', 'You should', 'Next step', 'Tip:']) {
  if (`${manager}\n${css}\n${dashboard}\n${priorityComponent}`.includes(phrase)) {
    throw new Error(`INTEL_FE_003B_DEFAULT_GUIDANCE_COPY: ${phrase}`);
  }
}

for (const banned of ['!important', 'url(', '@font-face']) {
  if (css.includes(banned)) throw new Error(`INTEL_FE_003B_VISUAL_SCOPE_EXPANSION: ${banned}`);
}

for (const required of [
  'normaliseRelatedOverlayRecord',
  'relatedOverlayRecord',
  'OverlayRelatedRecordInput',
]) {
  if (!barrel.includes(required)) throw new Error(`INTEL_FE_003B_BARREL_EXPORT_MISSING: ${required}`);
}

for (const testName of [
  'primary records retain at most six explicit related entities',
  'related records convert into a standalone secondary inspector record',
  'empty related identities and labels are removed from a primary record',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_FE_003B_TEST_MISSING: ${testName}`);
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-related-inspector.mjs')
  || !auditCommand.includes('intel-related-inspector-contract.test.mjs')) {
  throw new Error('INTEL_FE_003B_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-003B related inspector audit passed.');
