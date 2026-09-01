import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  contentAddressedObjectPath,
  extractProductImageUrls,
  normalizeUnleashedImageUrl,
  readImageBytesBounded,
  sha256Hex,
} from '../supabase/functions/trigger-unleashed-master-migration/core.ts';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const workPackage = read('docs/engineering/work-packages/UNLEASHED-MIGRATION-003-canonical-master-data-assets.md');
const migration = read('supabase/migrations/20260831235500_unleashed_master_data_bridge.sql');
const edgeFunction = read('supabase/functions/trigger-unleashed-master-migration/index.ts');
const edgeCore = read('supabase/functions/trigger-unleashed-master-migration/core.ts');
const checkWorkflow = read('.github/workflows/unleashed-master-data-bridge-check.yml');
const deployWorkflow = read('.github/workflows/deploy-supabase-migrations.yml');
const reviewFixesDbContract = read('scripts/unleashed-master-data-bridge-review-fixes-db-contract-test.sql');
const packageJson = JSON.parse(read('package.json'));

test('work package fixes the authority and cost boundaries before implementation', () => {
  for (const required of [
    'No automatic creation of `ecoflow_physical_skus`',
    'No inventory quantities, opening balances',
    'rights evidence is pending',
    'private `unleashed-product-images` bucket',
    'local disposable PostgreSQL',
  ]) assert.match(workPackage, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  for (const scopedPath of [
    'scripts/unleashed-master-data-bridge-review-fixes-db-contract-test.sql',
    'scripts/audit-production-activation-readiness.mjs',
  ]) assert.match(workPackage, new RegExp(scopedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('trusted shadow packaging keeps all #338 SQL in one undeployed migration', () => {
  const bridgePackageMigrations = readdirSync(new URL('../supabase/migrations', import.meta.url))
    .filter((name) => [
      '20260831235500_unleashed_master_data_bridge.sql',
      '20260901153000_unleashed_master_data_bridge_review_fixes.sql',
    ].includes(name));
  assert.deepEqual(bridgePackageMigrations, ['20260831235500_unleashed_master_data_bridge.sql']);
  assert.doesNotMatch(checkWorkflow, /20260901153000_unleashed_master_data_bridge_review_fixes\.sql/);
  assert.doesNotMatch(reviewFixesDbContract, /\\ir .*unleashed_master_data_bridge_review_fixes\.sql/);
  for (const integratedGuard of [
    'ecoflow_guard_unleashed_review_preservation',
    'ecoflow_guard_unleashed_retired_review_match',
    'ecoflow_guard_unleashed_raw_snapshot_delete',
    'ecoflow_guard_unleashed_asset_copied_provenance',
    'ecoflow_external_object_mappings_external_id_nonblank',
  ]) assert.match(migration, new RegExp(integratedGuard));
});

test('migration uses pre-existing Supabase extensions without database CREATE authority', () => {
  assert.match(migration, /to_regnamespace\('extensions'\)/);
  assert.match(migration, /to_regprocedure\('extensions\.gen_random_uuid\(\)'\)/);
  assert.match(migration, /to_regprocedure\('extensions\.digest\(text,text\)'\)/);
  assert.doesNotMatch(migration, /create schema if not exists extensions/i);
  assert.doesNotMatch(migration, /create extension if not exists pgcrypto/i);
});

test('durable actor evidence does not require cross-schema auth DDL privileges', () => {
  assert.doesNotMatch(migration, /references auth\.users/i);
  for (const actorColumn of [
    'reviewed_by uuid',
    'actor_user_id uuid not null',
    'authorized_by uuid',
    'requested_by uuid not null',
  ]) assert.match(migration, new RegExp(actorColumn));
});

test('migration establishes a four-state, provenance-backed master mapping bridge', () => {
  for (const relation of [
    'ecoflow_unleashed_master_mappings',
    'ecoflow_unleashed_master_candidates',
    'ecoflow_unleashed_mapping_commands',
    'ecoflow_unleashed_asset_authorizations',
    'ecoflow_unleashed_product_assets',
    'v_ecoflow_unleashed_master_review_queue',
  ]) assert.match(migration, new RegExp(relation));

  assert.match(migration, /mapping_status in \('MATCHED','AMBIGUOUS','UNMATCHED','RETIRED'\)/);
  assert.match(migration, /source_payload_sha256/);
  assert.match(migration, /source_external_guid/);
  assert.match(migration, /source_external_code/);
  assert.match(migration, /expected_revision/);
  assert.match(migration, /command_id uuid not null unique/);
  assert.match(migration, /COMMAND_REPLAY_PAYLOAD_MISMATCH/);
  assert.match(migration, /MAPPING_REVISION_CONFLICT/);
  assert.match(migration, /MATCHED_REQUIRES_CANONICAL_TARGET/);
  assert.match(migration, /is_current boolean not null default true/);
  assert.match(migration, /candidate_set_sha256 text not null/);
  assert.match(migration, /current_mapping\.candidate_set_sha256=v_candidate_set_sha256/);
  assert.match(migration, /selected_candidate_snapshot jsonb/);
  assert.match(migration, /and c\.is_current/);
  assert.doesNotMatch(migration, /delete from public\.ecoflow_unleashed_master_candidates/);
});

test('deterministic planner fails closed and never creates Physical SKU authority', () => {
  assert.match(migration, /ORDERMENTUM_PRODUCT_CODE_EXACT/);
  assert.match(migration, /ECOFLOW_WAREHOUSE_CODE_EXACT/);
  assert.match(migration, /EXPLICIT_EXTERNAL_OBJECT_MAPPING/);
  assert.match(migration, /case[\s\S]*when v_candidate_count = 1 then 'MATCHED'/);
  assert.match(migration, /when v_candidate_count > 1 then 'AMBIGUOUS'/);
  assert.match(migration, /else 'UNMATCHED'/s);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.ecoflow_physical_skus/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.inventory_/i);
  assert.doesNotMatch(migration, /update\s+public\.inventory_/i);
});

test('browser access is read-only and review is a server-authoritative command', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.ecoflow_unleashed_master_mappings from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.v_ecoflow_unleashed_master_review_queue to authenticated/);
  assert.match(migration, /ecoflow_review_unleashed_master_mapping/);
  assert.match(migration, /v_role not in \('OWNER','ADMIN'\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test('product image storage is private, bounded and service-written', () => {
  assert.doesNotMatch(migration, /storage\.(?:buckets|objects)/);
  assert.match(edgeFunction, /storage\.createBucket\(ASSET_BUCKET/);
  assert.match(edgeFunction, /storage\.updateBucket\(ASSET_BUCKET/);
  assert.match(edgeFunction, /public: false/);
  assert.match(edgeFunction, /allowedMimeTypes: \['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(edgeFunction, /fileSizeLimit: 10 \* 1024 \* 1024/);
  assert.match(edgeFunction, /body\.mode === 'GET_ASSET_URL'/);
  assert.match(edgeFunction, /createSignedUrl\(asset\.object_path, ASSET_SIGNED_URL_TTL_SECONDS\)/);
  assert.match(migration, /grant select, insert, update, delete on table public\.ecoflow_unleashed_product_assets to service_role/);
});

test('Edge Function rejects unsafe assets before any Storage mutation', () => {
  assert.match(edgeCore, /unlappcdn\.unleashedsoftware\.com/);
  assert.match(edgeCore, /UNLEASHED_IMAGE_HTTPS_REQUIRED/);
  assert.match(edgeCore, /UNLEASHED_IMAGE_HOST_NOT_ALLOWED/);
  assert.match(edgeCore, /UNLEASHED_IMAGE_REDIRECT_REJECTED/);
  assert.match(edgeCore, /UNLEASHED_IMAGE_MIME_NOT_ALLOWED/);
  assert.match(edgeCore, /UNLEASHED_IMAGE_OBJECT_TOO_LARGE/);
  assert.match(edgeCore, /UNLEASHED_IMAGE_BUDGET_EXCEEDED/);
  assert.match(edgeCore, /content-addressed/);
  assert.match(edgeFunction, /redirect: 'manual'/);
  assert.match(edgeFunction, /mode === 'COPY_IMAGES'/);
  assert.match(edgeFunction, /ASSET_RIGHTS_NOT_APPROVED/);
  assert.match(edgeFunction, /SOURCE_SNAPSHOT_CHANGED/);
  assert.match(edgeFunction, /from\(ASSET_BUCKET\)\.upload/);
  assert.match(edgeFunction, /COPY_RUN_ALREADY_RUNNING/);
  assert.match(edgeFunction, /COPY_RUN_LEASE_EXPIRED/);
  assert.match(edgeFunction, /positiveSafeInteger\(body\.limit \?\? 10, 'INVALID_COPY_LIMIT', 10\)/);
  assert.match(migration, /requested_limit between 1 and 10/);
  assert.match(edgeFunction, /claimed_in_run_id/);
  assert.match(edgeFunction, /AbortSignal\.timeout/);
  assert.match(edgeFunction, /actorUserId: userData\.user\.id/);
  assert.match(edgeFunction, /duplicate[\s\S]{0,500}copiedBytes \+= image\.contentLength/);
  assert.match(edgeFunction, /update\(refresh\)[\s\S]{0,180}\.is\('claimed_in_run_id', null\)/);
  assert.match(edgeFunction, /\.eq\('source_payload_sha256', asset\.source_payload_sha256\)/);
  assert.match(edgeFunction, /if \(existingAsset\.asset_status === 'COPIED'\) continue/);
  assert.match(edgeFunction, /refresh\.asset_status = asset\.asset_status/);
  assert.match(edgeFunction, /UNLEASHED_IMAGE_SOURCE_SUPERSEDED/);
  assert.match(edgeFunction, /asset_status: 'RETIRED'/);
  assert.match(edgeFunction, /UNLEASHED_IMAGE_NOT_PRESENT/);
  assert.match(edgeFunction, /blocked:\/\/redacted/);
  assert.match(migration, /where status='RUNNING'/);
});

test('migration trigger remains JWT protected and Unleashed read-only', () => {
  assert.match(checkWorkflow, /unleashed-master-data-bridge-contract\.test\.mjs/);
  assert.match(checkWorkflow, /unleashed-master-data-bridge-db-contract-test\.sql/);
  assert.match(deployWorkflow, /supabase functions deploy trigger-unleashed-master-migration/);
  assert.doesNotMatch(deployWorkflow, /functions deploy trigger-unleashed-master-migration[^\n]*--no-verify-jwt/);
  assert.doesNotMatch(edgeFunction, /api-auth-id/);
  assert.doesNotMatch(edgeFunction, /api-auth-signature/);
  assert.doesNotMatch(edgeFunction, /api\.unleashedsoftware\.com/);
  assert.doesNotMatch(edgeFunction, /UNLEASHED_API_(?:ID|KEY).*JSON\.stringify/);
});

test('repository exposes a reproducible #338 audit command', () => {
  assert.equal(
    packageJson.scripts['audit:unleashed-master-data'],
    'node --experimental-strip-types --test scripts/unleashed-master-data-bridge-contract.test.mjs && node scripts/audit-unleashed-master-data-bridge.mjs',
  );
});

test('image helpers accept the allowlisted CDN, verify bytes and deduplicate product images', async () => {
  const urls = extractProductImageUrls({
    ImageUrl: 'https://unlappcdn.unleashedsoftware.com/a.jpg',
    Images: [
      { ImageUrl: 'https://unlappcdn.unleashedsoftware.com/a.jpg' },
      { Url: 'https://unlappcdn.unleashedsoftware.com/b.webp' },
    ],
  });
  assert.deepEqual(urls, [
    'https://unlappcdn.unleashedsoftware.com/a.jpg',
    'https://unlappcdn.unleashedsoftware.com/b.webp',
  ]);
  assert.equal(normalizeUnleashedImageUrl(urls[0]).hostname, 'unlappcdn.unleashedsoftware.com');
  assert.throws(() => normalizeUnleashedImageUrl('http://unlappcdn.unleashedsoftware.com/a.jpg'), /HTTPS_REQUIRED/);
  assert.throws(() => normalizeUnleashedImageUrl('https://example.com/a.jpg'), /HOST_NOT_ALLOWED/);

  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const result = await readImageBytesBounded(new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/png', 'content-length': String(bytes.byteLength) },
  }), { maxObjectBytes: 20, storageBudgetBytes: 30, copiedBytes: 5 });
  assert.equal(result.contentLength, 12);
  const hash = await sha256Hex(bytes);
  assert.equal(contentAddressedObjectPath('10000000-0000-4000-8000-000000000001', hash, 'image/png'),
    `products/10000000-0000-4000-8000-000000000001/${hash}.png`);
});

test('image helpers reject redirects, MIME drift, object overflow and budget overflow', async () => {
  await assert.rejects(
    readImageBytesBounded(new Response(null, { status: 302, headers: { location: 'https://example.com' } }),
      { maxObjectBytes: 10, storageBudgetBytes: 20, copiedBytes: 0 }),
    /REDIRECT_REJECTED/,
  );
  await assert.rejects(
    readImageBytesBounded(new Response(new Uint8Array([1]), { headers: { 'content-type': 'text/html' } }),
      { maxObjectBytes: 10, storageBudgetBytes: 20, copiedBytes: 0 }),
    /MIME_NOT_ALLOWED/,
  );
  await assert.rejects(
    readImageBytesBounded(new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { 'content-type': 'image/png' },
    }), { maxObjectBytes: 10, storageBudgetBytes: 20, copiedBytes: 0 }),
    /MIME_CONTENT_MISMATCH/,
  );
  await assert.rejects(
    readImageBytesBounded(new Response(new Uint8Array(11), { headers: { 'content-type': 'image/jpeg' } }),
      { maxObjectBytes: 10, storageBudgetBytes: 20, copiedBytes: 0 }),
    /OBJECT_TOO_LARGE/,
  );
  await assert.rejects(
    readImageBytesBounded(new Response(new Uint8Array(6), { headers: { 'content-type': 'image/webp' } }),
      { maxObjectBytes: 10, storageBudgetBytes: 10, copiedBytes: 5 }),
    /BUDGET_EXCEEDED/,
  );
});
