import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');

function filesUnder(path) {
  const base = join(root, path);
  const output = [];
  for (const name of readdirSync(base)) {
    const full = join(base, name);
    if (statSync(full).isDirectory()) output.push(...filesUnder(relative(root, full)));
    else output.push(relative(root, full));
  }
  return output;
}

const receiving = read('src/WarehouseReceivingFlow.tsx');
const barcode = read('src/WarehouseBarcodeSprint.tsx');
const main = read('src/main.tsx');
const ownerEdit = read('src/WarehouseMapOwnerEdit.tsx');
const safety = read('src/ProductionWriteSafety.tsx');

assert.match(receiving, /Open receiving work/, 'Receiving must expose open batch recovery.');
assert.match(receiving, /Multiple deliveries are open/, 'Receiving must warn when multiple batches are active.');
assert.match(receiving, /Complete batch and post stock/, 'Receiving must keep one explicit stock-posting gate.');
assert.doesNotMatch(barcode, /receiveByBarcode|MAP_AND_RECEIVE|Save \+ receive stock/i, 'Barcode setup must not provide a second receiving path.');
assert.match(barcode, /Stock was not changed/, 'Barcode setup must explicitly confirm mapping-only behaviour.');
assert.match(main, /ProductionWriteSafety/, 'Production write safety must be mounted.');
assert.match(main, /WarehouseCameraScanner/, 'Mobile warehouse camera scanner must be mounted.');
assert.match(main, /WarehouseMapOwnerEdit/, 'Owner layout editor must be mounted.');
assert.match(ownerEdit, /OWNER|ADMIN/, 'Warehouse layout editing must be owner/admin gated.');
assert.match(safety, /Read-only safety mode/, 'Production fallback must become read-only.');

const badEncoding = /脳|路|鈥|锟|�/;
const violations = filesUnder('src')
  .filter((path) => /\.(ts|tsx|css|html)$/.test(path))
  .filter((path) => badEncoding.test(read(path)));
assert.deepEqual(violations, [], `Mojibake found in: ${violations.join(', ')}`);

console.log('Warehouse productisation audit passed.');
