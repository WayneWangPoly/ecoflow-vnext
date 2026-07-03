#!/usr/bin/env node

function env(name, required = true) {
  const value = process.env[name];
  if (!value && required) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

async function rest(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function print(title, rows) {
  console.log(`\n=== ${title} ===`);
  if (!rows || rows.length === 0) {
    console.log('(no rows)');
    return;
  }
  console.table(rows);
}

const control = await rest('v_ecoflow_ordermentum_internalisation_control?select=*');
print('Internalisation control', control);

const accountQueue = await rest(
  'v_ecoflow_ordermentum_account_release_queue?select=queue_rank,order_number,invoice_number,payment_status,invoice_total,total_due,line_count,account_release_status,warehouse_gate_status,required_action&order=queue_rank.asc&limit=20'
);
print('Account release queue', accountQueue);

const barcodeWorkbench = await rest(
  'v_ecoflow_ordermentum_barcode_confirmation_workbench?select=priority_rank,external_sku_code,external_product_name,order_count,line_count,ordermentum_barcode_candidate,barcode_candidate_type,warehouse_barcode,barcode_status,warehouse_gate_status,required_action&order=priority_rank.asc&limit=25'
);
print('Barcode confirmation workbench', barcodeWorkbench);

const drafts = await rest(
  'v_ecoflow_ordermentum_internal_order_drafts_v3?select=order_number,invoice_number,creation_status,internalisation_status,account_release_status,warehouse_gate_status,line_count,invoice_total&order=order_number.desc&limit=20'
);
print('Internal order drafts', drafts);
