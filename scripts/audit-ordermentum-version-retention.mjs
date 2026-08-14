#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('scripts/ordermentum-master-data-sync.mjs', 'utf8');
const common = await readFile('scripts/ordermentum-master-data-common.mjs', 'utf8');
const policy = await readFile('scripts/ordermentum-master-version-policy.mjs', 'utf8');
const mirror = await readFile('scripts/ordermentum-complete-mirror.mjs', 'utf8');
const baseline = await readFile('supabase/migrations/20260812130000_ordermentum_master_version_retention.sql', 'utf8');
const tightening = await readFile('supabase/migrations/20260814100000_ordermentum_master_version_retention_v2.sql', 'utf8');

function requireText(text, expected, label) {
  assert.ok(text.includes(expected), `${label} is missing required contract: ${expected}`);
}

requireText(source, "shouldArchivePreviousVersion(existing.data, payloadHash)", 'master sync change policy');
requireText(source, "select('resource_type,external_id,supplier_id,source_endpoint,payload_hash,sync_run_id')", 'hash-only unchanged-state read');
requireText(source, "select('resource_type,external_id,supplier_id,source_endpoint,payload,payload_hash,sync_run_id')", 'changed-state payload read');
requireText(source, 'if (!changed)', 'unchanged resource branch');
requireText(source, 'if (touchUnchanged) await touchExisting', 'full-history lightweight touch');

const hashReadIndex = source.indexOf("select('resource_type,external_id,supplier_id,source_endpoint,payload_hash,sync_run_id')");
const unchangedIndex = source.indexOf('if (!changed)');
const payloadLoadCallIndex = source.indexOf('const previous = await loadExistingPayload(resourceType, externalId)');
const archiveIndex = source.indexOf('await archivePreviousVersion(previous, resourceType, externalId, sourceEndpoint)');
const currentUpsertIndex = source.indexOf("const saved = await supabase.from('ordermentum_raw_master_resources').upsert");
assert.ok(hashReadIndex >= 0 && unchangedIndex >= 0 && hashReadIndex < unchangedIndex,
  'hash-only read must precede the unchanged decision');
assert.ok(unchangedIndex >= 0 && payloadLoadCallIndex >= 0 && unchangedIndex < payloadLoadCallIndex,
  'unchanged resources must exit before loading full payload');
assert.ok(payloadLoadCallIndex >= 0 && archiveIndex >= 0 && payloadLoadCallIndex < archiveIndex,
  'changed resources must load prior payload before archive');
assert.ok(archiveIndex >= 0 && currentUpsertIndex >= 0 && archiveIndex < currentUpsertIndex,
  'prior state must be archived before current-state upsert');

requireText(policy, 'maxVersionsPerResource: 1', 'version count policy');
requireText(policy, 'maxAgeDays: 7', 'version age policy');
requireText(policy, 'maxPayloadBytes: 2 * 1024 * 1024', 'global version payload policy');
requireText(policy, '475 * 1024 * 1024', 'pre-quota database guard');

requireText(baseline, 'after insert on public.ordermentum_raw_master_resource_versions', 'persistent retention trigger');
requireText(baseline, 'grant execute on function public.ecoflow_ordermentum_storage_health() to service_role', 'storage health service boundary');
requireText(tightening, 'resource_rank <= 1', 'database per-resource retention');
requireText(tightening, "changed_at >= now() - interval '7 days'", 'database age retention');
requireText(tightening, 'running_payload_bytes <= 2097152::bigint', 'database global payload budget');
requireText(tightening, 'select public.ecoflow_prune_ordermentum_master_resource_versions();', 'immediate bounded prune');
requireText(tightening, 'grant execute on function public.ecoflow_prune_ordermentum_master_resource_versions() to service_role', 'prune service boundary');

for (const migration of [baseline, tightening]) {
  assert.ok(!/create\s+extension[^;]*pg_cron/i.test(migration), 'retention must not install pg_cron');
  assert.ok(!/cron\.(job|schedule)/i.test(migration), 'retention must not call cron schema objects');
}

requireText(mirror, "db.rpc('ecoflow_ordermentum_storage_health')", 'mirror storage health check');
requireText(mirror, 'ORDERMENTUM_STORAGE_GUARD', 'pre-quota failure signal');
requireText(mirror, 'await verifyStorageHeadroom()', 'verification storage gate');
requireText(mirror, "`--touch-unchanged=${scope === 'full_history' ? 'true' : 'false'}`", 'scope-aware unchanged write policy');
requireText(common, "crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')", 'legacy payload hash compatibility');

console.log('Ordermentum version-retention audit passed: incremental writes are payload-sparse, full-history remains verifiable, history is bounded to 1/7/2MiB, and the 475 MiB guard remains fail-closed.');
