import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('#340A governed Product Master catalog remains complete and read-only', () => {
  const repository = source('src/data/repositories/productCommercialCatalog.ts');
  assert.match(repository, /\.from\('v_ecoflow_synced_sku_catalog'\)/);
  assert.match(repository, /\.range\(offset, offset \+ COMMERCIAL_CATALOG_BATCH_SIZE - 1\)/);
  assert.doesNotMatch(repository, /\.order\('sku'/);
  assert.doesNotMatch(repository, /ordermentum_raw_master_resources|unleashed_raw_snapshots/);
  assert.doesNotMatch(repository, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
});

test('#340A unsupported Product sellability stays unavailable', () => {
  const repository = source('src/data/repositories/productMaster.ts');
  assert.match(repository, /isSellable: null/);
  assert.doesNotMatch(repository, /isSellable:\s*row\.visible/);
  const workspace = source('src/features/products/ProductMasterWorkspace.tsx');
  assert.match(workspace, /<span>Sellable<\/span><select disabled/);
});

test('#340A commercial freshness is not asserted without an approved threshold', () => {
  const repository = source('src/data/repositories/productMaster.ts');
  assert.match(repository, /freshness: 'UNKNOWN'/);
  assert.doesNotMatch(repository, /freshness:\s*sourceObservedAt\s*\?\s*'CURRENT'/);
  assert.match(repository, /freshness is not classified as CURRENT without an approved staleness threshold/);
});

test('#340A Product Identity paging has no arbitrary 20-page ceiling', () => {
  const repository = source('src/data/repositories/productMasterIdentity.ts');
  assert.match(repository, /while \(rows\.length < totalCount\)/);
  assert.match(repository, /seenPageSignatures/);
  assert.doesNotMatch(repository, /page\s*<=\s*20|page\s*<\s*20/);
});

test('#340A Supplier mapping references are read in deterministic batches', () => {
  const repository = source('src/data/repositories/supplierMaster.ts');
  assert.match(repository, /SUPPLIER_REFERENCE_BATCH_SIZE = 500/);
  assert.match(repository, /\.range\(offset, offset \+ SUPPLIER_REFERENCE_BATCH_SIZE - 1\)/);
  assert.match(repository, /\.order\('source_external_code'/);
  assert.match(repository, /\.order\('id'/);
  assert.doesNotMatch(repository, /\.limit\(500\)/);
});

test('#340A Purchase counts fail closed at the inherited 300-row RPC ceiling', () => {
  const adapter = source('src/data/repositories/purchaseOperations.ts');
  const sharedReader = source('src/data/repositories/purchaseOrders.ts');
  const workspace = source('src/features/purchases/PurchaseOperationsWorkspace.tsx');
  assert.match(adapter, /PURCHASE_OPERATIONS_READ_LIMIT = 300/);
  assert.match(adapter, /const countExact = sourceRows\.length < PURCHASE_OPERATIONS_READ_LIMIT/);
  assert.match(adapter, /: 'DEGRADED'/);
  assert.match(adapter, /must not describe the client-side filtered count as exact/);
  assert.match(sharedReader, /Math\.min\(300,/);
  assert.match(workspace, /exact count unavailable/);
  for (const forbidden of ['createPurchaseOrder', 'startPurchaseOrderReceipt', 'reviewPurchaseOrder']) {
    assert.equal(adapter.includes(forbidden), false, `purchase adapter leaked ${forbidden}`);
    assert.equal(workspace.includes(forbidden), false, `purchase workspace leaked ${forbidden}`);
  }
});
