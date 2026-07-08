import {
  applySupabaseOrdermentumViews,
  type SupabaseDraftRow,
  type SupabaseExceptionRow,
  type SupabaseInboxRow,
  type SupabaseOmOrderRow,
  type SupabaseOrderLineRow,
  type SupabaseOrdermentumViews,
  type SupabaseReleaseSummaryRow,
  type SupabaseSkuMappingCandidateRow,
  type SupabaseSkuMasterRow,
  type SupabaseStoreSiteRow,
  type SupabaseSyncHealthRow,
} from './supabaseOrdermentumViews';

export { applySupabaseOrdermentumViews };

function envValue(key: string) {
  return (import.meta.env[key] as string | undefined)?.trim() || '';
}

function hasSupabaseConfig() {
  return Boolean(envValue('VITE_SUPABASE_URL') && envValue('VITE_SUPABASE_ANON_KEY'));
}

async function supabaseFetch<T>(path: string): Promise<T> {
  const baseUrl = envValue('VITE_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = envValue('VITE_SUPABASE_ANON_KEY');
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function optionalFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    return await supabaseFetch<T>(path);
  } catch {
    return fallback;
  }
}

async function firstAvailable<T>(paths: string[], fallback: T): Promise<T> {
  for (const path of paths) {
    try {
      return await supabaseFetch<T>(path);
    } catch {
      // Keep trying. A new SQL view may be missing, invalid, or awaiting schema-cache reload.
    }
  }
  return fallback;
}

export async function loadSupabaseOrdermentumViews(): Promise<SupabaseOrdermentumViews | null> {
  if (!hasSupabaseConfig()) return null;

  const [inbox, exceptions, healthRows, lines, drafts, omOrders, skuMaster, storeSites, releaseSummaryRows, skuMappingCandidates] = await Promise.all([
    firstAvailable<SupabaseInboxRow[]>([
      'v_ecoflow_ordermentum_ui_active_inbox?select=*&order=order_updated_at.desc&limit=160',
      'v_ecoflow_ordermentum_inbox?select=*&order=order_updated_at.desc&limit=160'
    ], []),
    firstAvailable<SupabaseExceptionRow[]>([
      'v_ecoflow_ordermentum_ui_active_exceptions?select=*&order=detected_at.desc&limit=160',
      'v_ecoflow_ordermentum_exceptions?select=*&order=detected_at.desc&limit=160'
    ], []),
    optionalFetch<SupabaseSyncHealthRow[]>('v_ecoflow_ordermentum_sync_health?select=*', []),
    firstAvailable<SupabaseOrderLineRow[]>([
      'v_ecoflow_ordermentum_ui_active_order_lines?select=*&order=order_number.asc&limit=1200',
      'v_ecoflow_ordermentum_order_lines?select=*&order=order_number.asc&limit=1200'
    ], []),
    firstAvailable<SupabaseDraftRow[]>([
      'v_ecoflow_ordermentum_ui_active_drafts?select=*&order=last_synced_at.desc&limit=300',
      'v_ecoflow_ordermentum_internal_order_drafts_v3?select=*&order=last_synced_at.desc&limit=300'
    ], []),
    firstAvailable<SupabaseOmOrderRow[]>([
      'v_ecoflow_ordermentum_ui_active_om_orders?select=id,order_number,retailer_id,retailer_name,delivery_date,due_at,total_quantity&order=updated_at.desc&limit=300',
      'om_orders?select=id,order_number,retailer_id,retailer_name,delivery_date,due_at,total_quantity&order=updated_at.desc&limit=300'
    ], []),
    optionalFetch<SupabaseSkuMasterRow[]>('v_ecoflow_app_sku_master?select=*&limit=2000', []),
    optionalFetch<SupabaseStoreSiteRow[]>('ecoflow_store_sites?select=*&limit=1000', []),
    optionalFetch<SupabaseReleaseSummaryRow[]>('v_ecoflow_ordermentum_release_summary_v2?select=*', []),
    optionalFetch<SupabaseSkuMappingCandidateRow[]>('v_ecoflow_ordermentum_sku_mapping_candidates?select=*&order=order_count.desc&limit=200', [])
  ]);

  return {
    inbox,
    exceptions,
    health: healthRows[0] || null,
    lines,
    drafts,
    omOrders,
    skuMaster,
    storeSites,
    releaseSummary: releaseSummaryRows[0] || null,
    skuMappingCandidates
  };
}
