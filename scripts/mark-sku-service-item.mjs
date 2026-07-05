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
const notes = arg('notes', 'Marked as non-warehouse service item.');

if (!sku) {
  console.error('Usage: node scripts/mark-sku-service-item.mjs --sku FC-01 --notes "Freight charge"');
  process.exit(1);
}

const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ecoflow_mark_ordermentum_sku_service_item`, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  },
  body: JSON.stringify({ p_external_sku_code: sku, p_notes: notes })
});
const text = await response.text();
if (!response.ok) throw new Error(`Supabase RPC ${response.status}: ${text}`);
console.log(JSON.stringify(text ? JSON.parse(text) : null, null, 2));
