#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const db = createClient(url, key, { auth: { persistSession: false } });

async function count(table, filter) {
  let query = db.from(table).select('*', { count: 'exact', head: true });
  if (filter) query = filter(query);
  const { count: value, error } = await query;
  return error ? { error: error.message, code: error.code } : { count: value ?? 0 };
}

async function sample(table, columns = '*', filter) {
  let query = db.from(table).select(columns).limit(3);
  if (filter) query = filter(query);
  const { data, error } = await query;
  return error ? { error: error.message, code: error.code } : { rows: data ?? [] };
}

function keyMap(value, depth = 0) {
  if (depth > 3 || value === null || typeof value !== 'object') return typeof value;
  if (Array.isArray(value)) return value.length ? [`array(${value.length})`, keyMap(value[0], depth + 1)] : ['array(0)'];
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, keyMap(child, depth + 1)]));
}

const rawSamples = {};
for (const resource of ['products', 'variants', 'price_groups']) {
  const result = await sample('ordermentum_raw_master_resources', 'resource_type,external_id,payload,last_synced_at', (q) => q.eq('resource_type', resource).order('last_synced_at', { ascending: false }));
  rawSamples[resource] = result.error ? result : {
    rows: result.rows.map((row) => ({
      resource_type: row.resource_type,
      external_id: row.external_id,
      payload_keys: keyMap(row.payload),
      candidate_values: Object.fromEntries(Object.entries(row.payload ?? {}).filter(([name]) => /sku|code|name|id|price/i.test(name)).slice(0, 30)),
      last_synced_at: row.last_synced_at,
    })),
  };
}

const report = {
  generated_at: new Date().toISOString(),
  raw_counts: {
    products: await count('ordermentum_raw_master_resources', (q) => q.eq('resource_type', 'products').eq('is_deleted_or_missing', false)),
    variants: await count('ordermentum_raw_master_resources', (q) => q.eq('resource_type', 'variants').eq('is_deleted_or_missing', false)),
    price_groups: await count('ordermentum_raw_master_resources', (q) => q.eq('resource_type', 'price_groups').eq('is_deleted_or_missing', false)),
  },
  projection_counts: {
    canonical_sku_master: await count('v_ecoflow_ordermentum_sku_master_v1'),
    synced_sku_catalog: await count('v_ecoflow_synced_sku_catalog'),
    inventory_sku_control: await count('v_ecoflow_inventory_sku_control'),
    synced_price_groups: await count('v_ecoflow_synced_price_groups'),
  },
  projection_samples: {
    canonical_sku_master: await sample('v_ecoflow_ordermentum_sku_master_v1'),
    synced_sku_catalog: await sample('v_ecoflow_synced_sku_catalog'),
    inventory_sku_control: await sample('v_ecoflow_inventory_sku_control', 'sku,product_name,fixed_shelf,primary_barcode,inventory_signal'),
    synced_price_groups: await sample('v_ecoflow_synced_price_groups'),
  },
  exception_counts: {
    active_exception_view: await count('v_ecoflow_ordermentum_ui_active_exceptions'),
    all_exception_view: await count('v_ecoflow_ordermentum_exceptions'),
    active_inbox: await count('v_ecoflow_ordermentum_ui_active_inbox'),
    legacy_review: await count('v_ecoflow_order_lifecycle_legacy_internal_review'),
  },
  raw_samples: rawSamples,
};

console.log(JSON.stringify(report, null, 2));
