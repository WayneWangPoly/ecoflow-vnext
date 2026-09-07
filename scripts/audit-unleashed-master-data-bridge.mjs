import { readdirSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260831235500_unleashed_master_data_bridge.sql');
const manualCandidateMigration = read('supabase/migrations/20260908093000_identity_unlock_batch1_manual_warehouse_candidate.sql');
const edge = read('supabase/functions/trigger-unleashed-master-migration/index.ts');
const core = read('supabase/functions/trigger-unleashed-master-migration/core.ts');
const deploy = read('.github/workflows/deploy-supabase-migrations.yml');
const workPackage = read('docs/engineering/work-packages/UNLEASHED-MIGRATION-003-canonical-master-data-assets.md');
const bridgePackageMigrations = readdirSync(new URL('../supabase/migrations', import.meta.url))
  .filter((name) => [
    '20260831235500_unleashed_master_data_bridge.sql',
    '20260901153000_unleashed_master_data_bridge_review_fixes.sql',
  ].includes(name));
const identityAuthoritySql = migration + manualCandidateMigration + edge;

const checks = [];
const check = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence });

check(
  'single trusted-shadow migration package',
  bridgePackageMigrations.length === 1
    && bridgePackageMigrations[0] === '20260831235500_unleashed_master_data_bridge.sql'
    && /ecoflow_guard_unleashed_review_preservation/.test(migration)
    && /ecoflow_guard_unleashed_retired_review_match/.test(migration)
    && /ecoflow_guard_unleashed_raw_snapshot_delete/.test(migration)
    && /ecoflow_guard_unleashed_asset_copied_provenance/.test(migration),
  'all undeployed #338 review guards are integrated in the one migration accepted by the trusted shadow gate',
);

check(
  'trusted migrator needs no database CREATE authority',
  /to_regnamespace\('extensions'\)/.test(migration)
    && /to_regprocedure\('extensions\.gen_random_uuid\(\)'\)/.test(migration)
    && /to_regprocedure\('extensions\.digest\(text,text\)'\)/.test(migration)
    && !/create schema if not exists extensions/i.test(migration)
    && !/create extension if not exists pgcrypto/i.test(migration),
  'the migration validates existing Supabase pgcrypto dependencies instead of creating a schema/extension',
);

check(
  'actor provenance avoids cross-schema auth DDL authority',
  !/references auth\.users/i.test(migration)
    && /reviewed_by uuid/.test(migration)
    && /actor_user_id uuid not null/.test(migration)
    && /authorized_by uuid/.test(migration)
    && /requested_by uuid not null/.test(migration),
  'server-validated actor UUIDs remain durable evidence without requiring REFERENCES on auth.users',
);

check(
  'four governed mapping states',
  /mapping_status in \('MATCHED','AMBIGUOUS','UNMATCHED','RETIRED'\)/.test(migration),
  'MATCHED / AMBIGUOUS / UNMATCHED / RETIRED constraint',
);
check(
  'commercial and physical SKU separation',
  !/insert\s+into\s+public\.ecoflow_physical_skus/i.test(identityAuthoritySql)
    && !/update\s+public\.ecoflow_physical_skus/i.test(identityAuthoritySql),
  'no Physical SKU mutation path in base bridge or Identity Unlock Batch 1A',
);
check(
  'inventory authority excluded',
  !/(insert\s+into|update|delete\s+from)\s+public\.(?:inventory_|ecoflow_inventory)/i.test(identityAuthoritySql),
  'no inventory table mutation in base bridge or Identity Unlock Batch 1A',
);
check(
  'manual warehouse candidate is literally bounded',
  /source_external_code\)\)='ADL1'/.test(manualCandidateMigration)
    && /canonical_code\)\)='MAIN'/.test(manualCandidateMigration)
    && /p_source_external_code[\s\S]*<> 'ADL1'/.test(manualCandidateMigration)
    && /p_target_warehouse_code[\s\S]*<> 'MAIN'/.test(manualCandidateMigration)
    && /mapping_status <> 'UNMATCHED'/.test(manualCandidateMigration)
    && /source_duplicate_count <> 1/.test(manualCandidateMigration),
  'only the frozen ADL1 -> MAIN, single-source, currently UNMATCHED warehouse mapping can receive a candidate',
);
check(
  'manual warehouse candidate is candidate-only',
  /OWNER_ADMIN_MANUAL_WAREHOUSE/.test(manualCandidateMigration)
    && /canonical_object_type[\s\S]*'WAREHOUSE'/.test(manualCandidateMigration)
    && !/set[\s\S]{0,200}mapping_status\s*=\s*'MATCHED'/i.test(manualCandidateMigration)
    && !/insert\s+into\s+public\.external_product_mappings/i.test(manualCandidateMigration),
  'Batch 1A materialises review evidence without promoting the master mapping or Commercial SKU mappings',
);
check(
  'manual candidate source drift fails closed',
  /m\.source_payload_sha256=a\.source_payload_sha256/.test(manualCandidateMigration)
    && /SOURCE_SNAPSHOT_CHANGED/.test(manualCandidateMigration),
  'candidate only re-materialises while the authorised source payload hash remains current',
);
check(
  'manual candidate command is owner-admin and server-side only',
  /v_role not in \('OWNER','ADMIN'\)/.test(manualCandidateMigration)
    && /revoke all on function public\.ecoflow_add_unleashed_manual_warehouse_candidate/.test(manualCandidateMigration)
    && /grant execute on function public\.ecoflow_add_unleashed_manual_warehouse_candidate[\s\S]*to service_role/.test(manualCandidateMigration)
    && /enable row level security/.test(manualCandidateMigration)
    && /revoke all on table public\.ecoflow_unleashed_manual_mapping_candidates[\s\S]*service_role/.test(manualCandidateMigration),
  'direct table/browser mutation is blocked and the command re-validates an active Owner/Admin actor',
);
check(
  'PLAN cannot bypass manual candidate refresh',
  /rename to ecoflow_plan_unleashed_master_mappings_core/.test(manualCandidateMigration)
    && /ecoflow_refresh_unleashed_manual_mapping_candidates/.test(manualCandidateMigration)
    && /revoke all on function public\.ecoflow_plan_unleashed_master_mappings_core[\s\S]*service_role/.test(manualCandidateMigration),
  'service callers only receive the wrapper that re-materialises still-valid manual candidates after deterministic PLAN',
);
check(
  'Unleashed API not called',
  !/api\.unleashedsoftware\.com|api-auth-id|api-auth-signature/.test(edge),
  '#338 consumes #337 snapshots only',
);
check(
  'image host allowlisted',
  /unlappcdn\.unleashedsoftware\.com/.test(core)
    && /UNLEASHED_IMAGE_HOST_NOT_ALLOWED/.test(core),
  'exact CDN host and fail-closed error',
);
check(
  'redirects rejected',
  /redirect: 'manual'/.test(edge) && /UNLEASHED_IMAGE_REDIRECT_REJECTED/.test(core),
  'manual redirect handling',
);
check(
  'rights and budget gated',
  /ASSET_RIGHTS_NOT_APPROVED/.test(edge)
    && /UNLEASHED_IMAGE_BUDGET_EXCEEDED/.test(core)
    && /storage_budget_bytes/.test(migration),
  'approval and byte budget required before upload',
);
check(
  'private service-written image bucket',
  !/storage\.(?:buckets|objects)/.test(migration)
    && /storage\.createBucket\(ASSET_BUCKET/.test(edge)
    && /storage\.updateBucket\(ASSET_BUCKET/.test(edge)
    && /public: false/.test(edge)
    && /allowedMimeTypes: \['image\/jpeg', 'image\/png', 'image\/webp'\]/.test(edge)
    && /createSignedUrl\(asset\.object_path, ASSET_SIGNED_URL_TTL_SECONDS\)/.test(edge),
  'service-role API provisions a private bounded bucket and active users receive only short-lived signed reads',
);
check(
  'browser mapping mutation blocked',
  /revoke all on table public\.ecoflow_unleashed_master_mappings from public, anon, authenticated/.test(migration)
    && /ecoflow_review_unleashed_master_mapping/.test(migration),
  'direct grants revoked; server command provided',
);
check(
  'idempotent command evidence',
  (migration.match(/COMMAND_REPLAY_PAYLOAD_MISMATCH/g) ?? []).length >= 2
    && /command_payload_sha256/.test(migration)
    && /COMMAND_REPLAY_PAYLOAD_MISMATCH/.test(manualCandidateMigration)
    && /command_payload_sha256/.test(manualCandidateMigration),
  'mapping, authorization, copy and manual-candidate commands are payload-bound',
);
check(
  'commands are actor-bound',
  /'actorUserId',v_actor/.test(migration)
    && /'requestedBy',p_requested_by/.test(migration)
    && /actorUserId: userData\.user\.id/.test(edge)
    && /'requestedBy',p_requested_by/.test(manualCandidateMigration),
  'a different Owner/Admin cannot replay another actor command',
);
check(
  'review evidence survives replanning',
  /candidate_set_sha256/.test(migration)
    && /selected_candidate_snapshot/.test(migration)
    && /and c\.is_current/.test(migration)
    && !/delete from public\.ecoflow_unleashed_master_candidates/.test(migration),
  'source/canonical drift invalidates authority without deleting accepted evidence',
);
check(
  'image bytes match declared MIME',
  /detectImageContentType/.test(core)
    && /UNLEASHED_IMAGE_MIME_CONTENT_MISMATCH/.test(core),
  'JPEG/PNG/WebP signatures are checked after the bounded read',
);
check(
  'asset exceptions are explicit and redacted',
  /UNLEASHED_IMAGE_NOT_PRESENT/.test(edge)
    && /blocked:\/\/redacted/.test(edge)
    && /UNLEASHED_IMAGE_SOURCE_SUPERSEDED/.test(edge),
  'missing or unsafe current locators are BLOCKED and superseded exceptions retire without persisting unsafe URLs',
);
check(
  'copy budget has a recoverable singleton lease',
  /where status='RUNNING'/.test(migration)
    && /claimed_in_run_id/.test(migration + edge)
    && /COPY_RUN_LEASE_EXPIRED/.test(migration)
    && /COPY_RUN_ALREADY_RUNNING/.test(edge)
    && /ecoflow_claim_unleashed_product_asset/.test(migration + edge)
    && /ecoflow_expire_unleashed_asset_copy_run/.test(migration + edge)
    && /ecoflow_complete_unleashed_asset_copy_run/.test(migration + edge)
    && /interval '15 minutes'/.test(migration)
    && /for update/.test(migration),
  'only one run can spend the aggregate budget; database-owned lease transitions serialize claims and stale expiry',
);
check(
  'copy crash reconciliation preserves budget',
  /duplicate[\s\S]{0,500}copiedBytes \+= image\.contentLength/.test(edge)
    && /\.eq\('source_payload_sha256', asset\.source_payload_sha256\)/.test(edge)
    && /if \(existingAsset\.asset_status === 'COPIED'\) continue/.test(edge),
  'orphaned duplicate objects and concurrent PLAN drift remain budget/source bound without rewriting copied provenance',
);
check(
  'security definers use an empty search path',
  (migration.match(/security definer\nset search_path = ''/g) ?? []).length >= 3
    && (manualCandidateMigration.match(/security definer\nset search_path = ''/g) ?? []).length >= 3,
  'privileged functions schema-qualify objects and do not trust public search_path',
);
check(
  'content-addressed assets',
  /contentAddressedObjectPath/.test(edge + core)
    && /content_sha256/.test(migration),
  'immutable object path and provenance hash',
);
check(
  'JWT-protected deployment',
  /supabase functions deploy trigger-unleashed-master-migration/.test(deploy)
    && !/functions deploy trigger-unleashed-master-migration[^\n]*--no-verify-jwt/.test(deploy),
  'central deployment uses CLI default JWT verification',
);
check(
  'bounded implementation scope recorded',
  /UNLEASHED-MIGRATION-003/.test(workPackage)
    && /No inventory quantities, opening balances/.test(workPackage),
  'approved work-package boundary present',
);

for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}: ${item.evidence}`);
}
const failed = checks.filter((item) => !item.pass);
console.log(`UNLEASHED_MASTER_DATA_BRIDGE_AUDIT ${failed.length ? 'FAIL' : 'PASS'} (${checks.length - failed.length}/${checks.length})`);
if (failed.length) process.exitCode = 1;
