import { createClient } from '@supabase/supabase-js';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const supabase = createClient(
  requiredEnv('SUPABASE_URL'),
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } }
);

async function readView(name) {
  const { data, error } = await supabase.from(name).select('*');
  if (error) throw new Error(`${name}: ${error.message}`);
  return data ?? [];
}

const health = await readView('v_ecoflow_ordermentum_system_health_checks');
console.log('\nEcoFlow Ordermentum system health');
console.table(health.map(row => ({
  check: row.check_key,
  status: row.status,
  current: row.current_value,
  expected: row.expected_value,
  message: row.message,
})));

const daily = await readView('v_ecoflow_ordermentum_daily_workbench');
console.log('\nDaily workbench');
console.table(daily.map(row => ({
  day: row.business_day,
  orders: row.total_orders,
  ready: row.ready_to_internalise,
  mapping: row.blocked_mapping,
  data: row.blocked_data,
  payment: row.review_payment,
  total: row.invoice_total,
})));

const { data: sku, error: skuError } = await supabase
  .from('v_ecoflow_ordermentum_sku_mapping_workbench')
  .select('*')
  .order('priority_rank', { ascending: true })
  .limit(20);
if (skuError) throw new Error(`v_ecoflow_ordermentum_sku_mapping_workbench: ${skuError.message}`);
console.log('\nTop SKU mapping priorities');
console.table((sku ?? []).map(row => ({
  rank: row.priority_rank,
  sku: row.external_sku_code,
  product: row.external_product_name,
  orders: row.order_count,
  lines: row.line_count,
  qty: row.total_required_quantity,
  status: row.mapping_status,
  action: row.required_action,
})));
