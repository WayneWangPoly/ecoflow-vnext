import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  hashTargetPayload,
  isUuid,
  mergeStoreProjection,
  projectPurchaserToStoreRow,
  purchaserDetailPath,
  resolvePurchaserIdentity,
  unchangedTarget,
} from './ordermentum-targeted-store-sync-core.mjs';

const purchaserId = '11111111-1111-4111-8111-111111111111';
const retailerId = '22222222-2222-4222-8222-222222222222';
const priceGroupId = '33333333-3333-4333-8333-333333333333';

test('targeted purchaser endpoint is exactly one detail path', () => {
  assert.equal(purchaserDetailPath(purchaserId), `/v1/purchasers/${purchaserId}`);
  assert.throws(() => purchaserDetailPath('not-an-id'), /Invalid purchaser external ID/);
  assert.equal(isUuid(purchaserId), true);
});

test('purchaser identity mismatch fails closed', () => {
  assert.equal(resolvePurchaserIdentity({ id: purchaserId }, purchaserId), purchaserId);
  assert.throws(
    () => resolvePurchaserIdentity({ id: retailerId }, purchaserId),
    /identity mismatch/,
  );
});

test('store projection follows production purchaser field precedence', () => {
  const row = projectPurchaserToStoreRow({
    id: purchaserId,
    retailerId,
    retailerName: 'Target Cafe',
    retailerPhone: '08 7000 0000',
    deliveryInstructions: 'Rear loading bay',
    priceGroupId,
    address: {
      street1: '1 Target St',
      street2: 'Unit 2',
      suburb: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      latitude: '-33.8688',
      longitude: '151.2093',
    },
  }, purchaserId);

  assert.deepEqual(row, {
    retailer_id: retailerId,
    purchaser_id: purchaserId,
    store_name: 'Target Cafe',
    street1: '1 Target St',
    street2: 'Unit 2',
    suburb: 'Sydney',
    state: 'NSW',
    postcode: '2000',
    formatted_address: '1 Target St, Unit 2, Sydney, NSW, 2000',
    latitude: -33.8688,
    longitude: 151.2093,
    contact_phone: '08 7000 0000',
    delivery_instructions: 'Rear loading bay',
    price_group_id: priceGroupId,
    source: 'ordermentum',
    verified: true,
    notes: 'Projected from targeted Ordermentum purchaser detail',
  });
});

test('manual store is never overwritten', () => {
  const projected = projectPurchaserToStoreRow({ id: purchaserId, retailerId, name: 'Remote Name' }, purchaserId);
  assert.deepEqual(
    mergeStoreProjection({ retailer_id: retailerId, source: 'manual', store_name: 'Local Authority' }, projected, '2026-08-26T00:00:00.000Z'),
    { action: 'manual_preserved', row: null },
  );
});

test('targeted merge preserves existing non-null fields omitted by provider', () => {
  const projected = projectPurchaserToStoreRow({ id: purchaserId, retailerId, name: 'Target Cafe' }, purchaserId);
  const merged = mergeStoreProjection({
    retailer_id: retailerId,
    source: 'ordermentum',
    store_name: 'Old Name',
    street1: 'Existing Street',
    suburb: 'Existing Suburb',
    contact_phone: '123',
  }, projected, '2026-08-26T00:00:00.000Z');
  assert.equal(merged.action, 'updated');
  assert.equal(merged.row.store_name, 'Target Cafe');
  assert.equal(merged.row.street1, 'Existing Street');
  assert.equal(merged.row.suburb, 'Existing Suburb');
  assert.equal(merged.row.contact_phone, '123');
});

test('same payload hash is a no-op decision', () => {
  const payload = { id: purchaserId, retailerId, name: 'Target Cafe' };
  const hash = hashTargetPayload(payload);
  assert.equal(unchangedTarget(hash, hash), true);
  assert.equal(unchangedTarget(null, hash), false);
  assert.equal(unchangedTarget(hash, hashTargetPayload({ ...payload, name: 'Changed' })), false);
});

test('implementation cannot fall back to full purchaser projection or persistent run logging', async () => {
  const source = await readFile('scripts/ordermentum-targeted-store-sync.mjs', 'utf8');
  assert.match(source, /purchaserDetailPath\(externalId\)/);
  assert.doesNotMatch(source, /ecoflow_project_ordermentum_stores/);
  assert.doesNotMatch(source, /ordermentum_master_sync_runs/);
  assert.doesNotMatch(source, /resources=purchasers|--resources=purchasers/);
  assert.match(source, /databaseWrites:\s*0/);
  assert.match(source, /process\.exit\(0\)/);
});

test('dedicated workflow is manual-only and retains one day of evidence', async () => {
  const workflow = await readFile('.github/workflows/ordermentum-targeted-store-sync.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s*schedule:\s*\n/);
  assert.doesNotMatch(workflow, /\n\s*push:\s*\n/);
  assert.doesNotMatch(workflow, /\n\s*workflow_run:\s*\n/);
  assert.match(workflow, /--external-id="\$\{\{ inputs\.external_id \}\}"/);
  assert.match(workflow, /retention-days:\s*1/);
  assert.doesNotMatch(workflow, /--mode stores_only|--mode sku_only|ordermentum-master-data-sync/);
});

test('Edge Function is owner-admin only and does not create persistent operational jobs', async () => {
  const source = await readFile('supabase/functions/trigger-ordermentum-targeted-sync/index.ts', 'utf8');
  assert.match(source, /\['OWNER', 'ADMIN'\]\.includes\(actorProfile\.app_role\)/);
  assert.match(source, /resource !== 'purchaser'/);
  assert.match(source, /INVALID_PURCHASER_ID/);
  assert.match(source, /ordermentum-targeted-store-sync\.yml/);
  assert.match(source, /external_id: externalId/);
  assert.doesNotMatch(source, /ecoflow_operational_sync_jobs/);
  assert.match(source, /app_security_audit_events/);
});
