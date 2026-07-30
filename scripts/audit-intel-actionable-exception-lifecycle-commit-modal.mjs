import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
function read(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`INTEL_UI_003C_FILE_MISSING: ${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

const queuePath = 'src/features/intelligence/attention/ActionableExceptionQueue.tsx';
const modalPath = 'src/features/intelligence/attention/ExceptionLifecycleCommitModal.tsx';
const presentationPath = 'src/features/intelligence/attention/actionableExceptionLifecyclePresentationContract.ts';
const stylePath = 'src/features/intelligence/attention/exceptionLifecycleCommitModal.css';
const testPath = 'scripts/intel-actionable-exception-lifecycle-presentation-contract.test.mjs';
const queue = read(queuePath);
const modal = read(modalPath);
const presentation = read(presentationPath);
const style = read(stylePath);
const test = read(testPath);
const dashboard = read('src/features/intelligence/dashboard/IntelligenceDashboard.tsx');
const app = read('src/app/App.tsx');
const index = read('src/features/intelligence/attention/index.ts');
const packageJson = JSON.parse(read('package.json'));

for (const marker of [
  'actionableExceptionLifecycleActionOptions',
  "if (!access || access.actionCapability !== 'AVAILABLE') return []",
  "if (state === 'RESOLVED') return ['REOPEN', 'ADD_NOTE']",
  "if (state === 'SNOOZED')",
  "if (state === 'ACKNOWLEDGED')",
  "if (state === 'OPEN')",
  'permitted.has(action)',
  "fieldKind: 'ownerTeam'",
  "fieldKind: 'snoozedUntil'",
  "fieldKind: 'resolutionNote'",
  "fieldKind: 'note'",
  'The active source exception is not deleted or dismissed.',
]) {
  if (!presentation.includes(marker)) throw new Error(`INTEL_UI_003C_PRESENTATION_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  /\bOWNER\b/,
  /\bADMIN\b/,
  /\bACCOUNT\b/,
  /\bVIEWER\b/,
  /supabase/i,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /sourceStatus/i,
  /severity/i,
  /\bsla\b/i,
  /businessImpact/i,
]) {
  if (forbidden.test(presentation)) {
    throw new Error(`INTEL_UI_003C_FORBIDDEN_PRESENTATION_AUTH_OR_FACT: ${forbidden}`);
  }
}

for (const marker of [
  'role="dialog"',
  'aria-modal="true"',
  'Governed lifecycle commit',
  'This does not change the Ordermentum order.',
  'globalThis.crypto?.randomUUID?.()',
  'setCommandId(createCommandId())',
  'const nextResult = await onCommit({',
  "nextResult.state === 'conflict'",
  'onConflict();',
  'Maximum 2,000 characters',
  'immutable audit history',
  'Commit acknowledgement',
  'Commit assignment',
  'Commit snooze',
  'Commit resolution',
  'Commit note',
]) {
  if (!modal.includes(marker)) throw new Error(`INTEL_UI_003C_MODAL_MARKER_MISSING: ${marker}`);
}

const modalCommitCalls = modal.match(/\bonCommit\s*\(/g) ?? [];
if (modalCommitCalls.length !== 1) {
  throw new Error(`INTEL_UI_003C_MODAL_COMMIT_CALL_COUNT_INVALID: ${modalCommitCalls.length}`);
}

for (const forbidden of [
  /Math\.random/,
  /setTimeout/,
  /setInterval/,
  /while\s*\(/,
  /MutationObserver/,
  /CustomEvent/,
  /dispatchEvent/,
  /document\.querySelector/,
  /document\.getElementById/,
  /localStorage/,
  /sessionStorage/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /supabase/i,
]) {
  if (forbidden.test(modal)) throw new Error(`INTEL_UI_003C_FORBIDDEN_MODAL_PATTERN: ${forbidden}`);
}

for (const marker of [
  'actionableExceptionLifecycleRepository',
  'actionableExceptionLifecycleAccessRepository',
  'Promise.allSettled([',
  'lifecycleAccessRepository.readAccess()',
  'lifecycleRepository.readLifecycle(',
  "access?.actionCapability !== 'AVAILABLE'",
  "if (!lifecycle && lifecycleResult.state === 'partial') return false",
  'lifecycleRepository.applyCommand(input)',
  'setReloadVersion((version) => version + 1)',
  'ExceptionLifecycleCommitModal',
  'LIFECYCLE READ ONLY',
  'Manage lifecycle for',
  'Lifecycle status, owner and audit history are governed separately.',
]) {
  if (!queue.includes(marker)) throw new Error(`INTEL_UI_003C_QUEUE_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  /\.schema\s*\(/,
  /\.rpc\s*\(/,
  /\.from\s*\(/,
  /v_ecoflow_ordermentum_ui_active_exceptions/,
  /analytics\.actionable_exception_lifecycle/,
  /Math\.random/,
  /setTimeout/,
  /setInterval/,
  /MutationObserver/,
  /CustomEvent/,
  /dispatchEvent/,
  /document\.querySelector/,
  /localStorage/,
  /sessionStorage/,
]) {
  if (forbidden.test(queue)) throw new Error(`INTEL_UI_003C_FORBIDDEN_QUEUE_PATTERN: ${forbidden}`);
}

for (const marker of [
  '.ef-lifecycle-commit-modal',
  'position: fixed',
  'role',
  '.ef-lifecycle-commit-modal__dialog',
  '.ef-lifecycle-commit-modal__textarea',
  '.ef-lifecycle-commit-modal__review',
  '.ef-lifecycle-commit-modal__footer',
  '@media (max-width: 640px)',
  '@media (prefers-contrast: more)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (!style.includes(marker)) throw new Error(`INTEL_UI_003C_STYLE_MARKER_MISSING: ${marker}`);
}

for (const marker of [
  'Writer can start a lifecycle record only with server-authorised actions',
  'Viewer and unknown access never receive lifecycle commit actions',
  'server command list remains an upper bound on UI actions',
  'resolved state offers only reopen and immutable note actions',
  'unknown lifecycle state fails closed',
  'lifecycle labels distinguish no row, unavailable read and governed states',
]) {
  if (!test.includes(marker)) throw new Error(`INTEL_UI_003C_TEST_MARKER_MISSING: ${marker}`);
}

for (const forbidden of [
  'actionableExceptionLifecycleRepository',
  'actionableExceptionLifecycleAccessRepository',
  'ExceptionLifecycleCommitModal',
  'applyActionableException',
  'normaliseActionableExceptionLifecycle',
]) {
  if (dashboard.includes(forbidden) || app.includes(forbidden)) {
    throw new Error(`INTEL_UI_003C_PAGE_COUPLING: ${forbidden}`);
  }
}

for (const marker of [
  'ExceptionLifecycleCommitModal',
  'actionableExceptionLifecycleActionOptions',
  'ActionableExceptionLifecycleActionOption',
]) {
  if (!index.includes(marker)) throw new Error(`INTEL_UI_003C_EXPORT_MISSING: ${marker}`);
}

const frontendAudit = packageJson.scripts?.['audit:intel-frontend'];
if (typeof frontendAudit !== 'string'
  || !frontendAudit.includes('audit-intel-actionable-exception-lifecycle-commit-modal.mjs')
  || !frontendAudit.includes('intel-actionable-exception-lifecycle-presentation-contract.test.mjs')) {
  throw new Error('INTEL_UI_003C_PACKAGE_WIRING_MISSING');
}

console.log('INTEL-UI-003C lifecycle commit modal audit passed.');
