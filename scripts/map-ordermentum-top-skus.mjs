import process from 'node:process';

function env(name, required = true) {
  const value = process.env[name];
  if (!value && required) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const limit = Number(argValue('--limit', process.env.ORDERMENTUM_MAP_SKU_LIMIT ?? '25'));
const dryRun = process.argv.includes('--dry-run');

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

async function supabaseRpc(functionName, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase RPC ${response.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

if (!Number.isFinite(limit) || limit < 1) {
  throw new Error('--limit must be a positive number');
}

if (dryRun) {
  const preview = await supabaseGet(`v_ecoflow_ordermentum_sku_setup_queue?select=priority_rank,external_sku_code,external_product_name,order_count,line_count,total_required_quantity,total_sales_value,mapping_status,setup_action&mapping_status=neq.MAPPED&order=priority_rank.asc&limit=${limit}`);
  console.log(`Dry run. Would map up to ${limit} SKU candidates.`);
  console.table(preview);
  process.exit(0);
}

const rows = await supabaseRpc('ecoflow_bulk_map_ordermentum_skus', {
  p_limit: limit,
  p_created_by: 'node-map-ordermentum-top-skus',
});

console.log(`Mapped ${rows.length} Ordermentum SKU candidates.`);
console.table(rows);

const [progress] = await supabaseGet('v_ecoflow_ordermentum_mapping_progress?select=*');
console.log('\nUpdated mapping progress');
console.table([progress]);
