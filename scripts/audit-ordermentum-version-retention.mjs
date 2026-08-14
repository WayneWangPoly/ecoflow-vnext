#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const source = await readFile('scripts/ordermentum-master-data-sync.mjs', 'utf8');
const invoiceDetail = await readFile('scripts/ordermentum-invoice-detail-sync.mjs', 'utf8');
const common = await readFile('scripts/ordermentum-master-data-common.mjs', 'utf8');
const policy = await readFile('scripts/ordermentum-master-version-policy.mjs', 'utf8');
const mirror = await readFile('scripts/ordermentum-complete-mirror.mjs', 'utf8');
const baseline = await readFile('supabase/migrations/20260812130000_ordermentum_master_version_retention.sql', 'utf8');
const tightening = await readFile('supabase/migrations/20260814100000_ordermentum_master_version_retention_v2.sql', 'utf8');
const invoiceProjection = await readFile('supabase/migrations/20260814132000_ordermentum_invoice_projection_checkpoint.sql', 'utf8');

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

// Invoice detail must follow the same payload-sparse contract. Bulk catalog reads
// use only identity/hash/timestamp metadata; a full payload may be loaded for one
// existing detail only after a fetched payload is proven to have changed.
requireText(invoiceDetail, "select('external_id,payload_hash,remote_updated_at')", 'invoice detail metadata-only bulk read');
assert.ok(!invoiceDetail.includes("select('external_id,payload,payload_hash,remote_created_at,remote_updated_at,last_synced_at')"),
  'invoice detail bulk reads must never load payload JSON');
requireText(invoiceDetail, 'isStatementTimeout(error)', 'invoice detail statement-timeout detection');
requireText(invoiceDetail, 'currentPageSize > minPageSize', 'invoice detail adaptive read bound');
requireText(invoiceDetail, 'Math.max(minPageSize, Math.floor(currentPageSize / 2))', 'invoice detail adaptive page shrink');
requireText(invoiceDetail, 'Invoice detail metadata read exhausted minimum page size', 'invoice detail fail-closed minimum page signal');
requireText(invoiceDetail, 'shouldArchivePreviousVersion(current, payloadHash)', 'invoice detail prior-state decision');
requireText(invoiceDetail, 'const previous = await loadCurrentDetailWithPayload(externalId)', 'invoice detail single-row prior payload read');
requireText(invoiceDetail, '.insert(buildArchivedVersion(previous, { supplierId, sourceEndpoint, syncRunId: runId }))', 'invoice detail prior-state archive');
requireText(invoiceDetail, 'await touchUnchangedDetail(externalId', 'invoice detail metadata-only unchanged touch');

const invoiceUnchangedIndex = invoiceDetail.indexOf('if (!changed)');
const invoicePriorPayloadIndex = invoiceDetail.indexOf('const previous = await loadCurrentDetailWithPayload(externalId)');
const invoiceArchiveIndex = invoiceDetail.indexOf('const archived = await archivePreviousVersion(previous, result.path)');
const invoiceCurrentUpsertIndex = invoiceDetail.indexOf(".from('ordermentum_raw_master_resources')\n        .upsert(row");
assert.ok(invoiceUnchangedIndex >= 0 && invoicePriorPayloadIndex >= 0 && invoiceUnchangedIndex < invoicePriorPayloadIndex,
  'unchanged fetched invoice details must not load the old JSON payload');
assert.ok(invoicePriorPayloadIndex >= 0 && invoiceArchiveIndex >= 0 && invoicePriorPayloadIndex < invoiceArchiveIndex,
  'changed invoice details must load the prior state before archiving it');
assert.ok(invoiceArchiveIndex >= 0 && invoiceCurrentUpsertIndex >= 0 && invoiceArchiveIndex < invoiceCurrentUpsertIndex,
  'invoice detail prior state must be archived before replacing current state');
assert.ok(!invoiceDetail.includes(".from('ordermentum_raw_master_resource_versions')\n        .insert({"),
  'invoice detail history must not insert the incoming/current payload as a duplicate version');

// Projection must choose the bounded pending batch from metadata before loading
// any raw JSON. A successful om_invoices upsert and its source checkpoint are one
// fail-closed per-row unit, so a changed source hash is always retried.
requireText(invoiceProjection, 'invoice_projected_payload_hash text', 'invoice projection checkpoint column');
requireText(invoiceProjection, 'with canonical as materialized', 'metadata-only canonical invoice set');
requireText(invoiceProjection, 'select distinct on (source.external_id)', 'canonical identity selection');
requireText(invoiceProjection, 'pending as materialized', 'bounded pending invoice set');
requireText(invoiceProjection, 'canonical.invoice_projected_payload_hash is distinct from canonical.payload_hash', 'hash checkpoint pending predicate');
requireText(invoiceProjection, 'limit greatest(coalesce(p_limit, 1000), 1)', 'bounded metadata limit');
requireText(invoiceProjection, 'join public.ordermentum_raw_master_resources source', 'post-limit payload load');
requireText(invoiceProjection, 'source.payload_hash = pending.payload_hash', 'payload/checkpoint snapshot consistency');
requireText(invoiceProjection, 'set\n        invoice_projected_payload_hash = v_rec.payload_hash', 'post-projection checkpoint');
requireText(invoiceProjection, 'get diagnostics v_checkpointed = row_count', 'checkpoint row-count proof');
requireText(invoiceProjection, "v_invoice_id <> public.ecoflow_om_safe_uuid(v_rec.external_id)", 'embedded/source identity guard');
assert.ok(!invoiceProjection.includes('to_jsonb(i.raw_json)'),
  'incremental projection must not compare every projected raw_json payload');
assert.ok(!invoiceProjection.includes('row_number() over'),
  'incremental projection must not rank payload-heavy source rows with a window scan');
assert.ok(!invoiceProjection.includes("source.payload->>'id'"),
  'candidate discovery must not extract invoice ids from source JSON');
assert.ok(!/select\s+public\.ecoflow_project_ordermentum_raw_invoices\s*\(/i.test(invoiceProjection),
  'migration must not perform an unbounded/bootstrap projection during deployment');

requireText(invoiceProjection, 'create or replace function public.ecoflow_ordermentum_storage_inventory()', 'storage inventory RPC');
requireText(invoiceProjection, 'pg_catalog.pg_database_size(current_database())', 'database size inventory');
requireText(invoiceProjection, 'pg_catalog.pg_total_relation_size(c.oid)', 'relation total-size inventory');
requireText(invoiceProjection, 'pg_catalog.pg_indexes_size(c.oid)', 'relation index-size inventory');
requireText(invoiceProjection, 'grant execute on function public.ecoflow_ordermentum_storage_inventory() to service_role', 'storage inventory service boundary');
requireText(invoiceProjection, 'revoke all on function public.ecoflow_ordermentum_storage_inventory() from public, anon, authenticated', 'storage inventory public boundary');

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

for (const migration of [baseline, tightening, invoiceProjection]) {
  assert.ok(!/create\s+extension[^;]*pg_cron/i.test(migration), 'retention/projection must not install pg_cron');
  assert.ok(!/cron\.(job|schedule)/i.test(migration), 'retention/projection must not call cron schema objects');
}

requireText(mirror, "db.rpc('ecoflow_ordermentum_storage_inventory')", 'mirror storage inventory evidence');
requireText(mirror, "db.rpc('ecoflow_ordermentum_storage_health')", 'mirror storage health check');
requireText(mirror, 'ORDERMENTUM_STORAGE_GUARD', 'pre-quota failure signal');
requireText(mirror, 'await verifyStorageHeadroom()', 'verification storage gate');
requireText(mirror, "`--touch-unchanged=${scope === 'full_history' ? 'true' : 'false'}`", 'scope-aware unchanged write policy');
requireText(common, "crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')", 'legacy payload hash compatibility');

for (const script of [
  'scripts/ordermentum-master-data-sync.mjs',
  'scripts/ordermentum-invoice-detail-sync.mjs',
  'scripts/ordermentum-complete-mirror.mjs',
]) {
  const syntax = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, `${script} syntax error: ${syntax.stderr || syntax.stdout}`);
}

console.log('Ordermentum storage/projection audit passed: master and invoice-detail syncs are payload-sparse, invoice projection selects metadata before bounded payload load, projection checkpoints fail closed, production storage inventory is service-only, history remains 1/7/2MiB, and the 475 MiB guard is unchanged.');
