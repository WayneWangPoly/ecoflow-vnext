import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260913222500_commercial_wave2_p3a_r3_provider_sentinel.sql', 'utf8');
const repository = fs.readFileSync('src/data/repositories/commercialWave2CanaryVerification.ts', 'utf8');
const contract = fs.readFileSync('src/features/productIdentity/commercialWave2CanaryVerificationContract.ts', 'utf8');

const dynamicIdsThatMustNotBeAuthority = [
  '0bc9be6e-bc67-4e20-8e5c-c843451eb326',
  '34767646363',
  'fdf21ca3-e77a-49f7-b01b-442911f8c908',
  '87365ce3-d92a-4455-aa91-f2611311687c',
  '34778148992',
];

test('R3 exposes a caller-authenticated read-only RPC and keeps the R2 reader intact', () => {
  assert.match(migration, /ecoflow_read_commercial_wave2_p3_verification_v2\(\)/);
  assert.match(migration, /v_report := public\.ecoflow_read_commercial_wave2_p3_verification\(\)/);
  assert.match(migration, /stable\s+security definer\s+set search_path = ''/i);
  assert.match(migration, /v_actor uuid := auth\.uid\(\)/);
  assert.match(migration, /not in \('OWNER', 'ADMIN'\)/);
  assert.match(migration, /grant execute on function public\.ecoflow_read_commercial_wave2_p3_verification_v2\(\)\s+to authenticated/i);
  assert.match(migration, /revoke all on function public\.ecoflow_read_commercial_wave2_p3_verification_v2\(\)\s+from public, anon, service_role/i);
  // A later bounded repair may advance the active reader version while preserving
  // the reviewed R3 v2 function and caller-authenticated/no-service-role boundary.
  assert.match(repository, /ecoflow_read_commercial_wave2_p3_verification_v(?:2|3)/);
  assert.doesNotMatch(repository, /service[_-]?role|SUPABASE_SERVICE_ROLE_KEY|access[_-]?token|jwt/i);
});

test('provider attribution is class-based rather than frozen to one operational UUID', () => {
  for (const token of dynamicIdsThatMustNotBeAuthority) {
    assert.doesNotMatch(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(contract, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(migration, /P3A_R3_INCUMBENT_LEGACY_CLASS/);
  assert.match(migration, /SUCCEEDED_BACKFILL_LEGACY_BEARER/);
  assert.match(migration, /r\.run_type = 'BACKFILL'/);
  assert.match(migration, /r\.status = 'SUCCEEDED'/);
  assert.match(migration, /r\.auth_mode = 'legacy-bearer'/);
  assert.match(migration, /r\.api_base_url = 'https:\/\/app\.ordermentum\.com'/);
  assert.match(migration, /coalesce\(r\.rate_limited, 0\) = 0/);
  assert.match(migration, /coalesce\(r\.error_count, 0\) = 0/);
  assert.match(migration, /coalesce\(r\.detail_fetch_failed, 0\) = 0/);
  assert.match(migration, /r\.finished_at is not null/);
});

test('raw events and sync state must be attributable to the healthy incumbent legacy class', () => {
  assert.match(migration, /not exists \([\s\S]*from public\.ordermentum_sync_runs_v2 r[\s\S]*where r\.id = e\.run_id/);
  assert.match(migration, /s\.id = 'ORDERMENTUM'/);
  assert.match(migration, /s\.enabled/);
  assert.match(migration, /s\.sync_mode = 'LEGACY_INCREMENTAL'/);
  assert.match(migration, /coalesce\(s\.consecutive_failures, 0\) = 0/);
  assert.match(migration, /s\.last_error is null/);
  assert.match(migration, /unattributedSyncStateRows/);
});

test('current API, shadow, retirement and other non-provider failures stay fail-closed', () => {
  assert.match(migration, /r\.auth_mode is distinct from 'legacy-bearer'/);
  assert.match(migration, /r\.api_base_url is distinct from 'https:\/\/app\.ordermentum\.com'/);
  assert.match(migration, /ordermentumMasterSyncRuns/);
  assert.match(migration, /currentApiShadowExecuted/);
  assert.match(migration, /legacyRetired/);
  assert.match(migration, /UNATTRIBUTED_PROVIDER_ACTIVITY/);
  assert.match(migration, /provider\.unattributedActivity/);
  assert.match(migration, /where e\.value <> pg_catalog\.to_jsonb\('provider\.unattributedActivity'::text\)/);
  assert.match(migration, /jsonb_array_length\(v_failures\) = 0 and v_p4_locked/);
});

test('client contract requires the repaired class evidence and preserves P4 lock', () => {
  assert.match(contract, /ATTRIBUTED_INCUMBENT_LEGACY_ACTIVITY/);
  assert.match(contract, /providerContractVersion: 'P3A_R3_INCUMBENT_LEGACY_CLASS'/);
  assert.match(contract, /allowedProviderClass: 'SUCCEEDED_BACKFILL_LEGACY_BEARER'/);
  assert.match(contract, /legacyProviderOrigin: 'https:\/\/app\.ordermentum\.com'/);
  assert.match(contract, /unattributedSyncStateRows/);
  assert.match(contract, /currentApiShadowExecuted, false/);
  assert.match(contract, /legacyRetired, false/);
  assert.match(contract, /value\.p4Locked, true/);
  assert.match(contract, /value\.failedChecks\.length, 0/);
});
