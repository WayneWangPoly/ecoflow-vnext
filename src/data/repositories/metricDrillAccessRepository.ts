import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  metricDrillAccessFailure,
  metricDrillAccessRpcName,
  metricDrillAccessSuccess,
  normaliseMetricDrillAccessRows,
  type MetricDrillAccessResult,
} from '@/features/intelligence/crossFilter/metricDrillAccessContract';

export type MetricDrillAccessRepository = {
  readMetricDrillAccess: () => Promise<MetricDrillAccessResult>;
};

function activeClient(client?: SupabaseClient | null): SupabaseClient | null {
  return client ?? supabase;
}

export function createMetricDrillAccessRepository(
  client?: SupabaseClient | null,
): MetricDrillAccessRepository {
  return {
    async readMetricDrillAccess() {
      const active = activeClient(client);
      if (!active) {
        return metricDrillAccessFailure({
          code: 'NOT_CONFIGURED',
          message: 'Supabase is not configured.',
        });
      }

      const result = await active
        .schema('analytics')
        .rpc(metricDrillAccessRpcName);
      if (result.error) return metricDrillAccessFailure(result.error);

      return metricDrillAccessSuccess(normaliseMetricDrillAccessRows(result.data));
    },
  };
}

export const metricDrillAccessRepository = createMetricDrillAccessRepository();
