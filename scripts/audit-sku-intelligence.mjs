#!/usr/bin/env node

function env(name, required = true) {
  const value = process.env[name];
  if (!value && required) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const SUPABASE_URL = env('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

async function rest(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json'
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase REST ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function table(title, rows) {
  console.log(`\n=== ${title} ===`);
  if (!rows || rows.length === 0) {
    console.log('(no rows)');
    return;
  }
  console.table(rows);
}

const dashboard = await rest('v_ecoflow_ordermentum_sku_library_dashboard?select=*');
const topBySales = await rest('v_ecoflow_sku_abc_analysis?select=external_sku_code,external_product_name,abc_sales_class,movement_class,lifetime_order_count,lifetime_quantity,lifetime_sales_value,barcode_status,required_action&sku_classification=neq.SERVICE_ITEM&order=lifetime_sales_value.desc&limit=20');
const barcodeGaps = await rest('v_ecoflow_top_skus_for_barcode_confirmation?select=barcode_priority_rank,external_sku_code,external_product_name,abc_sales_class,movement_class,lifetime_order_count,lifetime_sales_value,ordermentum_barcode_candidate_type,barcode_status,required_action&limit=30');
const dormant = await rest('v_ecoflow_sku_activity_summary?select=external_sku_code,external_product_name,lifetime_order_count,ordermentum_barcode_candidate_type,barcode_status&lifetime_order_count=eq.0&order=external_sku_code.asc&limit=20');
const service = await rest('v_ecoflow_sku_activity_summary?select=external_sku_code,external_product_name,lifetime_order_count,lifetime_sales_value,barcode_status&sku_classification=eq.SERVICE_ITEM&order=lifetime_sales_value.desc&limit=20');

table('SKU Library Dashboard', dashboard);
table('Top 20 SKUs by Lifetime Sales', topBySales);
table('Top Barcode Confirmation Queue', barcodeGaps);
table('Dormant / Never Ordered Listed SKUs', dormant);
table('Service Items', service);
