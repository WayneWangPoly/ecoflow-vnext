#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const repairPath = 'supabase/migrations/20260814143000_transform_007b_accounts_snapshot_safe_refresh.sql';
const customerSourcePath = 'supabase/migrations/20260813040000_transform_007b_accounts_customer_timeout_repair.sql';
const kpiSourcePath = 'supabase/migrations/20260813030000_transform_007b_accounts_summary_timeout_repair.sql';
const existingSafeRefreshPath = 'supabase/migrations/20260807223500_control_room_snapshot_safe_refresh.sql';

const [repair, customerSource, kpiSource, existingSafeRefresh] = await Promise.all([
  readFile(repairPath, 'utf8'),
  readFile(customerSourcePath, 'utf8'),
  readFile(kpiSourcePath, 'utf8'),
  readFile(existingSafeRefreshPath, 'utf8'),
]);

function requireText(source, text, label) {
  assert.ok(source.includes(text), `${label} is missing required contract: ${text}`);
}

// Preserve evidence for why the forward repair exists: the two later Accounts
// snapshots regressed the managed-Supabase safe-delete pattern already used by
// the Control Room exception snapshot.
requireText(customerSource,
  'delete from public.ecoflow_accounts_statement_customer_snapshot;',
  'customer snapshot predecessor');
requireText(kpiSource,
  'delete from public.ecoflow_accounts_ar_kpi_snapshot;',
  'AR KPI snapshot predecessor');
requireText(existingSafeRefresh,
  'where s.exception_id is not null',
  'existing managed-Supabase safe-refresh precedent');

requireText(repair,
  'create or replace function public.ecoflow_refresh_accounts_statement_customer_snapshot()',
  'customer snapshot forward repair');
requireText(repair,
  'delete from public.ecoflow_accounts_statement_customer_snapshot s\n  where s.snapshot_refreshed_at is not null;',
  'customer snapshot explicit safe-delete predicate');
requireText(repair,
  'create or replace function public.ecoflow_refresh_accounts_ar_kpi_snapshot()',
  'AR KPI snapshot forward repair');
requireText(repair,
  'delete from public.ecoflow_accounts_ar_kpi_snapshot s\n  where s.snapshot_refreshed_at is not null;',
  'AR KPI snapshot explicit safe-delete predicate');

assert.ok(
  !repair.includes('delete from public.ecoflow_accounts_statement_customer_snapshot;'),
  'customer snapshot refresh must never return to an unconditional DELETE',
);
assert.ok(
  !repair.includes('delete from public.ecoflow_accounts_ar_kpi_snapshot;'),
  'AR KPI snapshot refresh must never return to an unconditional DELETE',
);

requireText(repair,
  "ACCOUNTS_SNAPSHOT_SAFE_REFRESH_REQUIRES_NOT_NULL_REFRESH_TIMESTAMP",
  'safe-delete predicate preflight');
requireText(repair,
  'select public.ecoflow_refresh_dashboard_read_models();',
  'deployment-time stale snapshot repair');
requireText(repair,
  'ACCOUNTS_SNAPSHOT_SAFE_REFRESH_VERIFY_FAILED',
  'post-refresh freshness verification');
requireText(repair,
  'grant execute on function public.ecoflow_refresh_accounts_statement_customer_snapshot()\n  to service_role;',
  'customer refresh service-role boundary');
requireText(repair,
  'grant execute on function public.ecoflow_refresh_accounts_ar_kpi_snapshot()\n  to service_role;',
  'KPI refresh service-role boundary');

assert.ok(!/safeupdate\s*=\s*(off|false|0)/i.test(repair),
  'the repair must never disable managed-Supabase safe-update protection');
assert.ok(!/set_config\([^\n]*safeupdate/i.test(repair),
  'the repair must never bypass safe-update protection through set_config');
assert.ok(!/truncate\s+(table\s+)?public\.ecoflow_accounts_/i.test(repair),
  'snapshot replacement must remain transactional DELETE/INSERT rather than TRUNCATE');

console.log('Accounts snapshot safe-refresh contract passed: both derived snapshot replacements use explicit NOT NULL predicates, preserve service-role boundaries, repair freshness on deploy, and never disable managed-Supabase safe-update protection.');
