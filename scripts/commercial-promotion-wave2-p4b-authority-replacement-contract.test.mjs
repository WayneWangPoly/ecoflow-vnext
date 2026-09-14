import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260914001500_commercial_wave2_p4b_authority_replacement.sql';
const migration = fs.readFileSync(migrationPath, 'utf8');
const docs = fs.readFileSync('docs/engineering/work-packages/338-COMMERCIAL-WAVE2-P4B-AUTHORITY-REPLACEMENT.md', 'utf8');

const v2Body = migration.match(/create or replace function public\.ecoflow_unlock_commercial_wave2_expansion_v2\([\s\S]*?\$function\$;\n/iu)?.[0] ?? '';

test('P4B revokes the stale service-role expansion authority', () => {
  assert.match(migration, /revoke all on function public\.ecoflow_unlock_commercial_wave2_expansion\(uuid,uuid,text,bigint,text,text\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.match(migration, /REVOKED legacy Wave-2 EXPANSION unlock/);
  assert.match(docs, /legacy service-role authority/i);
});

test('P4B replacement is caller-authenticated and cannot spoof requestedBy', () => {
  assert.match(v2Body, /v_actor uuid := auth\.uid\(\)/);
  assert.match(v2Body, /not in \('OWNER', 'ADMIN'\)/);
  assert.match(v2Body, /public\.ecoflow_active_app_role\(\)/);
  assert.doesNotMatch(v2Body, /p_requested_by/);
  assert.match(v2Body, /P4B_CALLER_AUTH_V2/);
  assert.match(v2Body, /COMMAND_REPLAY_PAYLOAD_MISMATCH/);
  assert.match(v2Body, /jsonb_set\(v_existing\.result, '\{replayed\}', 'true'::jsonb/);
});

test('P4B replacement reuses P4A and revalidates the exact 163-row cohort under locks', () => {
  assert.match(v2Body, /public\.ecoflow_read_commercial_wave2_p4_readiness\(\)/);
  assert.match(v2Body, /READY_FOR_P4B_ENGINEERING/);
  assert.match(v2Body, /eligibleExpansionCount/);
  assert.match(v2Body, /v_eligible <> 163/);
  assert.match(v2Body, /promotion_phase = 'EXPANSION'[\s\S]*for update/);
  assert.match(v2Body, /for update of m/);
  assert.match(v2Body, /mapping_status = 'UNMATCHED'/);
  assert.match(v2Body, /source_duplicate_count = 1/);
  assert.match(v2Body, /is_visible_on_ordermentum/);
  assert.match(v2Body, /not exists \([\s\S]*external_product_mappings/);
  assert.match(v2Body, /not exists \([\s\S]*from public\.skus/);
  assert.match(v2Body, /update public\.ecoflow_commercial_wave2_candidates[\s\S]*set enabled = true/);
  assert.match(v2Body, /v_updated <> 163/);
});

test('P4B freezes the real P2B/P3 CANARY state rather than the stale MATCHED assumption', () => {
  for (const token of [
    '140010',
    '3001d0f1-6c1b-4b15-98a0-91443ca6b525',
    '016caa5717762af1c76f1216ddb34d4a50be6079371e868c11c123634ebcedf8',
    '4710bb98-2706-42e5-866b-8788e36e1acc',
    '1995b15c-7ee7-466b-ba3e-daba596d71a3',
    '79d719a1fcc422afefdabacac4f5b6d7d52ae0b4cc3e8939120edb229160803a',
  ]) assert.match(migration, new RegExp(token));
  assert.match(v2Body, /v_source\.mapping_status <> 'UNMATCHED'/);
  assert.doesNotMatch(v2Body, /ORDERMENTUM_PRODUCT_CODE_EXACT/);
  assert.doesNotMatch(v2Body, /canonical_object_type/);
});

test('P4B engineering leaves the replacement dormant and exposes no activation grant', () => {
  assert.match(migration, /revoke all on function public\.ecoflow_unlock_commercial_wave2_expansion_v2\(uuid,text,text\)[\s\S]*from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.ecoflow_unlock_commercial_wave2_expansion_v2/i);
  assert.match(migration, /P4C activation required/i);
  assert.match(docs, /production expansion remains NOT AUTHORIZED/i);
});

test('P4B unlock mutation is bounded to eligibility enablement and its ledgers', () => {
  assert.match(v2Body, /insert into public\.ecoflow_commercial_wave2_phase_unlocks/);
  assert.match(v2Body, /insert into public\.ecoflow_commercial_wave2_unlock_commands/);
  assert.match(v2Body, /COMMERCIAL_WAVE2_EXPANSION_UNLOCKED_V2/);
  assert.doesNotMatch(v2Body, /insert into public\.ecoflow_commercial_wave2_promotions/i);
  assert.doesNotMatch(v2Body, /insert into public\.skus/i);
  assert.doesNotMatch(v2Body, /insert into public\.external_product_mappings/i);
  assert.doesNotMatch(v2Body, /\b(insert|update|delete)\b[\s\S]{0,80}\b(ordermentum_raw_api_events|ordermentum_api_jobs|inventory_movements|warehouse_movements|stock_movements|location_quantity|ecoflow_image_assets|ecoflow_image_copy_runs)\b/i);
  assert.match(v2Body, /'providerActionIncluded', false/);
  assert.match(v2Body, /'promotionIncluded', false/);
  assert.match(v2Body, /'physicalAuthorityCreated', false/);
  assert.match(v2Body, /'inventoryAuthorityCreated', false/);
});
