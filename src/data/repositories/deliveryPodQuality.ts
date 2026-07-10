import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { uploadPodAsset } from '@/data/repositories/pickSync';

export type PodQualityContext = {
  businessDay: string;
  orderId: string;
  orderNumber?: string | null;
  stopNumber?: number | null;
  boxCode?: string | null;
  storeName?: string | null;
  actorLabel?: string | null;
};

function requireSupabase(client?: SupabaseClient | null) {
  const active = client ?? supabase;
  if (!active) throw new Error('Supabase is not configured.');
  return active;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code].filter(Boolean).map(String);
    return parts.length ? parts.join(' · ') : JSON.stringify(record);
  }
  return String(error);
}

export async function resolveOrderIdForBox(input: { businessDay: string; boxCode: string }, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const { data, error } = await active
    .from('ecoflow_day_state')
    .select('payload')
    .eq('business_day', input.businessDay)
    .eq('scope', 'meta')
    .maybeSingle();
  if (error) throw new Error(errorMessage(error));
  const payload = (data?.payload ?? {}) as { boxCodes?: Record<string, string> };
  return Object.entries(payload.boxCodes ?? {}).find(([, code]) => code === input.boxCode)?.[0] ?? null;
}

export async function saveGoodsPlacedProof(input: { context: PodQualityContext; dataUrl: string }, client?: SupabaseClient | null) {
  const active = requireSupabase(client);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `${input.context.businessDay}/${input.context.orderId}/goods-placed-${stamp}.jpg`;
  const photoPath = await uploadPodAsset(path, input.dataUrl);
  if (!photoPath) throw new Error('Goods placed photo could not be uploaded. Check connection and try again.');

  const { error } = await active
    .from('ecoflow_delivery_pod_proofs')
    .upsert({
      business_day: input.context.businessDay,
      order_id: input.context.orderId,
      order_number: input.context.orderNumber ?? null,
      stop_number: input.context.stopNumber ?? null,
      box_code: input.context.boxCode ?? null,
      store_name: input.context.storeName ?? null,
      proof_type: 'POD2_GOODS_PLACED',
      photo_path: photoPath,
      captured_at: new Date().toISOString(),
      captured_by: input.context.actorLabel ?? 'Driver',
    }, { onConflict: 'business_day,order_id,proof_type' });
  if (error) throw new Error(errorMessage(error));
  return photoPath;
}
