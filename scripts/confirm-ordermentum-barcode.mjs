#!/usr/bin/env node

function env(name, required = true) {
  const value = process.env[name];
  if (!value && required) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
}

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const externalSku = arg('--external-sku');
const barcode = arg('--barcode');
const confirmedBy = arg('--by', null);
const notes = arg('--notes', null);

if (!externalSku) throw new Error('Missing --external-sku');
if (!barcode) throw new Error('Missing --barcode');

async function rpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase RPC ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const result = await rpc('ecoflow_confirm_ordermentum_barcode', {
  p_external_sku_code: externalSku,
  p_warehouse_barcode: barcode,
  p_confirmed_by: confirmedBy,
  p_notes: notes,
});
console.table(result ?? []);
