import process from 'node:process';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

async function read(path) {
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

const [summaryRows, candidates, blocked] = await Promise.all([
  read('v_ecoflow_ordermentum_release_summary_v2?select=*'),
  read('v_ecoflow_ordermentum_sku_mapping_candidates?select=external_sku_code,external_product_name,order_count,total_required_quantity,mapping_status&order=order_count.desc&limit=20'),
  read('v_ecoflow_ordermentum_release_gate_v2?select=order_number,invoice_number,operational_release_status,operational_blockers,line_count,unmapped_line_count,stock_shortage_count,invoice_total&operational_release_status=neq.READY_TO_RELEASE&order=order_updated_at.desc&limit=20')
]);

console.log('\nEcoFlow Ordermentum release gate summary');
console.table(summaryRows);
console.log('\nTop SKU mapping candidates');
console.table(candidates);
console.log('\nBlocked / review orders');
console.table(blocked);
