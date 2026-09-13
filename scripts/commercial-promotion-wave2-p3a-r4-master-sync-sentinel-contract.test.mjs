import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260913225500_commercial_wave2_p3a_r4_master_sync_sentinel.sql', 'utf8');
const repository = fs.readFileSync('src/data/repositories/commercialWave2CanaryVerification.ts', 'utf8');

test('R4 uses a new caller-authenticated verification RPC and preserves R3 as its evidence source', () => {
  assert.match(migration, /ecoflow_read_commercial_wave2_p3_verification_v3\(\)/);
  assert.match(migration, /v_report := public\.ecoflow_read_commercial_wave2_p3_verification_v2\(\)/);
  assert.match(migration, /stable\s+security definer\s+set search_path = ''/i);
  assert.match(migration, /v_actor uuid := auth\.uid\(\)/);
  assert.match(migration, /not in \('OWNER', 'ADMIN'\)/);
  assert.match(migration, /revoke all on function public\.ecoflow_read_commercial_wave2_p3_verification_v3\(\)\s+from public, anon, service_role/i);
  assert.match(migration, /grant execute on function public\.ecoflow_read_commercial_wave2_p3_verification_v3\(\)\s+to authenticated/i);
  assert.match(repository, /ecoflow_read_commercial_wave2_p3_verification_v3/);
  assert.doesNotMatch(repository, /service[_-]?role|SUPABASE_SERVICE_ROLE_KEY|access[_-]?token|jwt/i);
});

test('healthy incumbent master sync is a bounded class, not a frozen run id', () => {
  assert.match(migration, /from public\.ordermentum_master_sync_runs r/);
  assert.match(migration, /r\.run_type = 'MASTER_DATA_SYNC'/);
  assert.match(migration, /r\.status = 'SUCCEEDED'/);
  assert.match(migration, /r\.auth_mode = 'legacy-bearer'/);
  assert.match(migration, /coalesce\(r\.dry_run, false\) = false/);
  assert.match(migration, /array_length\(r\.resources_failed, 1\)/);
  assert.match(migration, /coalesce\(r\.detail_failed, 0\) = 0/);
  assert.match(migration, /coalesce\(r\.detail_succeeded, 0\) = coalesce\(r\.detail_attempted, 0\)/);
  assert.match(migration, /r\.last_error is null/);
  assert.match(migration, /r\.finished_at is not null/);
  assert.match(migration, /SUCCEEDED_MASTER_DATA_SYNC_LEGACY_BEARER/);
  assert.doesNotMatch(migration, /3b0f31ba-23c8-45a4-8d9c-9f934ede8962|58c8a729-f680-4413-b51e-1e2fbe6cf016/);
});

test('R4 removes only the two false-positive failures after master attribution succeeds', () => {
  assert.match(migration, /provider\.unattributedActivity/);
  assert.match(migration, /sentinels\.sinceP2B\.ordermentumMasterSyncRuns/);
  assert.match(migration, /v_base_provider_clean/);
  assert.match(migration, /unattributedSyncRuns/);
  assert.match(migration, /unattributedRawApiEvents/);
  assert.match(migration, /unattributedSyncStateRows/);
  assert.match(migration, /unattributedMasterSyncRuns/);
  assert.match(migration, /legacyRetired/);
  assert.match(migration, /currentApiShadowExecuted/);
});

test('actual master-run count remains visible while legacy generic bucket is normalized only when attributable', () => {
  assert.match(migration, /'masterSyncRuns', v_master_runs/);
  assert.match(migration, /'unattributedMasterSyncRuns', v_invalid_master_runs/);
  assert.match(migration, /\{sentinels,sinceP2B,ordermentumMasterSyncRuns\}/);
  assert.match(migration, /if v_base_provider_clean then/);
  assert.match(migration, /jsonb_array_length\(v_failures\) = 0 and v_p4_locked/);
});
