#!/usr/bin/env node

function env(name, required = true) {
  const value = process.env[name];
  if (!value && required) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

const sku = arg('sku');
const barcode = arg('barcode');
const level = arg('level', 'CARTON');
const qty = Number(arg('qty', '1'));
const type = arg('type', 'UNKNOWN');
const source = arg('source', 'warehouse_scan');
const by = arg('by', process.env.USERNAME || process.env.USER || null);
const notes = arg('notes', null);

if (!sku || !barcode) {
  console.error('Usage: node scripts/confirm-sku-barcode.mjs --sku CCSB8-80 --barcode 19312345678928 --level CARTON --qty 1000 --type GTIN_14');
  process.exit(1);
}

async function rpc(fn, payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase RPC ${fn} ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const result = await rpc('ecoflow_confirm_sku_barcode', {
  p_external_sku_code: sku,
  p_barcode: barcode,
  p_level_code: level,
  p_quantity_in_base_units: qty,
  p_barcode_type: type,
  p_source: source,
  p_is_primary: true,
  p_confirmed_by: by,
  p_notes: notes
});

console.log(JSON.stringify(result, null, 2));
