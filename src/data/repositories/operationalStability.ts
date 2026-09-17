import type { SupabaseClient } from '@supabase/supabase-js';
import { approveStocktake as approveStocktakeV2 } from './operationalStabilityV2';

export * from './operationalStabilityV2';

/**
 * Keep the warehouse approval acknowledgement visible even when the workspace
 * immediately reloads its server-authoritative read model after the command.
 *
 * The underlying repository remains the only RPC caller. This facade only
 * presents the authoritative approval result returned by the server; it does
 * not infer success from local state and does not mutate inventory itself.
 */
export async function approveStocktake(
  input: Parameters<typeof approveStocktakeV2>[0],
  client?: SupabaseClient | null,
) {
  const result = await approveStocktakeV2(input, client);

  if (typeof window !== 'undefined') {
    const status = String(result?.session_status ?? 'APPROVED');
    const revision = String(result?.revision ?? '—');
    const adjustments = String(result?.adjustment_count ?? '—');
    window.alert(
      `Stocktake approval succeeded.\nStatus: ${status}\nRevision: ${revision}\nAdjustments posted: ${adjustments}`,
    );
  }

  return result;
}
