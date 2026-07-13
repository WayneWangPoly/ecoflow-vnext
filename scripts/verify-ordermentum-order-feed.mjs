#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials are required.');

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: latestOrders, error: orderError } = await db
  .from('ordermentum_raw_orders')
  .select('external_order_id,external_order_number,external_created_at,external_updated_at,last_synced_at')
  .order('external_created_at', { ascending: false, nullsFirst: false })
  .limit(12);
if (orderError) throw new Error(`Raw order verification failed: ${orderError.message}`);

const { data: latestRuns, error: runError } = await db
  .from('ordermentum_sync_runs_v2')
  .select('run_type,status,orders_seen,orders_upserted,orders_changed,last_error,started_at,finished_at')
  .order('started_at', { ascending: false })
  .limit(5);
if (runError) throw new Error(`Sync run verification failed: ${runError.message}`);

const newestRaw = latestOrders?.[0] ?? null;
let projectedOrder = null;
if (newestRaw?.external_order_id) {
  const { data, error: projectionError } = await db
    .from('om_orders')
    .select('id,order_number,status,total,updated_at')
    .eq('id', newestRaw.external_order_id)
    .maybeSingle();
  if (projectionError) throw new Error(`Projection verification failed: ${projectionError.message}`);
  projectedOrder = data;
}

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  latest_raw_orders: latestOrders ?? [],
  latest_sync_runs: latestRuns ?? [],
  newest_projected_order: projectedOrder,
}, null, 2));

const latestFinished = latestRuns?.[0]?.finished_at ? new Date(latestRuns[0].finished_at).getTime() : 0;
if (!latestFinished || Date.now() - latestFinished > 90 * 60_000) {
  throw new Error('The latest recorded order sync run is still older than 90 minutes.');
}

const latestCreated = newestRaw?.external_created_at ? new Date(newestRaw.external_created_at).getTime() : 0;
if (!latestCreated || Date.now() - latestCreated > 36 * 60 * 60_000) {
  throw new Error('No Ordermentum customer order created within the last 36 hours is present in raw history.');
}

if (!projectedOrder) {
  throw new Error(`Raw order ${newestRaw.external_order_number} has not been projected into om_orders; the operational views cannot see it.`);
}
