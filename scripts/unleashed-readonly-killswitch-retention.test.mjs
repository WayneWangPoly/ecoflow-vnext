import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  inspectUnleashedFunctionState,
  LEGACY_UNLEASHED_PROBES,
} from './unleashed-readonly-retirement-state.mjs';

const edgeFunction = await readFile('supabase/functions/trigger-unleashed-readonly-sync/index.ts', 'utf8');
const retentionMigration = await readFile('supabase/migrations/20260831160000_unleashed_raw_snapshot_retention.sql', 'utf8');
const retirementWorkflow = await readFile('.github/workflows/unleashed-readonly-production-retirement.yml', 'utf8');

test('removing either Unleashed credential is a fail-closed kill switch before outbound fetch', () => {
  const apiIdRead = edgeFunction.indexOf("Deno.env.get('UNLEASHED_API_ID')");
  const apiKeyRead = edgeFunction.indexOf("Deno.env.get('UNLEASHED_API_KEY')");
  const missingCredentialGuard = edgeFunction.indexOf('if (!unleashedApiId || !unleashedApiKey) {');
  const missingCredentialAudit = edgeFunction.indexOf("error_code: 'MISSING_UNLEASHED_API_SECRETS'");
  const missingCredentialReturn = edgeFunction.indexOf("return json(500, { error: 'MISSING_UNLEASHED_API_SECRETS'");
  const outboundFetch = edgeFunction.indexOf('await fetchUnleashedWithRetry(');

  assert.ok(apiIdRead >= 0, 'UNLEASHED_API_ID must remain server-side');
  assert.ok(apiKeyRead >= 0, 'UNLEASHED_API_KEY must remain server-side');
  assert.ok(missingCredentialGuard > apiIdRead && missingCredentialGuard > apiKeyRead,
    'credential absence must be checked after both secret reads');
  assert.ok(missingCredentialAudit > missingCredentialGuard,
    'kill-switch failure must be recorded before returning');
  assert.ok(missingCredentialReturn > missingCredentialAudit,
    'missing credentials must return a failed result after audit evidence is recorded');
  assert.ok(outboundFetch > missingCredentialReturn,
    'missing credentials must return before any outbound Unleashed fetch');
});

test('raw snapshot retention is fixed at 14 days and purge authority is service-role only', () => {
  assert.match(retentionMigration, /now\(\) - interval '14 days'/);
  assert.match(retentionMigration, /p_batch_size > 5000/);
  assert.match(retentionMigration, /delete from public\.unleashed_raw_snapshots/);
  assert.match(retentionMigration, /grant execute on function public\.purge_expired_unleashed_raw_snapshots\(integer\) to service_role/);
  assert.match(retentionMigration, /revoke all on function public\.purge_expired_unleashed_raw_snapshots\(integer\) from anon/);
  assert.match(retentionMigration, /revoke all on function public\.purge_expired_unleashed_raw_snapshots\(integer\) from authenticated/);
  assert.doesNotMatch(retentionMigration, /delete from public\.unleashed_(?:sync_runs|external_identities)/);
});

test('legacy probe retirement is manual, exact, confirmation-gated, and replacement-safe', () => {
  assert.match(retirementWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(retirementWorkflow, /^\s{2}(?:push|pull_request|schedule):/m);
  assert.match(retirementWorkflow, /environment: production/);
  assert.match(retirementWorkflow, /test "\$GITHUB_REF" = 'refs\/heads\/main'/);
  assert.match(retirementWorkflow, /RETIRE INERT UNLEASHED PROBES/);
  assert.match(retirementWorkflow, /unleashed-readonly-probe-001c/);
  assert.match(retirementWorkflow, /unleashed-readonly-probe-001c2/);
  assert.match(retirementWorkflow, /unleashed-readonly-probe-001c3/);
  assert.match(retirementWorkflow, /trigger-unleashed-readonly-sync/);
  assert.match(retirementWorkflow, /supabase functions delete "\$function_name"/);
  assert.match(retirementWorkflow, /supabase functions list/);
  assert.match(retirementWorkflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(retirementWorkflow, /supabase secrets (?:set|unset)/);
  const confirmationStep = retirementWorkflow.indexOf('- name: Require exact destructive confirmation');
  const deletionStep = retirementWorkflow.indexOf('- name: Retire matched legacy probes');
  assert.ok(confirmationStep >= 0 && deletionStep > confirmationStep,
    'destructive confirmation must execute before the retirement step');
  assert.match(
    retirementWorkflow.slice(deletionStep, retirementWorkflow.indexOf('- name: Capture and validate post-retirement state')),
    /if: \$\{\{ inputs\.operation == 'retire_legacy_probes' \}\}/,
  );
});

test('retirement state rejects drift and accepts an idempotent post-retirement list', () => {
  const replacement = {
    slug: 'trigger-unleashed-readonly-sync',
    status: 'ACTIVE',
    version: 7,
    verify_jwt: true,
  };
  const legacy = LEGACY_UNLEASHED_PROBES.map((probe) => ({
    slug: probe.slug,
    status: 'ACTIVE',
    version: probe.version,
    verify_jwt: true,
    ezbr_sha256: probe.sha256,
  }));

  const before = inspectUnleashedFunctionState(JSON.stringify([replacement, ...legacy]), 'before');
  assert.deepEqual(before.targets, LEGACY_UNLEASHED_PROBES.map((probe) => probe.slug));

  const after = inspectUnleashedFunctionState(JSON.stringify({ functions: [replacement] }), 'after');
  assert.deepEqual(after.targets, []);

  const drifted = structuredClone(legacy);
  drifted[0].ezbr_sha256 = 'f'.repeat(64);
  assert.throws(
    () => inspectUnleashedFunctionState(JSON.stringify([replacement, ...drifted]), 'before'),
    /LEGACY_UNLEASHED_PROBE_DRIFT/,
  );
  assert.throws(
    () => inspectUnleashedFunctionState(JSON.stringify([replacement, ...legacy]), 'after'),
    /LEGACY_UNLEASHED_PROBES_STILL_PRESENT/,
  );
});
