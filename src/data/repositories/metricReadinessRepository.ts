import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  analyticsReadFailure,
  analyticsReadSuccess,
  type AnalyticsReadResult,
} from '@/features/intelligence/analytics/analyticsRepositoryContract';
import {
  metricReadinessReadState,
  normaliseMetricReadinessRows,
  type AnalyticsMetricReadinessRow,
} from '@/features/intelligence/analytics/metricReadinessContract';

export type MetricReadinessRepository = {
  readMetricReadiness: () => Promise<AnalyticsReadResult<readonly AnalyticsMetricReadinessRow[]>>;
};

function activeClient(client?: SupabaseClient | null): SupabaseClient | null {
  return client ?? supabase;
}

function unavailableClient() {
  return analyticsReadFailure({
    code: 'NOT_CONFIGURED',
    message: 'Supabase is not configured.',
  });
}

export function createMetricReadinessRepository(
  client?: SupabaseClient | null,
): MetricReadinessRepository {
  return {
    async readMetricReadiness() {
      const active = activeClient(client);
      if (!active) return unavailableClient();

      const result = await active
        .schema('analytics')
        .rpc('get_metric_projection_readiness');
      if (result.error) return analyticsReadFailure(result.error);

      const normalised = normaliseMetricReadinessRows(result.data);
      return analyticsReadSuccess(
        normalised.rows,
        metricReadinessReadState(normalised.rows, normalised.issues),
        normalised.issues,
      );
    },
  };
}

export const metricReadinessRepository = createMetricReadinessRepository();
