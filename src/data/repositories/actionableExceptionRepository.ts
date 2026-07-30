import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  actionableExceptionReadFailure,
  actionableExceptionReadSuccess,
  actionableExceptionRpcName,
  normaliseActionableExceptionRequest,
  normaliseActionableExceptionRows,
  type ActionableExceptionReadResult,
  type ActionableExceptionRecord,
} from '@/features/intelligence/attention/actionableExceptionReadContract';

export type ActionableExceptionRepository = {
  readActionableExceptions: (
    limit?: unknown,
  ) => Promise<ActionableExceptionReadResult<readonly ActionableExceptionRecord[]>>;
};

function activeClient(client?: SupabaseClient | null): SupabaseClient | null {
  return client ?? supabase;
}

function unavailableClient() {
  return actionableExceptionReadFailure({
    code: 'NOT_CONFIGURED',
    message: 'Supabase is not configured.',
  });
}

export function createActionableExceptionRepository(
  client?: SupabaseClient | null,
): ActionableExceptionRepository {
  return {
    async readActionableExceptions(limit) {
      const request = normaliseActionableExceptionRequest(limit);
      if (!request.ok) {
        return actionableExceptionReadFailure({
          code: request.issue.code,
          message: `${request.issue.field ?? 'request'}: ${request.issue.value ?? 'invalid'}`,
        });
      }

      const active = activeClient(client);
      if (!active) return unavailableClient();

      const result = await active
        .schema('analytics')
        .rpc(actionableExceptionRpcName, { p_limit: request.request.limit });
      if (result.error) return actionableExceptionReadFailure(result.error);

      const normalised = normaliseActionableExceptionRows(result.data);
      return actionableExceptionReadSuccess(
        normalised.rows,
        normalised.state,
        normalised.issues,
      );
    },
  };
}

export const actionableExceptionRepository = createActionableExceptionRepository();
