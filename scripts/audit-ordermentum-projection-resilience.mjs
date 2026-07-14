import assert from 'node:assert/strict';
import fs from 'node:fs';

const orders = fs.readFileSync('scripts/project-ordermentum-raw-orders.mjs', 'utf8');
const invoices = fs.readFileSync('scripts/project-ordermentum-raw-invoices.mjs', 'utf8');
const mirror = fs.readFileSync('scripts/ordermentum-complete-mirror.mjs', 'utf8');

for (const [name, source] of [['orders', orders], ['invoices', invoices]]) {
  assert.ok(source.includes("message.includes('57014')"), `${name} projection must recognise PostgreSQL statement timeout SQLSTATE 57014.`);
  assert.ok(source.includes('minBatchLimit'), `${name} projection must have a minimum adaptive batch size.`);
  assert.ok(source.includes('batch_reduced'), `${name} projection must publish batch-reduction diagnostics.`);
  assert.ok(source.includes('maxProjectedRecords'), `${name} projection must retain an explicit record safety cap.`);
  assert.ok(source.includes('converged'), `${name} projection must require a zero-result convergence probe.`);
  assert.ok(source.includes('throw new Error'), `${name} projection must fail rather than silently stop at its safety cap.`);
}

assert.ok(mirror.includes("'--batch-limit', '100'"), 'Complete mirror must not start projection with the former 500-row transaction.');
assert.ok(mirror.includes("'--min-batch-limit', '5'"), 'Order projection must be allowed to shrink to transaction-sized batches.');
assert.ok(mirror.includes("'--min-batch-limit', '10'"), 'Invoice projection must be allowed to shrink independently.');

console.log('Adaptive Ordermentum projection contract passed.');
