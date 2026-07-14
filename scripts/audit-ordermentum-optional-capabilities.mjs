import assert from 'node:assert/strict';
import fs from 'node:fs';

const common = fs.readFileSync('scripts/ordermentum-master-data-common.mjs', 'utf8');
const sync = fs.readFileSync('scripts/ordermentum-master-data-sync.mjs', 'utf8');
const mirror = fs.readFileSync('scripts/ordermentum-complete-mirror.mjs', 'utf8');

assert.ok(mirror.includes('stock_locations'), 'Complete mirror must still probe stock locations when available.');
assert.ok(common.includes('optionalCapability: true'), 'Stock locations must be declared as an optional Ordermentum capability.');
assert.ok(sync.includes('resourcesUnavailable'), 'Unavailable optional capabilities must be reported separately.');
assert.ok(sync.includes('isOptionalCapabilityUnavailable'), 'Optional capability handling must be explicit.');
assert.ok(sync.includes('detailFailuresByResource'), 'Detail failures must be attributable by source resource.');
assert.ok(sync.includes('if (resourcesFailed.length) process.exitCode = 2;'), 'Required source failures must still fail the mirror.');

console.log('Optional Ordermentum capability contract passed.');
