import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const edgeFunction = await readFile('supabase/functions/trigger-unleashed-readonly-sync/index.ts', 'utf8');
const retentionMigration = await readFile('supabase/migrations/20260831160000_unleashed_raw_snapshot_retention.sql', 'utf8');

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
