import assert from 'node:assert/strict';
import fs from 'node:fs';

const projection = fs.readFileSync('scripts/project-ordermentum-raw-orders.mjs', 'utf8');
const verifier = fs.readFileSync('scripts/verify-ordermentum-complete-mirror.mjs', 'utf8');

assert.ok(
  projection.includes("action: 'refresh_ui_active_order_keys_deferred'"),
  'Derived cache refresh failure must be reported explicitly.',
);
assert.ok(
  projection.includes('blocking: false'),
  'Derived cache refresh must be non-blocking.',
);
assert.ok(
  !verifier.includes('ecoflow_ui_active_order_keys'),
  'Complete mirror verification must not depend on a UI acceleration cache.',
);

console.log('Active-order key cache boundary contract passed.');
