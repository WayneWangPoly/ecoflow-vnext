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
const limit = Number(arg('--limit', '25'));
const execute = process.argv.includes('--execute');
const dryRun = !execute;
const includePaymentReview = !process.argv.includes('--exclude-payment-review');

if (!Number.isFinite(limit) || limit <= 0) {
  throw new Error('--limit must be a positive number');
}

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

const result = await rpc('ecoflow_internalise_ordermentum_orders', {
  p_limit: limit,
  p_dry_run: dryRun,
  p_include_payment_review: includePaymentReview,
});

console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
console.log(`Limit: ${limit}`);
console.log(`Include payment review orders: ${includePaymentReview}`);
console.table(result ?? []);

if (dryRun) {
  console.log('\nNo data was written. Re-run with --execute to create/update internal orders.');
}
