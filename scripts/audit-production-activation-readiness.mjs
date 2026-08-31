import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  assert.ok(fs.existsSync(path), `Production activation prerequisite missing: ${path}`);
  return fs.readFileSync(path, 'utf8');
}

const runner = read('scripts/run-transient-supabase-command.mjs');
const tests = read('scripts/transient-supabase-command-contract.test.mjs');
const deployment = read('.github/workflows/deploy-supabase-migrations.yml');
const readinessWorkflow = read('.github/workflows/production-activation-readiness-check.yml');
const documentation = read('docs/INTEL-PHASE-9A-PRODUCTION-ACTIVATION-READINESS.md');

for (const marker of [
  'transientSupabaseFailurePatterns',
  '/\\b429\\b/',
  '/\\b502\\b/',
  '/\\b503\\b/',
  '/\\b504\\b/',
  'origin_bad_gateway',
  'unexpected list functions status',
  'retryAfterMilliseconds',
  'retryDelayMilliseconds',
  'maximumDelayMilliseconds',
  "shell: false",
  'slice(-262_144)',
]) {
  assert.ok(runner.includes(marker), `Transient runner contract missing: ${marker}`);
}

for (const marker of [
  'Supabase and Cloudflare 502 responses as transient',
  'rate limits and temporary network failures as transient',
  'does not retry deterministic migration and permission failures',
  'honours an upstream retry_after value',
  'parses a bounded command without invoking a shell',
]) {
  assert.ok(tests.includes(marker), `Transient runner test coverage missing: ${marker}`);
}

for (const marker of [
  'concurrency:',
  'group: ecoflow-supabase-production-migrations',
  'cancel-in-progress: false',
  'environment: production',
  'Verify transient deployment retry contract',
  'Link production project with transient retry',
  '--attempts 5',
  '--base-delay-ms 20000',
  '--max-delay-ms 120000',
  'supabase-migration-deploy.log',
]) {
  assert.ok(deployment.includes(marker), `Production deployment reliability marker missing: ${marker}`);
}

for (const functionName of [
  'trigger-ordermentum-sync',
  'notify-route-start',
  'delivery-notification-dispatch',
  'statement-dispatch',
  'storage-retention',
  'trigger-unleashed-readonly-sync',
]) {
  const command = `-- supabase functions deploy ${functionName} --project-ref`;
  assert.ok(deployment.includes(command), `Edge Function retry wiring missing: ${functionName}`);
}
assert.equal(
  (deployment.match(/node scripts\/run-transient-supabase-command\.mjs/g) ?? []).length,
  7,
  'Production deployment must use the retry runner for one link and six Edge Functions',
);
assert.ok(!deployment.includes('pull_request:'), 'Production deployment must never run from a pull request');

for (const forbidden of [
  'apply_intelligence_release_flag_command',
  'record_intelligence_release_verification',
  "nextState: 'ON'",
  'rollout_state = \'ON\'',
]) {
  assert.ok(!`${runner}\n${deployment}`.includes(forbidden), `Deployment reliability crossed the release-control boundary: ${forbidden}`);
}

for (const marker of [
  'Phase 9A — Production Activation Readiness',
  'engineering-complete',
  'Production activation is a separate operational programme',
  'multiple full business days',
  'Missing evidence remains `UNAVAILABLE`',
  'Direct `OFF` to `ON` transition remains forbidden',
  'Vercel `build-rate-limit`',
  'GitHub issues `#36` through `#41`',
  'Actual production activation remains incomplete',
]) {
  assert.ok(documentation.includes(marker), `Production activation documentation missing: ${marker}`);
}

for (const marker of [
  'Audit production activation readiness',
  'Execute transient Supabase retry contract tests',
  'Validate production deployment workflow syntax',
]) {
  assert.ok(readinessWorkflow.includes(marker), `Production activation CI marker missing: ${marker}`);
}

console.log('INTEL-PROD-001 through INTEL-PROD-004 production activation readiness audit passed: transient deploy recovery, fail-closed semantics, multi-day evidence boundary and operational backlog reconciliation.');
