import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = 'supabase/migrations/20260727120500_legacy_returns_acl_hardening.sql';
const source = fs.readFileSync(file, 'utf8');

const checks = [
  ['transaction boundary', /\bbegin;\s*[\s\S]*\bcommit;\s*$/i],
  ['preflight marker', /RETURNS_ACL_PREREQUISITES_MISSING/],
  ['active role hardened search path', /alter function public\.ecoflow_active_app_role\(\)[\s\S]{0,120}set search_path = pg_catalog, public;/],
  ['active role public revoke', /revoke all on function public\.ecoflow_active_app_role\(\)[\s\S]{0,80}from public, anon, authenticated;/],
  ['queue impl rename', /rename to ecoflow_queue_delivery_notifications_acl_impl;/],
  ['exception impl rename', /rename to ecoflow_record_delivery_exception_acl_impl;/],
  ['scan impl rename', /rename to ecoflow_scan_delivery_return_acl_impl;/],
  ['drop impl rename', /rename to ecoflow_driver_drop_return_acl_impl;/],
  ['inspection impl rename', /rename to ecoflow_record_return_inspection_item_acl_impl;/],
  ['complete impl rename', /rename to ecoflow_complete_return_inspection_acl_impl;/],
  ['queue impl search path', /ecoflow_queue_delivery_notifications_acl_impl[\s\S]{0,180}set search_path = pg_catalog, public;/],
  ['exception impl search path', /ecoflow_record_delivery_exception_acl_impl[\s\S]{0,220}set search_path = pg_catalog, public;/],
  ['scan impl search path', /ecoflow_scan_delivery_return_acl_impl[\s\S]{0,140}set search_path = pg_catalog, public;/],
  ['drop impl search path', /ecoflow_driver_drop_return_acl_impl[\s\S]{0,180}set search_path = pg_catalog, public;/],
  ['inspection impl search path', /ecoflow_record_return_inspection_item_acl_impl[\s\S]{0,180}set search_path = pg_catalog, public;/],
  ['complete impl search path', /ecoflow_complete_return_inspection_acl_impl[\s\S]{0,140}set search_path = pg_catalog, public;/],
  ['impl use column', /set plpgsql\.variable_conflict = use_column;/],
  ['impl revoke list', /revoke all on function %s from public, anon, authenticated/],
  ['queue wrapper', /create function public\.ecoflow_queue_delivery_notifications\(/],
  ['queue driver gate', /DELIVERY_NOTIFICATION_DRIVER_ROLE_REQUIRED/],
  ['exception wrapper', /create function public\.ecoflow_record_delivery_exception\(/],
  ['exception driver gate', /DELIVERY_EXCEPTION_DRIVER_ROLE_REQUIRED/],
  ['scan wrapper', /create function public\.ecoflow_scan_delivery_return\(/],
  ['scan warehouse gate', /RETURN_WAREHOUSE_ROLE_REQUIRED/],
  ['drop wrapper', /create function public\.ecoflow_driver_drop_return\(/],
  ['drop driver gate', /RETURN_DRIVER_ROLE_REQUIRED/],
  ['inspection wrapper', /create function public\.ecoflow_record_return_inspection_item\(/],
  ['inspection warehouse gate', /RETURN_INSPECTION_WAREHOUSE_ROLE_REQUIRED/],
  ['complete wrapper', /create function public\.ecoflow_complete_return_inspection\(/],
  ['server actor binding', /format\('%s:%s',v_role,auth\.uid\(\)::text\)/],
  ['notification settings RLS', /alter table public\.ecoflow_delivery_notification_settings enable row level security;/],
  ['notifications RLS', /alter table public\.ecoflow_delivery_notifications enable row level security;/],
  ['exceptions RLS', /alter table public\.ecoflow_delivery_exceptions enable row level security;/],
  ['scans RLS', /alter table public\.ecoflow_delivery_return_scans enable row level security;/],
  ['zones RLS', /alter table public\.ecoflow_warehouse_return_zones enable row level security;/],
  ['inspection RLS', /alter table public\.ecoflow_delivery_return_inspection_lines enable row level security;/],
  ['drop legacy policies', /from pg_policies[\s\S]{0,500}drop policy if exists/],
  ['revoke notifications tables', /revoke all on table public\.ecoflow_delivery_notifications from public, anon, authenticated;/],
  ['revoke exceptions tables', /revoke all on table public\.ecoflow_delivery_exceptions from public, anon, authenticated;/],
  ['revoke scans tables', /revoke all on table public\.ecoflow_delivery_return_scans from public, anon, authenticated;/],
  ['service role notification write', /grant select,insert,update on table public\.ecoflow_delivery_notifications to service_role;/],
  ['column notification grant', /grant select \([\s\S]{0,500}\) on public\.ecoflow_delivery_notifications to authenticated;/],
  ['column exception grant', /grant select \([\s\S]{0,600}\) on public\.ecoflow_delivery_exceptions to authenticated;/],
  ['office notification policy', /create policy ecoflow_delivery_notifications_office_read/],
  ['active exception policy', /create policy ecoflow_delivery_exceptions_active_read/],
  ['zone operations policy', /create policy ecoflow_warehouse_return_zones_operations_read/],
  ['inspection warehouse policy', /create policy ecoflow_return_inspection_lines_warehouse_read/],
  ['notification security invoker', /v_ecoflow_delivery_notification_outbox[\s\S]{0,120}security_invoker = true/],
  ['zone security invoker', /v_ecoflow_warehouse_return_zones[\s\S]{0,120}security_invoker = true/],
  ['inspection security invoker', /v_ecoflow_return_inspection_lines[\s\S]{0,120}security_invoker = true/],
  ['open returns security invoker', /v_ecoflow_open_delivery_returns[\s\S]{0,120}security_invoker = true/],
  ['summary role filter', /v_ecoflow_delivery_exception_summary[\s\S]{0,1200}ecoflow_active_app_role\(\) in \('OWNER','ADMIN','ACCOUNT','VIEWER'\)/],
  ['anon view revoke', /revoke all on table public\.v_ecoflow_open_delivery_returns from public, anon;/],
  ['wrapper execute grants', /grant execute on function public\.ecoflow_complete_return_inspection\(uuid,text,text\)[\s\S]{0,40}to authenticated;/],
];

for (const [name, pattern] of checks) {
  assert.match(source, pattern, `Legacy returns ACL check failed: ${name}`);
}

assert.equal(checks.length, 54);
console.log(`Legacy returns ACL static audit passed (${checks.length}/${checks.length}).`);
