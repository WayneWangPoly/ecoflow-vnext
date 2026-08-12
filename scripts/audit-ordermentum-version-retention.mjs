#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('scripts/ordermentum-master-data-sync.mjs', 'utf8');
const common = await readFile('scripts/ordermentum-master-data-common.mjs', 'utf8');
const policy = await readFile('scripts/ordermentum-master-version-policy.mjs', 'utf8');
const mirror = await readFile('scripts/ordermentum-complete-mirror.mjs', 'utf8');
const migration = await readFile('supabase/migrations/20260812130000_ordermentum_master_version_retention.sql', 'utf8');

function requireText(text, expected, label) {
  assert.ok(text.includes(expected), `${label} is missing required contract: ${expected}`);
}

requireText(source, "shouldArchivePreviousVersion(existing.data, payloadHash)", 'master sync change policy');
requireText(source, "select('resource_type,external_id,supplier_id,source_endpoint,payload,payload_hash,sync_run_id')", 'master sync previous-state read');
requireText(source, 'buildArchivedVersion(existing, { supplierId, sourceEndpoint, syncRunId: runId })', 'master sync previous-state archive');
requireText(source, "const changed = !existing.data || existing.data.payload_hash !== payloadHash", 'first-seen/detail behavior');

const archiveIndex = source.indexOf('if (archivePrevious) await archivePreviousVersion');
const currentUpsertIndex = source.indexOf("const saved = await supabase.from('ordermentum_raw_master_resources').upsert");
assert.ok(archiveIndex >= 0 && currentUpsertIndex >= 0 && archiveIndex < currentUpsertIndex,
  'previous state must be archived before the current mirror is replaced');
assert.ok(!source.includes('payload: item, payload_hash: payloadHash, sync_run_id: runId'),
  'version history must not store the incoming/current payload snapshot');

requireText(policy, 'maxVersionsPerResource: 3', 'version count policy');
requireText(policy, 'maxAgeDays: 30', 'version age policy');
requireText(policy, 'maxPayloadBytes: 10 * 1024 * 1024', 'global version payload policy');
requireText(policy, '475 * 1024 * 1024', 'pre-quota database guard');

requireText(migration, 'resource_rank <= 3', 'database per-resource retention');
requireText(migration, "changed_at >= now() - interval '30 days'", 'database age retention');
requireText(migration, 'running_payload_bytes <= 10485760::bigint', 'database global payload budget');
requireText(migration, 'after insert on public.ordermentum_raw_master_resource_versions', 'database hard-retention trigger');
requireText(migration, 'grant execute on function public.ecoflow_prune_ordermentum_master_resource_versions() to service_role', 'service-only prune grant');
requireText(migration, 'grant execute on function public.ecoflow_ordermentum_storage_health() to service_role', 'service-only storage health grant');
assert.ok(!/create\s+extension[^;]*pg_cron/i.test(migration), 'retention must not install pg_cron');
assert.ok(!/cron\.(job|schedule)/i.test(migration), 'retention must not call cron schema objects');

requireText(mirror, "db.rpc('ecoflow_ordermentum_storage_health')", 'mirror storage health check');
requireText(mirror, 'ORDERMENTUM_STORAGE_GUARD', 'pre-quota failure signal');
requireText(mirror, 'await verifyStorageHeadroom()', 'verification storage gate');

// Do not silently change the hash algorithm in the storage hotfix. Existing current
// rows were populated with this hash; changing it without a dedicated migration
// would make every resource appear changed once and refill history immediately.
requireText(common, "crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')", 'legacy payload hash compatibility');

console.log('Ordermentum version-retention audit passed: first-seen duplicates are blocked, prior-state history is bounded, service-only retention is enforced, and 475 MiB headroom is gated.');
