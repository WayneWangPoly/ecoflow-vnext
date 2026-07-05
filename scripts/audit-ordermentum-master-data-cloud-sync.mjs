#!/usr/bin/env node
import { optionalSupabase } from './ordermentum-master-data-common.mjs';

const supabase = optionalSupabase();
if (!supabase) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

async function show(name, query) {
  const { data, error } = await query;
  if (error) {
    console.error(`\n[${name}] ERROR`, error.message);
    return;
  }
  console.log(`\n[${name}]`);
  console.table(data || []);
}

await show('capabilities', supabase
  .from('ordermentum_api_capabilities')
  .select('resource_type, endpoint, status, http_status, supports_supplier_filter, last_error, last_checked_at')
  .order('resource_type', { ascending: true }));

await show('master-data health', supabase
  .from('v_ecoflow_ordermentum_master_data_sync_health')
  .select('*')
  .order('resource_type', { ascending: true }));

await show('latest runs', supabase
  .from('ordermentum_master_sync_runs')
  .select('run_type,status,resources_requested,resources_succeeded,resources_failed,pages_seen,records_seen,records_upserted,records_changed,started_at,finished_at,last_error')
  .order('started_at', { ascending: false })
  .limit(10));
