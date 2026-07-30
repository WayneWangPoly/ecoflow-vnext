import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_FE_007B_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const contractPath = 'src/features/intelligence/attention/actionableExceptionLifecycleContract.ts';
const repositoryPath = 'src/data/repositories/actionableExceptionLifecycleRepository.ts';
const testPath = 'scripts/intel-actionable-exception-lifecycle-repository-contract.test.mjs';
const contract = read(contractPath);
const repository = read(repositoryPath);
const test = read(testPath);
const attentionIndex = read('src/features/intelligence/attention/index.ts');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  "'get_actionable_exception_lifecycle'",
  "'apply_actionable_exception_lifecycle_command'",
  "'AVAILABLE' | 'READ_ONLY' | 'UNKNOWN'",
  'normaliseActionableExceptionLifecycleReadRequest',
  'normaliseActionableExceptionLifecycleRows',
  'normaliseActionableExceptionLifecycleCommand',
  'normaliseActionableExceptionLifecycleCommandResult',
  'classifyActionableExceptionLifecycleError',
  'DUPLICATE_EXCEPTION_ID',
  'HISTORY_LIMIT_EXCEEDED',
  'SNOOZE_WINDOW_INVALID',
  'RESOLUTION_NOTE_REQUIRED',
  'NOTE_REQUIRED',
  "'conflict'",
]) {
  if (!contract.includes(marker)) throw new Error(`INTEL_FE_007B_CONTRACT_MARKER_MISSING: ${marker}`);
}

for (const marker of [
  '.schema(\'analytics\')',
  '.rpc(actionableExceptionLifecycleReadRpcName',
  '.rpc(actionableExceptionLifecycleCommandRpcName',
  'p_exception_ids: request.request.exceptionIds',
  'p_command_id: command.commandId',
  'p_exception_id: command.exceptionId',
  'p_action: command.action',
  'p_owner_team: command.ownerTeam',
  'p_snoozed_until: command.snoozedUntil',
  'p_resolution_note: command.resolutionNote',
  'p_note: command.note',
  'request.request.exceptionIds.length === 0',
]) {
  if (!repository.includes(marker)) throw new Error(`INTEL_FE_007B_REPOSITORY_MARKER_MISSING: ${marker}`);
}

const repositoryRpcCalls = repository.match(/\.rpc\(/g) ?? [];
if (repositoryRpcCalls.length !== 2) {
  throw new Error(`INTEL_FE_007B_RPC_COUNT_INVALID: ${repositoryRpcCalls.length}`);
}

for (const forbidden of [
  /\.from\s*\(/,
  /v_ecoflow_ordermentum_ui_active_exceptions/,
  /actionable_exception_lifecycle_event/,
  /actionable_exception_lifecycle(?:\W|$)/,
  /crypto\.randomUUID/,
  /randomUUID/,
  /setTimeout/,
  /setInterval/,
  /while\s*\(/,
  /for\s*\([^)]*retry/i,
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
  if (forbidden.test(repository)) {
    throw new Error(`INTEL_FE_007B_FORBIDDEN_REPOSITORY_PATTERN: ${forbidden}`);
  }
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
  if (forbidden.test(contract)) {
    throw new Error(`INTEL_FE_007B_FORBIDDEN_CONTRACT_PATTERN: ${forbidden}`);
  }
}

for (const marker of [
  'normaliseActionableExceptionLifecycleReadRequest',
  'normaliseActionableExceptionLifecycleRows',
  'normaliseActionableExceptionLifecycleCommand',
  'normaliseActionableExceptionLifecycleCommandResult',
  'classifyActionableExceptionLifecycleError',
]) {
  if (!attentionIndex.includes(marker)) throw new Error(`INTEL_FE_007B_EXPORT_MISSING: ${marker}`);
}

for (const marker of [
  'Viewer READ_ONLY capability remains explicit',
  'command normalisation enforces action-specific payloads',
  'command result preserves APPLIED and REPLAYED snapshots',
  'HISTORY_LIMIT_EXCEEDED',
  "state, 'conflict'",
]) {
  if (!test.includes(marker)) throw new Error(`INTEL_FE_007B_TEST_MARKER_MISSING: ${marker}`);
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
if (typeof frontendAudit !== 'string'
  || !frontendAudit.includes('audit-intel-actionable-exception-lifecycle-repository.mjs')
  || !frontendAudit.includes('intel-actionable-exception-lifecycle-repository-contract.test.mjs')) {
  throw new Error('INTEL_FE_007B_PACKAGE_WIRING_MISSING');
}

console.log('INTEL-FE-007B actionable exception lifecycle repository audit passed.');
