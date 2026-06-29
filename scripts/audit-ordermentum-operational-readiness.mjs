#!/usr/bin/env node

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase environment variables. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  process.exit(1);
}

async function read(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const [summaryRows, blockedRows, lineRows] = await Promise.all([
  read('v_ecoflow_ordermentum_readiness_summary?select=*'),
  read('v_ecoflow_ordermentum_release_queue?select=order_number,invoice_number,release_status,release_blockers,line_count,invoice_total,order_updated_at&release_status=neq.READY_TO_RELEASE&order=order_updated_at.desc'),
  read('v_ecoflow_ordermentum_order_lines?select=order_number,line_id&limit=1')
]);

const summary = summaryRows[0] || {};
console.log('\nEcoFlow Ordermentum operational readiness');
console.table([{ 
  total_orders: summary.total_orders,
  ready_to_release: summary.ready_to_release,
  review_payment: summary.review_payment,
  blocked_data: summary.blocked_data,
  invoice_detail_missing: summary.invoice_detail_missing,
  line_items_missing: summary.line_items_missing,
  invoice_total: summary.invoice_total,
  total_due: summary.total_due,
  last_synced_at: summary.last_synced_at
}]);

if (blockedRows.length) {
  console.log('\nOrders not ready for release');
  console.table(blockedRows);
} else {
  console.log('\nAll retained Ordermentum orders are ready for release checks.');
}

console.log(`\nOrder-line view status: ${lineRows.length ? 'available' : 'available but no sample line returned'}`);
