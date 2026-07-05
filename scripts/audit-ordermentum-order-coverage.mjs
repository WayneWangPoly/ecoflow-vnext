#!/usr/bin/env node
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
async function get(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text);
}
const [dashboard, monthly, issues, topSkus] = await Promise.all([
  get('v_ecoflow_ordermentum_sku_library_dashboard_v2?select=*'),
  get('v_ecoflow_ordermentum_order_monthly_summary_v2?select=*&order=order_month.desc&limit=24'),
  get('v_ecoflow_ordermentum_all_orders_audit_v2?select=order_data_status,line_count&order_data_status=neq.OK&limit=20'),
  get('v_ecoflow_sku_abc_analysis_v2?select=external_sku_code,external_product_name,abc_sales_class,movement_class,lifetime_order_count,lifetime_sales_value,last_ordered_day&order=lifetime_sales_value.desc&limit=20'),
]);
console.log('\nSKU / Order Library Dashboard V2');
console.table(dashboard);
console.log('\nMonthly Order Summary V2');
console.table(monthly);
console.log('\nOrders With Data Issues (sample)');
console.table(issues);
console.log('\nTop SKU by Sales Value');
console.table(topSkus);
