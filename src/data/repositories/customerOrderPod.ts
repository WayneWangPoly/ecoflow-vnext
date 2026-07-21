import { supabase } from '@/lib/supabaseClient';

export type CustomerOrderPodPreview = {
  orderId: string;
  orderNumber: string;
  pod1Path: string | null;
  pod2Path: string | null;
  capturedAt: string | null;
};

const TTL_MS = 60_000;
let cache: { at: number; byOrderNumber: Map<string, CustomerOrderPodPreview> } | null = null;
let inflight: Promise<Map<string, CustomerOrderPodPreview>> | null = null;

function client() {
  if (!supabase) throw new Error('Secure Supabase connection is unavailable.');
  return supabase;
}

function normalise(value: string | null | undefined) {
  return String(value || '').trim().toUpperCase();
}

export async function loadCustomerOrderPodIndex(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.byOrderNumber;
  if (!force && inflight) return inflight;
  const stale = cache?.byOrderNumber;

  inflight = (async () => {
    const active = client();
    const [stateResult, orderResult] = await Promise.allSettled([
      active
        .from('ecoflow_day_state')
        .select('scope,payload,updated_at')
        .order('updated_at', { ascending: false })
        .limit(3000),
      active
        .from('v_ecoflow_customer_store_order_history')
        .select('internal_order_id,order_number')
        .order('order_at', { ascending: false })
        .limit(5000),
    ]);

    if (stateResult.status === 'rejected') {
      if (stale) return stale;
      throw stateResult.reason;
    }
    if (orderResult.status === 'rejected') {
      if (stale) return stale;
      throw orderResult.reason;
    }
    if (stateResult.value.error || orderResult.value.error) {
      if (stale) return stale;
      throw stateResult.value.error || orderResult.value.error;
    }

    const orderNumberById = new Map<string, string>();
    (orderResult.value.data ?? []).forEach((row) => {
      const record = row as { internal_order_id?: string | null; order_number?: string | null };
      const id = String(record.internal_order_id || '').trim();
      const orderNumber = normalise(record.order_number);
      if (id && orderNumber) orderNumberById.set(id, orderNumber);
    });

    const byOrderNumber = new Map<string, CustomerOrderPodPreview>();
    (stateResult.value.data ?? []).forEach((row) => {
      const record = row as { scope?: string | null; payload?: Record<string, unknown> | null };
      const scope = String(record.scope || '');
      const marker = scope.lastIndexOf('stop:');
      if (marker < 0) return;
      const orderId = scope.slice(marker + 5).trim();
      const orderNumber = orderNumberById.get(orderId);
      if (!orderNumber || byOrderNumber.has(orderNumber)) return;
      const payload = (record.payload || {}) as { pod?: Record<string, unknown> };
      const pod = payload.pod || {};
      const pod1Path = String(pod.pod1Path || pod.photoPath || '').trim() || null;
      const pod2Path = String(pod.pod2Path || pod.signaturePath || '').trim() || null;
      if (!pod1Path && !pod2Path) return;
      byOrderNumber.set(orderNumber, {
        orderId,
        orderNumber,
        pod1Path,
        pod2Path,
        capturedAt: String(pod.capturedAt || '').trim() || null,
      });
    });

    cache = { at: Date.now(), byOrderNumber };
    return byOrderNumber;
  })().finally(() => { inflight = null; });

  return inflight;
}
