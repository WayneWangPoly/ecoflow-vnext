import process from 'node:process';

function env(name, required = true) {
  const value = process.env[name];
  if (!value && required) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

async function supabaseGet(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

const [progress] = await supabaseGet('v_ecoflow_ordermentum_mapping_progress?select=*');
const board = await supabaseGet('v_ecoflow_ordermentum_order_readiness_board?select=*&order=release_gate_status.asc');
const top = await supabaseGet('v_ecoflow_ordermentum_sku_setup_queue?select=priority_rank,external_sku_code,external_product_name,order_count,line_count,total_required_quantity,total_sales_value,mapping_status,setup_action&mapping_status=neq.MAPPED&order=priority_rank.asc&limit=20');

console.log('\nOrdermentum mapping progress');
console.table([progress]);
console.log('\nOrder readiness board');
console.table(board);
console.log('\nTop unmapped SKU candidates');
console.table(top);
