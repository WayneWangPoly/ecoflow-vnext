import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const source = readFileSync(join(root, 'supabase/migrations/20260803140800_return_command_concurrency.sql'), 'utf8');

for (const contract of [
  'return-receipt-command:',
  'return-inspection-command:',
  'pg_advisory_xact_lock',
  'ecoflow_receive_delivery_return_locked_impl',
  'ecoflow_inspect_delivery_return_item_locked_impl',
]) {
  assert.ok(source.includes(contract), `Missing return concurrency contract: ${contract}`);
}

assert.ok(
  source.indexOf("pg_advisory_xact_lock") < source.indexOf('ecoflow_receive_delivery_return_locked_impl('),
  'Receipt command must acquire its advisory lock before invoking the ledger-backed implementation',
);
assert.ok(
  source.lastIndexOf('pg_advisory_xact_lock') < source.lastIndexOf('ecoflow_inspect_delivery_return_item_locked_impl('),
  'Inspection command must acquire its advisory lock before invoking the ledger-backed implementation',
);
assert.ok(
  source.includes('revoke all on function public.ecoflow_receive_delivery_return_locked_impl'),
  'Authenticated callers must not bypass the receipt lock wrapper',
);
assert.ok(
  source.includes('revoke all on function public.ecoflow_inspect_delivery_return_item_locked_impl'),
  'Authenticated callers must not bypass the inspection lock wrapper',
);

console.log('Return command concurrency audit passed (9 contracts).');
