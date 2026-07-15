#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials are required.');
const requireHistory = process.argv.some((arg) => arg === '--require-history=true');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const views = requireHistory
  ? ['v_ecoflow_ordermentum_mirror_health_v3', 'v_ecoflow_ordermentum_mirror_health_v2', 'v_ecoflow_ordermentum_mirror_health_v1']
  : ['v_ecoflow_ordermentum_mirror_health_v2', 'v_ecoflow_ordermentum_mirror_health_v1'];
let source = null;
let data = null;
for (const view of views) {
  const result = await db.from(view).select('*').maybeSingle();
  if (!result.error) { source = view; data = result.data; break; }
  const text = result.error.message || '';
  if (!/does not exist|schema cache|pgrst205|42p01/i.test(text)) throw new Error(`${view}: ${text}`);
}
if (!source || !data) throw new Error('No compatible Ordermentum mirror health row is available.');
console.log(JSON.stringify({ generated_at: new Date().toISOString(), health_view: source, require_history: requireHistory, ordermentum_complete_mirror: data }, null, 2));

const blockers = [
  ['order projection gaps', Number(data.order_projection_missing || 0)],
  ['invoice projection gaps', Number(data.invoice_projection_missing || 0)],
  ['recent orders missing lines', Number(data.recent_orders_missing_lines || 0)],
  ['recent orders missing invoice detail', Number(data.recent_orders_missing_invoice_detail || 0)],
  ['unknown recent source statuses', Number(data.unknown_recent_statuses || 0)],
  ['recent finance reconciliation reviews', Number(data.recent_finance_reviews || 0)],
  ['source-missing active fulfilment', Number(data.active_source_missing_orders || 0)],
];
if (requireHistory) {
  if (source !== 'v_ecoflow_ordermentum_mirror_health_v3') blockers.push(['history health unavailable', 1]);
  if (data.history_pipeline_status !== 'COMPLETE') blockers.push(['history pipeline incomplete', 1]);
  if (data.history_catalog_complete !== true) blockers.push(['history catalog incomplete', 1]);
  blockers.push(['history details pending', Number(data.detail_pending || 0)]);
  blockers.push(['history details failed', Number(data.detail_failed || 0)]);
}
const active = blockers.filter((entry) => entry[1] > 0);
if (data.overall_status !== 'COMPLETE' || active.length) {
  throw new Error(`Ordermentum mirror is ${data.overall_status}: ${active.map(([label, count]) => `${label}: ${count}`).join('; ') || 'required source domain incomplete'}`);
}
