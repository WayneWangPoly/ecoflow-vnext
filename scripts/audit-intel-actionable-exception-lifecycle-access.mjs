import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_007C_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const contractPath = 'src/features/intelligence/attention/actionableExceptionLifecycleAccessContract.ts';
const repositoryPath = 'src/data/repositories/actionableExceptionLifecycleAccessRepository.ts';
const testPath = 'scripts/intel-actionable-exception-lifecycle-access-contract.test.mjs';
const contract = read(contractPath);
const repository = read(repositoryPath);
const test = read(testPath);
const index = read('src/features/intelligence/attention/index.ts');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  "'get_actionable_exception_lifecycle_access'",
  'normaliseActionableExceptionLifecycleAccess',
  "'AVAILABLE'",
  "'READ_ONLY'",
  'ACCESS_ACTIONS_MISMATCH',
  'commandIdRequired',
  'maxReadIds',
  'maxReadRows',
  'maxHistoryEvents',
  'maxSnoozeDays',
]) {
  if (!contract.includes(marker)) throw new Error(`INTEL_FE_007C_CONTRACT_MARKER_MISSING: ${marker}`);
}

for (const marker of [
  ".schema('analytics')",
  '.rpc(actionableExceptionLifecycleAccessRpcName)',
  'normaliseActionableExceptionLifecycleAccess(result.data)',
  'INVALID_ACCESS_RESULT',
]) {
  if (!repository.includes(marker)) throw new Error(`INTEL_FE_007C_REPOSITORY_MARKER_MISSING: ${marker}`);
}

const rpcCalls = repository.match(/\.rpc\(/g) ?? [];
if (rpcCalls.length !== 1) throw new Error(`INTEL_FE_007C_RPC_COUNT_INVALID: ${rpcCalls.length}`);

for (const forbidden of [
  /\.from\s*\(/,
  /apply_actionable_exception_lifecycle_command/,
  /get_actionable_exception_lifecycle(?:['"]|\s*\()/,
  /v_ecoflow_ordermentum_ui_active_exceptions/,
  /actionable_exception_lifecycle_event/,
  /crypto\.randomUUID/,
  /randomUUID/,
  /setTimeout/,
  /setInterval/,
  /React/,
  /\.tsx['"]/,
  /\.css['"]/,
  /Dashboard/,
  /Overlay/,
  /CommitModal/,
  /localStorage/,
  /sessionStorage/,
  /CustomEvent/,
  /document\./,
  /window\./,
]) {
  if (forbidden.test(repository)) throw new Error(`INTEL_FE_007C_FORBIDDEN_REPOSITORY_PATTERN: ${forbidden}`);
}

for (const forbidden of [
  /react/i,
  /\.tsx['"]/,
  /\.css['"]/,
  /supabase/i,
  /Dashboard/,
  /Overlay/,
  /CommitModal/,
  /localStorage/,
  /sessionStorage/,
  /document\./,
  /window\./,
]) {
  if (forbidden.test(contract)) throw new Error(`INTEL_FE_007C_FORBIDDEN_CONTRACT_PATTERN: ${forbidden}`);
}

for (const marker of [
  'normaliseActionableExceptionLifecycleAccess',
  'actionableExceptionLifecycleAccessRpcName',
  'ActionableExceptionLifecycleAccessResult',
]) {
  if (!index.includes(marker)) throw new Error(`INTEL_FE_007C_EXPORT_MISSING: ${marker}`);
}

for (const marker of [
  'Writer access envelope preserves exact governed command set and limits',
  'Viewer READ_ONLY envelope requires zero command actions',
  'Writer missing or reordered commands fails closed',
  'Viewer with any command action fails closed',
  'INVALID_ACCESS_TIMESTAMP',
]) {
  if (!test.includes(marker)) throw new Error(`INTEL_FE_007C_TEST_MARKER_MISSING: ${marker}`);
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
if (typeof frontendAudit !== 'string'
  || !frontendAudit.includes('audit-intel-actionable-exception-lifecycle-access.mjs')
  || !frontendAudit.includes('intel-actionable-exception-lifecycle-access-contract.test.mjs')) {
  throw new Error('INTEL_FE_007C_PACKAGE_WIRING_MISSING');
}

console.log('INTEL-FE-007C actionable exception lifecycle access repository audit passed.');
