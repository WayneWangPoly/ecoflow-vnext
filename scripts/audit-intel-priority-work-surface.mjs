import './audit-intel-phase-3-control-room-gate.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const componentPath = 'src/features/intelligence/attention/PriorityWork.tsx';
const presentationPath = 'src/features/intelligence/attention/priorityWorkPresentationContract.ts';
const stylePath = 'src/features/intelligence/attention/priorityWork.css';
const testPath = 'scripts/intel-priority-work-surface-contract.test.mjs';
const dashboardPath = 'src/features/dashboard/DashboardPage.tsx';
const indexPath = 'src/features/intelligence/attention/index.ts';
const packagePath = 'package.json';

for (const file of [componentPath, presentationPath, stylePath, testPath, dashboardPath, indexPath, packagePath]) {
  assert.ok(fs.existsSync(file), `missing Priority Work surface file: ${file}`);
}

const component = fs.readFileSync(componentPath, 'utf8');
const presentation = fs.readFileSync(presentationPath, 'utf8');
const style = fs.readFileSync(stylePath, 'utf8');
const tests = fs.readFileSync(testPath, 'utf8');
const dashboard = fs.readFileSync(dashboardPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const designTokens = fs.readFileSync('src/features/intelligence/designSystem/tokens.css', 'utf8');
const queue = fs.readFileSync('src/features/intelligence/attention/ActionableExceptionQueue.tsx', 'utf8');
const app = fs.readFileSync('src/app/App.tsx', 'utf8');

for (const marker of [
  'PriorityWork',
  'repository = priorityWorkRepository',
  'repository.readPriorityWork(limit)',
  'priorityWorkReadFailure(error)',
  'POLICY-RANKED · CURRENT EXCEPTIONS',
  'Order · cause · impact · age · owner · next action',
  '<th scope="col">Order</th>',
  '<th scope="col">Cause</th>',
  '<th scope="col">Impact</th>',
  '<th scope="col">Age</th>',
  '<th scope="col">Owner</th>',
  '<th scope="col">Next action</th>',
  'Open order',
  'priorityWorkOrderRoute(record)',
  'navigate(route.href)',
  'Server policy rank · Unassigned first · Oldest first · Resolved and active-snoozed work excluded.',
]) {
  assert.ok(component.includes(marker), `missing Priority Work surface marker: ${marker}`);
}

assert.equal(
  (component.match(/repository\.readPriorityWork\(limit\)/g) ?? []).length,
  1,
  'Priority Work surface must issue one repository read per load',
);

for (const forbidden of [
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /get_priority_work_queue/,
  /get_actionable_exception_queue/,
  /apply_actionable_exception_lifecycle_command/,
  /\.sort\s*\(/,
  /\.reverse\s*\(/,
  /FLOW_PRIORITY/,
  /openExceptionCount/,
  /lastSeenAt/,
  /\bmoney\s*\(/,
  /\bamount\b/,
  /\bPOD\b/,
  /\bseverity\b/i,
  /\bSLA\b/,
  /\bdue\b/i,
  /recommendedAction/,
  /insert\s*\(/i,
  /update\s*\(/i,
  /upsert\s*\(/i,
  /delete\s*\(/i,
  /localStorage/,
  /sessionStorage/,
  /window\./,
  /document\./,
  /MutationObserver/,
  /CustomEvent/,
  /dispatchEvent/,
  /setTimeout/,
  /setInterval/,
  /Math\.random/,
]) {
  assert.ok(!forbidden.test(component), `Priority Work surface scope expansion: ${forbidden}`);
}

for (const marker of [
  'priorityWorkSummary',
  'formatPriorityWorkAge',
  'formatPriorityWorkMoment',
  'priorityWorkOwnerLabel',
  'priorityWorkLifecycleLabel',
  'priorityWorkOrderRoute',
  'withWorkspaceQuery(pathname, query)',
  "timeZone: 'Australia/Adelaide'",
]) {
  assert.ok(presentation.includes(marker), `missing Priority Work presentation marker: ${marker}`);
}
assert.match(
  presentation,
  /return\s+ownerTeam\s*\?\?\s*['"]Unassigned['"]\s*;/,
  'Priority Work must label null ownership as Unassigned',
);
assert.match(
  presentation,
  /primaryDrawer\s*:\s*`order:\$\{record\.orderEntityId\}`/,
  'Priority Work Order route must select the canonical Order drawer',
);
assert.match(
  presentation,
  /matched\.route\.workspace\s*!==\s*['"]orders['"]/,
  'Priority Work Order route must verify the Orders workspace',
);
assert.match(
  presentation,
  /matched\.route\.entityKind\s*!==\s*['"]order['"]/,
  'Priority Work Order route must verify the Order entity kind',
);

for (const forbidden of [
  /react/i,
  /useNavigate/,
  /supabase/i,
  /priorityWorkRepository/,
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /\.sort\s*\(/,
  /FLOW_PRIORITY/,
  /openExceptionCount/,
  /lastSeenAt/,
  /\bmoney\b/,
  /\bamount\b/,
  /\bseverity\b/i,
  /\bSLA\b/,
]) {
  assert.ok(!forbidden.test(presentation), `Priority Work presentation scope expansion: ${forbidden}`);
}

for (const marker of [
  '.ef-priority-work__actions',
  '.ef-priority-work__table-shell',
  '.ef-priority-work__table',
  '.ef-priority-work__boundary',
  '.ef-priority-work__sr-only',
  '@media (max-width: 920px)',
  '@media (max-width: 640px)',
  '@media (prefers-contrast: more)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  assert.ok(style.includes(marker), `missing Priority Work style marker: ${marker}`);
}

for (const forbidden of ['!important', '@font-face', 'url(', '#root', '.orders-', '.inventory-', '.warehouse-', '.delivery-', '.ops-control-']) {
  assert.ok(!style.includes(forbidden), `Priority Work style scope expansion: ${forbidden}`);
}

const publishedTokens = new Set(
  Array.from(designTokens.matchAll(/(--ef-[a-z0-9-]+)\s*:/gi), (match) => match[1]),
);
for (const reference of Array.from(style.matchAll(/var\((--ef-[a-z0-9-]+)/gi), (match) => match[1])) {
  assert.ok(publishedTokens.has(reference), `Priority Work uses unpublished design token: ${reference}`);
}

for (const testName of [
  'Priority Work summary preserves server work metadata without local scoring',
  'Priority Work age formatting uses server age seconds',
  'Priority Work owner and lifecycle labels remain explicit',
  'Priority Work Order route opens canonical Orders drawer',
  'unsafe Priority Work Order identity has no route',
  'Priority Work moments use Adelaide time and reject invalid values',
]) {
  assert.ok(tests.includes(testName), `Priority Work surface test missing: ${testName}`);
}

assert.ok(
  dashboard.includes("import { ActionableExceptionQueue, PriorityWork } from '@/features/intelligence/attention';")
    && dashboard.includes('<PriorityWork />'),
  'Dashboard must adopt only the public Priority Work component',
);
assert.equal(
  (dashboard.match(/<PriorityWork \/>/g) ?? []).length,
  1,
  'Dashboard must adopt Priority Work exactly once',
);

for (const forbidden of [
  'priorityWorkRepository',
  'readPriorityWork',
  'priorityWorkContract',
  'get_priority_work_queue',
  'FLOW_PRIORITY',
  'activeOrders',
  'ops-control-order-table',
  'ops-control-order-row',
  'Top {activeOrders.length}',
  'No open orders.',
]) {
  assert.ok(!dashboard.includes(forbidden), `Dashboard retained local or direct Priority Work logic: ${forbidden}`);
}

for (const marker of [
  'PriorityWork',
  'PriorityWorkProps',
  'priorityWorkSummary',
  'priorityWorkOrderRoute',
  'formatPriorityWorkAge',
]) {
  assert.ok(index.includes(marker), `Priority Work surface export missing: ${marker}`);
}

for (const forbidden of ['PriorityWork', 'priorityWorkRepository', 'readPriorityWork']) {
  assert.ok(!queue.includes(forbidden), `Exception Queue adopted Priority Work: ${forbidden}`);
  assert.ok(!app.includes(forbidden), `App directly adopted Priority Work: ${forbidden}`);
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
assert.equal(typeof frontendAudit, 'string', 'audit:intel-frontend command missing');
assert.ok(
  frontendAudit.includes('audit-intel-priority-work-surface.mjs')
    && frontendAudit.includes('intel-priority-work-surface-contract.test.mjs'),
  'Priority Work surface checks are not wired to audit:intel-frontend',
);

console.log('INTEL-UI-006A Priority Work surface audit passed.');
