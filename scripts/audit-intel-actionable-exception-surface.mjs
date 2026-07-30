import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_UI_003B_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const component = read('src/features/intelligence/attention/ActionableExceptionQueue.tsx');
const presentation = read('src/features/intelligence/attention/actionableExceptionPresentationContract.ts');
const css = read('src/features/intelligence/attention/actionableExceptionQueue.css');
const barrel = read('src/features/intelligence/attention/index.ts');
const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const app = read('src/app/App.tsx');
const repository = read('src/data/repositories/actionableExceptionRepository.ts');
const tests = read('scripts/intel-actionable-exception-surface-contract.test.mjs');
const designTokens = read('src/features/intelligence/designSystem/tokens.css');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  'ActionableExceptionQueue',
  'repository.readActionableExceptions()',
  'actionableExceptionReadFailure(error)',
  'const EMPTY_ATTENTION_QUEUE: AttentionQueue',
  'records.length',
  'buildAttentionQueue(records.map((record) => record.input), nowAt ??',
  ': EMPTY_ATTENTION_QUEUE',
  'latestActionableExceptionReadAt(records)',
  'buildActionableExceptionDisplayRows(records, orderedItems)',
  '<table className="ef-actionable-exceptions__table">',
  '<caption className="ef-actionable-exceptions__sr-only">',
  '<th scope="col">Exception</th>',
  '<th scope="col">Severity</th>',
  '<th scope="col">SLA</th>',
  '<th scope="col">Owner</th>',
  '<th scope="col">Impact</th>',
  'Current active source only',
  'Governed severity, SLA, owner, impact and recommended action are unavailable.',
  'Current active exceptions unavailable',
  'No current active exceptions',
  'openPrimaryRecord({',
  "entity: { kind: 'exception', id: row.item.id }",
  'relatedRecords: orderId ? [{',
  "entity: { kind: 'order', id: orderId }",
  'Verified source identifiers',
]) {
  if (!component.includes(marker)) throw new Error(`INTEL_UI_003B_COMPONENT_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  'supabase',
  '.schema(',
  '.rpc(',
  '.from(',
  'fetch(',
  '.insert(',
  '.update(',
  '.upsert(',
  '.delete(',
  'readShadowProjection',
  'readReconciliation',
  'localStorage',
  'sessionStorage',
  'window.',
  'document.',
  'MutationObserver',
  'CustomEvent(',
  'dispatchEvent(',
  'Date.now(',
  'new Date()',
]) {
  if (component.includes(forbidden)) throw new Error(`INTEL_UI_003B_COMPONENT_SCOPE_EXPANSION: ${forbidden}`);
}

for (const forbidden of [
  'acknowledge',
  'assign',
  'snooze',
  'resolve',
  'dismiss',
  'recommendedAction:',
  "severity: 'critical'",
  "severity: 'high'",
  'impactTotal',
  'totalImpact',
  'sumImpact',
  'averageImpact',
  '.reduce(',
]) {
  if (`${component}\n${presentation}`.includes(forbidden)) {
    throw new Error(`INTEL_UI_003B_MUTATION_GUESS_OR_AGGREGATION: ${forbidden}`);
  }
}

for (const marker of [
  'latestActionableExceptionReadAt',
  'formatActionableExceptionMoment',
  'formatActionableExceptionAge',
  'actionableExceptionCapabilityLabel',
  'actionableExceptionOrderReference',
  'actionableExceptionSurfaceTone',
  'buildActionableExceptionDisplayRows',
  'actionableExceptionSurfaceSummary',
  "record.capabilities.lifecycle === 'CURRENT_ACTIVE_ONLY' ? 'information' : 'warning'",
  "severityLabel: item.severity === 'unknown' ? 'Unknown'",
  "slaLabel: actionableExceptionCapabilityLabel(record.capabilities.sla)",
  "ownerLabel: actionableExceptionCapabilityLabel(record.capabilities.ownership)",
  "impactLabel: actionableExceptionCapabilityLabel(record.capabilities.impact)",
]) {
  if (!presentation.includes(marker)) throw new Error(`INTEL_UI_003B_PRESENTATION_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  'sourceStatus ===',
  'sourceStatus.includes',
  'sourceStatus.startsWith',
  'MAPPING_EXCEPTION',
  'PAYMENT_REVIEW',
  'STOCK_BLOCKED',
  'OPEN_EXCEPTION',
  'Number(null)',
  '?? 0',
  '|| 0',
]) {
  if (presentation.includes(forbidden)) throw new Error(`INTEL_UI_003B_SOURCE_STATUS_INFERENCE: ${forbidden}`);
}

for (const marker of [
  '.ef-actionable-exceptions',
  '.ef-actionable-exceptions__actions',
  '.ef-actionable-exceptions__table-shell',
  '.ef-actionable-exceptions__table',
  '.ef-actionable-exceptions__capability',
  '@media (max-width: 640px)',
  '@media (prefers-contrast: more)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!css.includes(marker)) throw new Error(`INTEL_UI_003B_STYLE_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  '!important',
  '@font-face',
  'url(',
  '.orders-',
  '.inventory-',
  '.delivery-',
  '.warehouse-',
  '.ops-control-',
]) {
  if (css.includes(forbidden)) throw new Error(`INTEL_UI_003B_STYLE_SCOPE_EXPANSION: ${forbidden}`);
}

const publishedTokens = new Set(
  Array.from(designTokens.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
const localTokens = new Set(
  Array.from(css.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
for (const reference of Array.from(css.matchAll(/var\((--ef-[a-z0-9-]+)/gi), (match) => match[1])) {
  if (!publishedTokens.has(reference) && !localTokens.has(reference)) {
    throw new Error(`INTEL_UI_003B_UNPUBLISHED_DESIGN_TOKEN: ${reference}`);
  }
}

for (const marker of [
  "import { ActionableExceptionQueue } from '@/features/intelligence/attention';",
  "<ActionableExceptionQueue onOpenOrders={() => onOpenTab('orders')} />",
  'eyebrow="Needs attention"',
  'title="Operational queues"',
  "{ id: 'finance', title: 'Finance review'",
  "{ id: 'pod', title: 'Delivery proof incomplete'",
  "{ id: 'ready', title: 'Ready",
]) {
  if (!dashboard.includes(marker)) throw new Error(`INTEL_UI_003B_DASHBOARD_INTEGRATION_MISSING: ${marker}`);
}
if ((dashboard.match(/<ActionableExceptionQueue /g) ?? []).length !== 1) {
  throw new Error('INTEL_UI_003B_DASHBOARD_SURFACE_COUNT_INVALID');
}
for (const forbidden of [
  'actionableExceptionRepository',
  'readActionableExceptions',
  'buildAttentionQueue',
  'Current active exceptions"',
]) {
  if (dashboard.includes(forbidden)) throw new Error(`INTEL_UI_003B_DASHBOARD_DATA_COUPLING: ${forbidden}`);
}
if (dashboard.includes('title="Needs attention"')) {
  throw new Error('INTEL_UI_003B_OLD_AGGREGATE_ATTENTION_TITLE_REMAINS');
}
if (app.includes('ActionableExceptionQueue') || app.includes('actionableExceptionRepository')) {
  throw new Error('INTEL_UI_003B_APP_SCOPE_EXPANSION');
}

if ((repository.match(/\.rpc\(/g) ?? []).length !== 1
  || !repository.includes('.rpc(actionableExceptionRpcName, { p_limit: request.request.limit })')) {
  throw new Error('INTEL_UI_003B_REPOSITORY_BOUNDARY_CHANGED');
}

for (const marker of [
  'ActionableExceptionQueue',
  'type ActionableExceptionQueueProps',
  'buildActionableExceptionDisplayRows',
  'formatActionableExceptionAge',
  'latestActionableExceptionReadAt',
]) {
  if (!barrel.includes(marker)) throw new Error(`INTEL_UI_003B_EXPORT_MISSING: ${marker}`);
}

for (const testName of [
  'latest read timestamp uses valid server read time only',
  'age formatting remains bounded and never manufactures missing age',
  'Adelaide moment formatting rejects invalid timestamps',
  'unavailable capability labels remain explicit',
  'display rows preserve queue order and enforce a bounded limit',
  'surface tone never interprets source status as severity',
  'order reference follows verified identifier precedence',
  'surface summary counts records and issues without business-impact aggregation',
  'empty presentation remains zero-count without unknown lifecycle or issues',
]) {
  if (!tests.includes(testName)) throw new Error(`INTEL_UI_003B_TEST_MISSING: ${testName}`);
}

for (const phrase of ['How to', 'Learn more', 'Getting started', 'Click here', 'You should', 'Next step', 'Tip:']) {
  if (`${component}\n${css}`.includes(phrase)) throw new Error(`INTEL_UI_003B_GUIDANCE_COPY: ${phrase}`);
}

for (const materializer of [
  '.github/workflows/materialize-intel-ui-003b.yml',
  '.github/workflows/materialize-intel-ui-003b-copy.yml',
]) {
  if (fs.existsSync(path.join(root, materializer))) {
    throw new Error(`INTEL_UI_003B_MATERIALIZER_REMAINS: ${materializer}`);
  }
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-actionable-exception-surface.mjs')
  || !auditCommand.includes('intel-actionable-exception-surface-contract.test.mjs')) {
  throw new Error('INTEL_UI_003B_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-UI-003B actionable exception surface audit passed.');
