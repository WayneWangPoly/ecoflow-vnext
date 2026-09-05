import type { SupabaseClient } from '@supabase/supabase-js';

export const AUTHORIZED_MASTER_PLAN_EXPECTATION = {
  mappings: {
    planned: 1300,
    matched: 158,
    ambiguous: 0,
    unmatched: 1141,
    retired: 1,
  },
  assets: {
    discovered: 467,
    blocked: 27,
    missing: 27,
  },
} as const;

type MappingPlanResult = {
  planned: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  retired: number;
};

type AssetPlanResult = {
  discovered: number;
  blocked: number;
  missing: number;
};

export type AuthorizedMasterPlanResult = {
  mode: 'PLAN';
  mappings: MappingPlanResult;
  assets: AssetPlanResult;
};

type ConnectorError = { error?: string; details?: string };

function exactCounts(actual: Record<string, unknown> | undefined, expected: Record<string, number>) {
  if (!actual) return false;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function isExactAuthorizedMasterPlan(value: unknown): value is AuthorizedMasterPlanResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<AuthorizedMasterPlanResult>;
  return result.mode === 'PLAN'
    && exactCounts(result.mappings as unknown as Record<string, unknown>, AUTHORIZED_MASTER_PLAN_EXPECTATION.mappings)
    && exactCounts(result.assets as unknown as Record<string, unknown>, AUTHORIZED_MASTER_PLAN_EXPECTATION.assets);
}

export async function runAuthorizedMasterPlan(supabase: SupabaseClient): Promise<AuthorizedMasterPlanResult> {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'PLAN',
      reason: '#338 user-authorized governed downstream PLAN + asset locator plan after verified 184/184 addresses, 623/623 customers and 466/466 products raw staging closure',
    },
  });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  if (!isExactAuthorizedMasterPlan(data)) {
    throw new Error('UNLEASHED_MASTER_PLAN_RESULT_REJECTED');
  }
  return data;
}
