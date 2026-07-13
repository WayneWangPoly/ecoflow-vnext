#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials are required.');

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: latestOrders, error: orderError } = await db
  .from('ordermentum_raw_orders')
  .select('external_order_number,external_created_at,external_updated_at,last_synced_at,status,payment_status')
  .order('external_created_at', { ascending: false, nullsFirst: false })
  .limit(12);
if (orderError) throw new Error(`Raw order verification failed: ${orderError.message}`);

const { data: latestRuns, error: runError } = await db
  .from('ordermentum_sync_runs_v2')
  .select('run_type,status,orders_seen,orders_upserted,orders_changed,last_error,started_at,finished_at,high_watermark_updated_at')
  .order('started_at', { ascending: false })
  .limit(5);
if (runError) throw new Error(`Sync run verification failed: ${runError.message}`);

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  latest_raw_orders: latestOrders ?? [],
  latest_sync_runs: latestRuns ?? [],
}, null, 2));

const latestFinished = latestRuns?.[0]?.finished_at ? new Date(latestRuns[0].finished_at).getTime() : 0;
if (!latestFinished || Date.now() - latestFinished > 90 * 60_000) {
  throw new Error('The latest recorded order sync run is still older than 90 minutes.');
}

const latestCreated = latestOrders?.[0]?.external_created_at ? new Date(latestOrders[0].external_created_at).getTime() : 0;
if (!latestCreated || Date.now() - latestCreated > 36 * 60 * 60_000) {
  throw new Error('No Ordermentum customer order created within the last 36 hours is present in raw history.');
}
