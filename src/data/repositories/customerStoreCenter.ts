import { supabase } from '@/lib/supabaseClient';
import { loadOrdermentumSyncSnapshot, triggerOrdermentumSync } from '@/features/team/ordermentumSync';

export type CustomerStoreDirectoryRow = {
  store_id: string;
  purchaser_id: string | null;
  store_name: string;
  address: string | null;
  street1: string | null;
  street2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  contact_phone: string | null;
  delivery_instructions: string | null;
  price_group_id: string | null;
  source: string | null;
  verified: boolean | null;
  notes: string | null;
  site_updated_at: string | null;
  lifetime_orders: number | string | null;
  orders_7d: number | string | null;
  orders_30d: number | string | null;
  revenue_7d: number | string | null;
  revenue_30d: number | string | null;
  units_30d: number | string | null;
  sku_count_30d: number | string | null;
  last_order_at: string | null;
  first_order_at: string | null;
  legacy_or_cancelled_orders: number | string | null;
  top_sku_30d: string | null;
  top_product_30d: string | null;
  top_sku_units_30d: number | string | null;
  top_sku_revenue_30d: number | string | null;
  store_signal: string | null;
  revenue_rank_30d: number | string | null;
};

export type CustomerStoreOrderRow = {
  store_id: string;
  store_name: string;
  internal_order_id: string;
  external_order_id: string | null;
  order_number: string | null;
  invoice_number: string | null;
  status: string | null;
  order_value: number | string | null;
  order_at: string | null;
  delivery_date: string | null;
  due_at: string | null;
  last_synced_at: string | null;
};

export type CustomerStoreContactRow = {
  store_key: string;
  retailer_id: string | null;
  store_name: string;
  contact_email: string | null;
  contact_name: string | null;
  enabled: boolean;
  updated_at: string | null;
};

export type StoreEmailCampaignRow = {
  id: string;
  campaign_name: string;
  subject: string;
  status: string;
  selected_store_count: number;
  recipient_count: number;
  sent_count: number;
  missing_contact_count: number;
  disabled_count: number;
  failed_count: number;
  created_at: string;
  completed_at: string | null;
};

export type StoreCampaignResult = {
  ok: boolean;
  campaignId: string;
  status: string;
  requested: number;
  storesFound: number;
  recipientCount: number;
  sent: number;
  missingContact: number;
  disabled: number;
  failed: number;
  configurationRequired: number;
};

const CACHE_TTL_MS = 45_000;
type CacheEntry<T> = { at: number; value: T };
let directoryCache: CacheEntry<CustomerStoreDirectoryRow[]> | null = null;
let directoryInflight: Promise<CustomerStoreDirectoryRow[]> | null = null;
const orderCache = new Map<string, CacheEntry<CustomerStoreOrderRow[]>>();
const orderInflight = new Map<string, Promise<CustomerStoreOrderRow[]>>();
let contactCache: CacheEntry<CustomerStoreContactRow[]> | null = null;
let contactInflight: Promise<CustomerStoreContactRow[]> | null = null;
let campaignCache: CacheEntry<StoreEmailCampaignRow[]> | null = null;
let campaignInflight: Promise<StoreEmailCampaignRow[]> | null = null;

function requireClient() {
  if (!supabase) throw new Error('Secure Supabase connection is unavailable.');
  return supabase;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return [record.message, record.details, record.hint, record.code].filter(Boolean).map(String).join(' · ');
  }
  return String(error);
}

function fresh<T>(entry?: CacheEntry<T> | null) {
  return Boolean(entry && Date.now() - entry.at < CACHE_TTL_MS);
}

export async function loadCustomerStoreDirectory(force = false) {
  if (!force && fresh(directoryCache)) return directoryCache!.value;
  if (!force && directoryInflight) return directoryInflight;
  const stale = directoryCache?.value;

  directoryInflight = (async () => {
    const client = requireClient();
    const rows: CustomerStoreDirectoryRow[] = [];
    const pageSize = 500;
    for (let start = 0; start < 5000; start += pageSize) {
      const { data, error } = await client
        .from('v_ecoflow_customer_store_directory')
        .select('*')
        .order('store_name', { ascending: true })
        .range(start, start + pageSize - 1);
      if (error) {
        if (stale?.length) return stale;
        throw new Error(errorText(error));
      }
      const page = (data ?? []) as CustomerStoreDirectoryRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    directoryCache = { at: Date.now(), value: rows };
    return rows;
  })().finally(() => { directoryInflight = null; });

  return directoryInflight;
}

export async function loadCustomerStoreOrders(storeId: string, force = false) {
  const key = storeId.trim();
  if (!key) return [];
  const cached = orderCache.get(key);
  if (!force && fresh(cached)) return cached!.value;
  const pending = orderInflight.get(key);
  if (!force && pending) return pending;
  const stale = cached?.value;

  const request = (async () => {
    const { data, error } = await requireClient()
      .from('v_ecoflow_customer_store_order_history')
      .select('*')
      .eq('store_id', key)
      .order('order_at', { ascending: false })
      .limit(500);
    if (error) {
      if (stale?.length) return stale;
      throw new Error(errorText(error));
    }
    const rows = (data ?? []) as CustomerStoreOrderRow[];
    orderCache.set(key, { at: Date.now(), value: rows });
    return rows;
  })().finally(() => orderInflight.delete(key));

  orderInflight.set(key, request);
  return request;
}

export async function loadCustomerStoreContacts(force = false) {
  if (!force && fresh(contactCache)) return contactCache!.value;
  if (!force && contactInflight) return contactInflight;
  const stale = contactCache?.value;
  contactInflight = (async () => {
    const { data, error } = await requireClient()
      .from('ecoflow_delivery_notification_contacts')
      .select('store_key,retailer_id,store_name,contact_email,contact_name,enabled,updated_at')
      .order('store_name', { ascending: true })
      .limit(1000);
    if (error) {
      if (stale?.length) return stale;
      throw new Error(errorText(error));
    }
    const rows = (data ?? []) as CustomerStoreContactRow[];
    contactCache = { at: Date.now(), value: rows };
    return rows;
  })().finally(() => { contactInflight = null; });
  return contactInflight;
}

export async function loadStoreCampaignHistory(force = false) {
  if (!force && fresh(campaignCache)) return campaignCache!.value;
  if (!force && campaignInflight) return campaignInflight;
  const stale = campaignCache?.value;
  campaignInflight = (async () => {
    const { data, error } = await requireClient()
      .from('ecoflow_store_email_campaigns')
      .select('id,campaign_name,subject,status,selected_store_count,recipient_count,sent_count,missing_contact_count,disabled_count,failed_count,created_at,completed_at')
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) {
      if (stale?.length) return stale;
      throw new Error(errorText(error));
    }
    const rows = (data ?? []) as StoreEmailCampaignRow[];
    campaignCache = { at: Date.now(), value: rows };
    return rows;
  })().finally(() => { campaignInflight = null; });
  return campaignInflight;
}

export async function projectCurrentOrdermentumStores() {
  const client = requireClient();
  const { data, error } = await client.rpc('ecoflow_project_ordermentum_stores');
  if (error) throw new Error(errorText(error));
  directoryCache = null;
  return ((data ?? [])[0] ?? null) as { projected_count?: number; source_count?: number; projected_at?: string } | null;
}

export async function triggerStoreMasterRefresh(reason = 'Owner refreshed customer store master') {
  const client = requireClient();
  directoryCache = null;
  return triggerOrdermentumSync(client, { mode: 'stores_only', reason });
}

export async function loadStoreSyncSnapshot() {
  return loadOrdermentumSyncSnapshot(requireClient());
}

export async function sendStoreCampaign(input: {
  storeIds: string[];
  campaignName: string;
  subject: string;
  bodyText: string;
}) {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('store-campaign-dispatch', { body: input });
  if (error) throw new Error(errorText(error));
  if (data?.error) throw new Error(`${data.error}${data.details ? ` · ${data.details}` : ''}`);
  campaignCache = null;
  return data as StoreCampaignResult;
}
