import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  normalisePriorityWorkRequest,
  normalisePriorityWorkRows,
  priorityWorkReadFailure,
  priorityWorkReadSuccess,
  priorityWorkRpcName,
  type PriorityWorkReadResult,
} from '@/features/intelligence/attention/priorityWorkContract';

export type PriorityWorkRepository = {
  readPriorityWork: (limit?: unknown) => Promise<PriorityWorkReadResult>;
};

function activeClient(client?: SupabaseClient | null): SupabaseClient | null {
  return client ?? supabase;
}

export function createPriorityWorkRepository(
  client?: SupabaseClient | null,
): PriorityWorkRepository {
  return {
    async readPriorityWork(limit) {
      const request = normalisePriorityWorkRequest(limit);
      if (!request.ok) {
        return priorityWorkReadFailure({
          code: request.issue.code,
          message: `${request.issue.field ?? 'request'}: ${request.issue.value ?? 'invalid'}`,
        });
      }

      const active = activeClient(client);
      if (!active) {
        return priorityWorkReadFailure({
          code: 'NOT_CONFIGURED',
          message: 'Supabase is not configured.',
        });
      }

      const result = await active
        .schema('analytics')
        .rpc(priorityWorkRpcName, { p_limit: request.request.limit });
      if (result.error) return priorityWorkReadFailure(result.error);

      return priorityWorkReadSuccess(normalisePriorityWorkRows(result.data));
    },
  };
}

export const priorityWorkRepository = createPriorityWorkRepository();
