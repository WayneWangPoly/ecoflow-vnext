import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');

const receiving = read('src/WarehouseReceivingFlow.tsx');
const barcode = read('src/WarehouseBarcodeSprint.tsx');
const main = read('src/main.tsx');
const ownerEdit = read('src/WarehouseMapOwnerEdit.tsx');
const putaway = read('src/WarehouseMapPutawayControl.tsx');
const safety = read('src/ProductionWriteSafety.tsx');
const textRepair = read('src/TextEncodingRepair.tsx');
const scanner = read('src/WarehouseCameraScanner.tsx');
const stage = read('src/StageAndLoadExecution.tsx');

assert.match(receiving, /Open receiving work/, 'Receiving must expose open batch recovery.');
assert.match(receiving, /Multiple deliveries are open/, 'Receiving must warn when multiple batches are active.');
assert.match(receiving, /Complete batch and post stock/, 'Receiving must keep one explicit stock-posting gate.');
assert.match(receiving, /Number\.isInteger\(qty\)/, 'Receiving package quantity must be a positive integer.');
assert.doesNotMatch(barcode, /receiveByBarcode|MAP_AND_RECEIVE|Save \+ receive stock/i, 'Barcode setup must not provide a second receiving path.');
assert.match(barcode, /Stock was not changed/, 'Barcode setup must explicitly confirm mapping-only behaviour.');
assert.match(barcode, /levelAllowed/, 'Barcode package mode must constrain package level.');
assert.match(main, /ProductionWriteSafety/, 'Production write safety must be mounted.');
assert.match(main, /WarehouseCameraScanner/, 'Mobile warehouse camera scanner must be mounted.');
assert.match(main, /WarehouseMapOwnerEdit/, 'Owner layout editor must be mounted.');
assert.match(main, /WarehouseMapPutawayControl/, 'Warehouse map must mount the controlled putaway surface.');
assert.match(main, /TextEncodingRepair/, 'Legacy text encoding repair must be mounted.');
assert.match(ownerEdit, /OWNER|ADMIN/, 'Warehouse layout editing must be owner/admin gated.');
assert.match(putaway, /All stock increases still go through the controlled Receive batch/, 'Map must explain the single receiving path.');
assert.match(putaway, /legacyReceive\.hidden = true/, 'Legacy map receiving UI must be removed from the operator path.');
assert.match(safety, /Read-only safety mode/, 'Production fallback must become read-only.');
assert.match(scanner, /BarcodeDetector/, 'Phone camera barcode detection must be available.');
assert.match(scanner, /mountedVideo/, 'Camera must wait for the scanner surface before attaching the stream.');
assert.match(textRepair, /脳.*×|路.*·/s, 'Known legacy mojibake must be repaired in rendered text.');
assert.doesNotMatch(stage, /@ts-nocheck/, 'Stage and load execution must remain type checked.');
assert.match(stage, /Offline · saved on this device/, 'Stage preparation must expose offline sync state.');
assert.match(stage, /syncByKey/, 'Stage preparation sync state must be tracked per stop.');

console.log('Warehouse productisation audit passed.');
