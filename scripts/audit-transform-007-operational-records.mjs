import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260811020000_transform_007_operational_records.sql';
assert.ok(existsSync(migrationPath), `${migrationPath} is required`);

const migration = readFileSync(migrationPath, 'utf8');

const required = [
  ['versioned page RPC', /create or replace function public\.ecoflow_read_operational_records_v1\(/i],
  ['versioned detail RPC', /create or replace function public\.ecoflow_read_operational_record_detail_v1\(/i],
  ['authenticated identity', /auth\.uid\(\) is null/i],
  ['explicit fail-closed role authority', /coalesce\(v_role,''\) not in \('OWNER','ADMIN','ACCOUNT','VIEWER'\)/i],
  ['page lower bound', /v_page\s*<\s*1/i],
  ['bounded page sizes', /v_size not in \(10,20,25,50,100\)/i],
  ['bounded detail limit', /least\(greatest\(coalesce\(p_limit,50\),1\),100\)/i],
  ['inventory workspace', /v_workspace='inventory'/i],
  ['customer workspace', /v_workspace='customers'/i],
  ['accounts workspace', /v_workspace='accounts'/i],
  ['returns workspace', /v_workspace='returns'/i],
  ['live location ledger', /ecoflow_warehouse_location_items/i],
  ['customer order history', /v_ecoflow_customer_store_order_history/i],
  ['account holds', /ecoflow_account_release_holds/i],
  ['return inspection evidence', /ecoflow_delivery_return_inspection_lines/i],
  ['return inventory movement evidence', /movement_id/i],
  ['public/anon revocation', /revoke all on function public\.ecoflow_read_operational_records_v1[\s\S]*from public,anon,authenticated/i],
  ['authenticated page grant', /grant execute on function public\.ecoflow_read_operational_records_v1[\s\S]*to authenticated/i],
  ['authenticated detail grant', /grant execute on function public\.ecoflow_read_operational_record_detail_v1[\s\S]*to authenticated/i],
];

for (const [label, pattern] of required) assert.match(migration, pattern, label);

assert.doesNotMatch(migration, /create\s+(?:or replace\s+)?function[^\n]*(analytics|forecast|score)/i);
assert.doesNotMatch(migration, /grant execute[^\n]*to anon/i);
assert.doesNotMatch(migration, /ecoflow_record_accounts_statement_action/i);
assert.doesNotMatch(migration, /ecoflow_complete_return_inspection/i);

console.log('TRANSFORM-007 operational-records static audit passed.');
