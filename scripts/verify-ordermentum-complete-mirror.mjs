#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials are required.');

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await db
  .from('v_ecoflow_ordermentum_mirror_health_v1')
  .select('*')
  .maybeSingle();

if (error) throw new Error(`Complete mirror verification failed: ${error.message}`);
if (!data) throw new Error('Complete mirror verification returned no health row.');

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  ordermentum_complete_mirror: data,
}, null, 2));

const blockers = [
  ['order projection gaps', Number(data.order_projection_missing ?? 0)],
  ['invoice projection gaps', Number(data.invoice_projection_missing ?? 0)],
  ['recent orders missing lines', Number(data.recent_orders_missing_lines ?? 0)],
  ['recent orders missing invoice detail', Number(data.recent_orders_missing_invoice_detail ?? 0)],
  ['unknown recent source statuses', Number(data.unknown_recent_statuses ?? 0)],
  ['recent finance reconciliation reviews', Number(data.recent_finance_reviews ?? 0)],
].filter(([, count]) => count > 0);

if (data.overall_status !== 'COMPLETE') {
  const detail = blockers.length
    ? blockers.map(([label, count]) => `${label}: ${count}`).join('; ')
    : 'one or more master domains have no mirrored rows';
  throw new Error(`Ordermentum mirror is ${data.overall_status}: ${detail}`);
}
