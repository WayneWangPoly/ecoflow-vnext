import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  normaliseShadowDrillEvidenceRequest,
  normaliseShadowDrillEvidenceRows,
  shadowDrillEvidenceFailure,
  shadowDrillEvidenceInvalid,
  shadowDrillEvidenceRpcName,
  shadowDrillEvidenceSuccess,
  type ShadowDrillEvidenceRequestInput,
  type ShadowDrillEvidenceResult,
} from '@/features/intelligence/crossFilter/shadowDrillEvidenceContract';

export type ShadowDrillEvidenceRepository = {
  readShadowDrillEvidence: (
    request: ShadowDrillEvidenceRequestInput,
  ) => Promise<ShadowDrillEvidenceResult>;
};

function activeClient(client?: SupabaseClient | null): SupabaseClient | null {
  return client ?? supabase;
}

export function createShadowDrillEvidenceRepository(
  client?: SupabaseClient | null,
): ShadowDrillEvidenceRepository {
  return {
    async readShadowDrillEvidence(input) {
      const normalisedRequest = normaliseShadowDrillEvidenceRequest(input);
      if (!normalisedRequest.ok) return shadowDrillEvidenceInvalid(normalisedRequest.issue);

      const active = activeClient(client);
      if (!active) {
        return shadowDrillEvidenceFailure({
          code: 'NOT_CONFIGURED',
          message: 'Supabase is not configured.',
        });
      }

      const request = normalisedRequest.request;
      const result = await active
        .schema('analytics')
        .rpc(shadowDrillEvidenceRpcName, {
          p_metric_key: request.metricKey,
          p_dimension_key: request.dimensionKey,
          p_date_from: request.dateFrom,
          p_date_to: request.dateTo,
          p_breakdown_limit: request.breakdownLimit,
          p_entity_limit: request.entityLimit,
        });
      if (result.error) return shadowDrillEvidenceFailure(result.error);

      return shadowDrillEvidenceSuccess(
        request,
        normaliseShadowDrillEvidenceRows(result.data, request),
      );
    },
  };
}

export const shadowDrillEvidenceRepository = createShadowDrillEvidenceRepository();
