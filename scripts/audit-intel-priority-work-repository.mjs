import assert from 'node:assert/strict';
import fs from 'node:fs';

const contractPath = 'src/features/intelligence/attention/priorityWorkContract.ts';
const repositoryPath = 'src/data/repositories/priorityWorkRepository.ts';
const indexPath = 'src/features/intelligence/attention/index.ts';
const testPath = 'scripts/intel-priority-work-repository-contract.test.mjs';
const packagePath = 'package.json';

for (const file of [contractPath, repositoryPath, indexPath, testPath, packagePath]) {
  assert.ok(fs.existsSync(file), `missing Priority Work repository file: ${file}`);
}

const contract = fs.readFileSync(contractPath, 'utf8');
const repository = fs.readFileSync(repositoryPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const tests = fs.readFileSync(testPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const dashboard = fs.readFileSync('src/features/dashboard/DashboardPage.tsx', 'utf8');
const queue = fs.readFileSync('src/features/intelligence/attention/ActionableExceptionQueue.tsx', 'utf8');
const app = fs.readFileSync('src/app/App.tsx', 'utf8');

for (const marker of [
  "priorityWorkRpcName = 'get_priority_work_queue'",
  'priorityWorkDefaultLimit = 20',
  'priorityWorkMaximumLimit = 100',
  "PriorityWorkCapability = 'POLICY_GOVERNED' | 'UNKNOWN'",
  "PriorityWorkLifecycleStatus = 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED'",
  'normalisePriorityWorkRequest',
  'normalisePriorityWorkRows',
  'comparePriorityOrder',
  'AGE_SNAPSHOT_MISMATCH',
  'READ_TIMESTAMP_MISMATCH',
  'ORDERING_MISMATCH',
  "priorityCapability !== 'POLICY_GOVERNED'",
  "orderEntityId.includes('/')",
  "row.lifecycle_status",
  'readTimes.size > 1',
  'return { rows: [], state: \'partial\', issues }',
]) {
  assert.ok(contract.includes(marker), `missing Priority Work contract marker: ${marker}`);
}

for (const forbidden of [
  /react/i,
  /\.tsx\b/i,
  /\.css\b/i,
  /supabase/i,
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /localStorage/,
  /sessionStorage/,
  /window\./,
  /document\./,
  /MutationObserver/,
  /CustomEvent/,
  /setTimeout/,
  /setInterval/,
  /Math\.random/,
]) {
  assert.ok(!forbidden.test(contract), `Priority Work contract scope expansion: ${forbidden}`);
}

for (const marker of [
  'createPriorityWorkRepository',
  'readPriorityWork:',
  'normalisePriorityWorkRequest(limit)',
  'priorityWorkReadFailure({',
  ".schema('analytics')",
  '.rpc(priorityWorkRpcName, { p_limit: request.request.limit })',
  'normalisePriorityWorkRows(result.data)',
  'priorityWorkReadSuccess(',
  "code: 'NOT_CONFIGURED'",
]) {
  assert.ok(repository.includes(marker), `missing Priority Work repository marker: ${marker}`);
}

assert.equal(
  (repository.match(/\.rpc\s*\(/g) ?? []).length,
  1,
  'Priority Work repository must issue exactly one RPC call',
);

for (const forbidden of [
  /get_actionable_exception_queue/,
  /get_actionable_exception_lifecycle/,
  /apply_actionable_exception_lifecycle_command/,
  /\.from\s*\(/,
  /sort\s*\(/,
  /reverse\s*\(/,
  /insert\s*\(/i,
  /update\s*\(/i,
  /upsert\s*\(/i,
  /delete\s*\(/i,
  /setTimeout/,
  /setInterval/,
  /while\s*\(/,
  /Math\.random/,
  /localStorage/,
  /sessionStorage/,
  /MutationObserver/,
  /CustomEvent/,
  /dispatchEvent/,
]) {
  assert.ok(!forbidden.test(repository), `Priority Work repository scope expansion: ${forbidden}`);
}

for (const marker of [
  'priorityWorkRpcName',
  'normalisePriorityWorkRequest',
  'normalisePriorityWorkRows',
  'PriorityWorkRecord',
  'PriorityWorkReadResult',
]) {
  assert.ok(index.includes(marker), `Priority Work export missing: ${marker}`);
}

for (const testName of [
  'Priority Work request defaults to 20 and accepts only bounded integer limits',
  'valid Priority Work preserves server policy order and complete work fields',
  'client reports server ordering drift without silently re-sorting Priority Work',
  'duplicate identities are omitted rather than duplicated in Priority Work',
  'identity policy capability and required field drift fail closed',
  'resolved lifecycle and unsafe Order identities never become Priority Work',
  'age must reconcile with the same server snapshot',
  'cross-row read timestamp mismatch removes all Priority Work rows',
  'invalid result and empty result remain distinct',
  'Priority Work errors classify forbidden invalid unavailable and failed states',
]) {
  assert.ok(tests.includes(testName), `Priority Work contract test missing: ${testName}`);
}

for (const forbidden of [
  'priorityWorkRepository',
  'readPriorityWork',
  'priorityWorkContract',
  'get_priority_work_queue',
]) {
  assert.ok(!dashboard.includes(forbidden), `premature Dashboard Priority Work adoption: ${forbidden}`);
  assert.ok(!queue.includes(forbidden), `exception queue coupled to Priority Work: ${forbidden}`);
  assert.ok(!app.includes(forbidden), `App coupled to Priority Work: ${forbidden}`);
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
assert.equal(typeof frontendAudit, 'string', 'audit:intel-frontend command missing');
assert.ok(
  frontendAudit.includes('audit-intel-priority-work-repository.mjs')
    && frontendAudit.includes('intel-priority-work-repository-contract.test.mjs'),
  'Priority Work repository checks are not wired to audit:intel-frontend',
);

console.log('INTEL-FE-009A Priority Work repository audit passed.');
