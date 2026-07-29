import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_004A_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const queryState = read('src/features/intelligence/navigation/queryState.ts');
const contract = read('src/features/intelligence/query/listQueryContract.ts');
const hook = read('src/features/intelligence/query/useWorkspaceListQuery.ts');
const barrel = read('src/features/intelligence/query/index.ts');
const test = read('scripts/intel-list-query-contract.test.mjs');
const packageJson = JSON.parse(read('package.json'));

for (const required of [
  'search?: string;',
  'pageSize?: number;',
  "boundedValue(params, 'q', issues)",
  "boundedPageSize(params, issues)",
  "appendIfPresent(params, 'q', state.search)",
  "params.set('limit', String(state.pageSize))",
  "'INVALID_PAGE_SIZE'",
]) {
  if (!queryState.includes(required)) throw new Error(`INTEL_FE_004A_WORKSPACE_QUERY_CONTRACT_MISSING: ${required}`);
}

for (const required of [
  'applyListQuery',
  'encodeListFilter',
  'decodeListFilter',
  'encodeListSort',
  'decodeListSort',
  'encodePageCursor',
  'decodePageCursor',
  'withListSearch',
  'withListFilters',
  'withListSort',
  'withListPage',
  'withListPageSize',
  'clearListQuery',
  'left.index - right.index',
  "Math.max(1, Math.ceil(total / pageSize))",
]) {
  if (!contract.includes(required)) throw new Error(`INTEL_FE_004A_LIST_QUERY_CONTRACT_MISSING: ${required}`);
}

for (const required of [
  'useWorkspaceListQuery',
  'useLocation',
  'useNavigate',
  'parseWorkspaceQuery',
  'serialiseWorkspaceQuery',
  'setSearch',
  'setFilter',
  'setSort',
  'setPage',
  'setPageSize',
]) {
  if (!hook.includes(required)) throw new Error(`INTEL_FE_004A_URL_HOOK_CONTRACT_MISSING: ${required}`);
}

for (const banned of [
  'document.',
  'window.',
  'localStorage',
  'sessionStorage',
  'CustomEvent(',
  'MutationObserver',
  'observeBody',
  'createPortal',
  'querySelector',
  '@/data/',
  '@/domain/',
  'supabase',
  'ImportedOrder',
  'StoreProfile',
]) {
  if (`${contract}\n${hook}`.includes(banned)) {
    throw new Error(`INTEL_FE_004A_BUSINESS_OR_DOM_COUPLING: ${banned}`);
  }
}

for (const phrase of ['How to', 'Learn more', 'Getting started', 'Click here', 'You should', 'Next step', 'Tip:']) {
  if (`${queryState}\n${contract}\n${hook}`.includes(phrase)) {
    throw new Error(`INTEL_FE_004A_DEFAULT_GUIDANCE_COPY: ${phrase}`);
  }
}

for (const required of [
  'ListQuerySchema',
  'ListQueryResult',
  'WorkspaceListQueryApi',
  'useWorkspaceListQuery',
]) {
  if (!barrel.includes(required)) throw new Error(`INTEL_FE_004A_PUBLIC_EXPORT_MISSING: ${required}`);
}

for (const testName of [
  'workspace query preserves search, page size and existing overlay context',
  'list query applies search, filters, stable sorting and bounded pagination',
  'same-field values are OR while different filter fields are AND',
  'invalid query tokens fall back deterministically and report issues',
  'page overflow clamps to the final page without losing the requested state issue',
  'list query mutations preserve workspace context and reset stale cursors',
  'workspace query rejects non-integer or excessive page sizes',
]) {
  if (!test.includes(testName)) throw new Error(`INTEL_FE_004A_TEST_MISSING: ${testName}`);
}

const auditCommand = packageJson.scripts?.['audit:intel-frontend'];
if (typeof auditCommand !== 'string'
  || !auditCommand.includes('audit-intel-list-query.mjs')
  || !auditCommand.includes('intel-list-query-contract.test.mjs')) {
  throw new Error('INTEL_FE_004A_PACKAGE_AUDIT_WIRING_MISSING');
}

console.log('INTEL-FE-004A list query foundation audit passed.');
