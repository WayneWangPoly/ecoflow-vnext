import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  actionableExceptionLifecycleAccessFailure,
  actionableExceptionLifecycleAccessRpcName,
  normaliseActionableExceptionLifecycleAccess,
  type ActionableExceptionLifecycleAccessResult,
} from '@/features/intelligence/attention/actionableExceptionLifecycleAccessContract';

export type ActionableExceptionLifecycleAccessRepository = {
  readAccess: () => Promise<ActionableExceptionLifecycleAccessResult>;
};

function activeClient(client?: SupabaseClient | null): SupabaseClient | null {
  return client ?? supabase;
}

export function createActionableExceptionLifecycleAccessRepository(
  client?: SupabaseClient | null,
): ActionableExceptionLifecycleAccessRepository {
  return {
    async readAccess() {
      const active = activeClient(client);
      if (!active) {
        return actionableExceptionLifecycleAccessFailure({
          code: 'NOT_CONFIGURED',
          message: 'Supabase is not configured.',
        });
      }

      const result = await active
        .schema('analytics')
        .rpc(actionableExceptionLifecycleAccessRpcName);
      if (result.error) return actionableExceptionLifecycleAccessFailure(result.error);

      const normalised = normaliseActionableExceptionLifecycleAccess(result.data);
      if (!normalised.access) {
        return actionableExceptionLifecycleAccessFailure({
          code: 'INVALID_ACCESS_RESULT',
          message: 'Lifecycle access envelope is invalid.',
        });
      }
      return { ok: true, data: normalised.access, issues: normalised.issues };
    },
  };
}

export const actionableExceptionLifecycleAccessRepository =
  createActionableExceptionLifecycleAccessRepository();
