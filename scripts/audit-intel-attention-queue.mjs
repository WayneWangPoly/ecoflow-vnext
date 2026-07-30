import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_UI_003A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const contract = read('src/features/intelligence/attention/attentionQueueContract.ts');
const barrel = read('src/features/intelligence/attention/index.ts');
const tests = read('scripts/intel-attention-queue-contract.test.mjs');
const dashboard = read('src/features/dashboard/DashboardPage.tsx');
const app = read('src/app/App.tsx');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  'AttentionSeverity',
  'AttentionStatus',
  'AttentionSlaState',
  'AttentionImpact',
  'AttentionHandoff',
  'AttentionHistoryEvent',
  'AttentionQueueIssueCode',
  'normaliseAttentionItem',
  'attentionSlaState',
  'compareAttentionPriority',
  'buildAttentionQueue',
  "value: number | null",
  "affectedCount: number | null",
  "state: AttentionQueueState",
  "const MAX_ITEMS = 500",
  "const MAX_NOTES = 8",
  "const MAX_HISTORY_EVENTS = 20",
  "return 'unknown'",
  "value = null",
  "entityKind: null, entityId: null",
]) {
  if (!contract.includes(marker)) throw new Error(`INTEL_UI_003A_CONTRACT_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  'react',
  'supabase',
  '@/data/',
  '@/domain/',
  '.from(',
  '.rpc(',
  'fetch(',
  '.insert(',
  '.update(',
  '.upsert(',
  '.delete(',
  'localStorage',
  'sessionStorage',
  'window.',
  'document.',
  'MutationObserver',
  'CustomEvent(',
  'dispatchEvent(',
  'Date.now(',
  '.reduce(',
  'impactTotal',
  'totalImpact',
  'sumImpact',
  'averageImpact',
  '.css',
  '.tsx',
]) {
  if (contract.includes(forbidden)) throw new Error(`INTEL_UI_003A_DATA_OR_RUNTIME_COUPLING: ${forbidden}`);
}

for (const forbidden of [
  "recommendedAction: 'Open",
  "recommendedAction: 'Review",
  "ownerTeam: 'Operations'",
  "ownerTeam: 'Accounts'",
  "ownerTeam: 'Warehouse'",
  'value ?? 0',
  'value || 0',
  'affectedCount ?? 0',
  'affectedCount || 0',
  'Number(null)',
]) {
  if (contract.includes(forbidden)) throw new Error(`INTEL_UI_003A_SILENT_DEFAULT_OR_FAKE_ACTION: ${forbidden}`);
}

for (const marker of [
  "order: 'orders'",
  "'commercial-sku': 'inventory'",
  "'physical-sku': 'inventory'",
  "customer: 'customers'",
  "store: 'stores'",
  "'delivery-run': 'delivery'",
  "return: 'returns'",
  "exception: 'exceptions'",
  "dataset: 'analytics'",
]) {
  if (!contract.includes(marker)) throw new Error(`INTEL_UI_003A_HANDOFF_MAP_MISSING: ${marker}`);
}

for (const marker of [
  'buildAttentionQueue',
  'normaliseAttentionItem',
  'type AttentionQueue',
  'type AttentionQueueItem',
  'type AttentionHandoff',
]) {
  if (!barrel.includes(marker)) throw new Error(`INTEL_UI_003A_EXPORT_MISSING: ${marker}`);
}

for (const testName of [
  'attention impact preserves confirmed zero and keeps missing values null',
  'unknown severity and status fail closed without becoming an active high-priority item',
  'active queue ranks breached SLA before severity and remains deterministic',
  'closed attention items never report an SLA breach',
  'duplicate attention identities are omitted and reported',
  'incompatible entity handoff degrades to a workspace-only target',
  'resolution fields on active attention are suppressed rather than exposed as resolved facts',
  'queue summary counts records without aggregating mixed business-impact units',
  'future detection time remains visible but has no manufactured age',
]) {
  if (!tests.includes(testName)) throw new Error(`INTEL_UI_003A_TEST_MISSING: ${testName}`);
}

// Later packages may adopt a bounded public Attention component on a page. The
// domain contract itself must remain page-agnostic, and pages must not call the
// queue builder, normaliser or repository directly.
for (const forbidden of [
  'buildAttentionQueue',
  'normaliseAttentionItem',
  'attentionQueueContract',
  'actionableExceptionRepository',
  'readActionableExceptions',
]) {
  if (dashboard.includes(forbidden)) {
    throw new Error(`INTEL_UI_003A_DASHBOARD_DIRECT_CONTRACT_COUPLING: ${forbidden}`);
  }
}

for (const forbidden of [
  "intelligence/attention",
  'buildAttentionQueue',
  'normaliseAttentionItem',
  'actionableExceptionRepository',
  'readActionableExceptions',
]) {
  if (app.includes(forbidden)) {
    throw new Error(`INTEL_UI_003A_APP_ADOPTION_NOT_ALLOWED: ${forbidden}`);
  }
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-attention-queue.mjs')
  || !auditCommand.includes('intel-attention-queue-contract.test.mjs')) {
  throw new Error('INTEL_UI_003A_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-UI-003A attention queue contract audit passed.');
