import { readFile } from 'node:fs/promises';

const path = 'supabase/migrations/20260903172543_product_identity_bounded_batch.sql';
const sql = await readFile(path, 'utf8');
const checks = [
  ['scope rows are immutable', /PRODUCT_IDENTITY_BATCH_SCOPE_IMMUTABLE/],
  ['scope escape fails closed', /PRODUCT_IDENTITY_COMMERCIAL_SKU_OUT_OF_BATCH_SCOPE/],
  ['only explicit SKU IDs are expanded', /unnest\(p_commercial_sku_ids\)/],
  ['Owner Admin authority is reused', /ecoflow_can_publish_product_identity\(\)/],
  ['command replay is payload bound', /PRODUCT_IDENTITY_COMMAND_REPLAY_PAYLOAD_MISMATCH/],
  ['concurrent start is fenced', /pg_advisory_xact_lock/],
  ['browser direct DML is revoked', /revoke all on table[\s\S]+public,anon,authenticated/i],
  ['RLS is enabled', /enable row level security/i],
  ['privileged function has empty search path', /security definer\s+set search_path=''/i],
  ['existing task authority is reused', /insert into public\.ecoflow_product_identity_tasks/i],
];

let failures = 0;
for (const [label, pattern] of checks) {
  const ok = pattern.test(sql);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures += 1;
}

for (const forbidden of [
  'ecoflow_inventory_movements',
  'ecoflow_warehouse_movements',
  'ecoflow_warehouse_location_items',
]) {
  const writes = new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${forbidden}`, 'i');
  const ok = !writes.test(sql);
  console.log(`${ok ? 'PASS' : 'FAIL'} no writes to ${forbidden}`);
  if (!ok) failures += 1;
}

if (failures) {
  console.error(`WAREHOUSE_SURVEY_002_BOUNDED_BATCH_AUDIT FAIL (${failures})`);
  process.exit(1);
}
console.log(`WAREHOUSE_SURVEY_002_BOUNDED_BATCH_AUDIT PASS (${checks.length + 3}/${checks.length + 3})`);
