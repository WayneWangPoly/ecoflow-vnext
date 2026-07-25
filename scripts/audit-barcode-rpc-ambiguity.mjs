import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const source = readFileSync(join(root, 'supabase/migrations/20260725100000_fix_barcode_rpc_ambiguous_sku.sql'), 'utf8');

assert.ok(source.includes('create or replace function public.ecoflow_set_sku_package_policy'), 'Package-policy RPC fix is required.');
assert.ok(source.includes('create or replace function public.ecoflow_record_barcode_scan'), 'Barcode scan RPC fix is required.');
assert.ok(source.includes('where velocity.sku = v_sku'), 'Velocity SKU references must be table-qualified.');
assert.ok(source.includes('on conflict on constraint ecoflow_sku_package_policies_pkey'), 'Package-policy upsert must avoid ambiguous sku conflict targets.');
assert.ok(source.includes('on conflict on constraint ecoflow_sku_barcode_registry_barcode_key'), 'Barcode upsert must avoid ambiguous barcode conflict targets.');
assert.ok(source.includes('on conflict on constraint ecoflow_inventory_sku_controls_pkey'), 'Inventory-control upsert must avoid ambiguous sku conflict targets.');
assert.ok(source.includes('#variable_conflict error'), 'RPCs must reject future unqualified variable/column collisions.');

console.log('Barcode RPC ambiguity audit passed.');
