import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  intelligenceReleaseCommandFailure,
  intelligenceReleaseFlagCommandRpcName,
  intelligenceReleaseReadFailure,
  intelligenceReleaseReadRpcName,
  intelligenceReleaseVerificationCommandRpcName,
  normaliseIntelligenceReleaseRows,
  validateReleaseFlagCommand,
  validateReleaseVerificationCommand,
  type IntelligenceReleaseCommandResult,
  type IntelligenceReleaseFlagCommandInput,
  type IntelligenceReleaseFlagKey,
  type IntelligenceReleaseReadResult,
  type IntelligenceReleaseVerificationCommandInput,
  type IntelligenceRolloutState,
  type IntelligenceVerificationStatus,
} from '@/features/intelligence/analytics/releaseReadiness/releaseReadinessContract';

export type IntelligenceReleaseRepository = {
  readReadiness: (businessDate: string) => Promise<IntelligenceReleaseReadResult>;
  applyFlagCommand: (
    input: IntelligenceReleaseFlagCommandInput,
  ) => Promise<IntelligenceReleaseCommandResult>;
  recordVerification: (
    input: IntelligenceReleaseVerificationCommandInput,
  ) => Promise<IntelligenceReleaseCommandResult>;
};

function activeClient(client?: SupabaseClient | null): SupabaseClient | null {
  return client ?? supabase;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  return objectOf(value[0]);
}

function commandResult(row: Record<string, unknown> | null): IntelligenceReleaseCommandResult {
  const flagKey = typeof row?.flag_key === 'string' ? row.flag_key.toLowerCase() : null;
  const commandStatus = typeof row?.command_status === 'string'
    ? row.command_status.toUpperCase()
    : null;
  const rolloutState = typeof row?.rollout_state === 'string'
    ? row.rollout_state.toUpperCase()
    : null;
  const checkKey = typeof row?.check_key === 'string' ? row.check_key.toUpperCase() : null;
  const checkStatus = typeof row?.check_status === 'string' ? row.check_status.toUpperCase() : null;
  const version = Number(row?.version);
  const updatedAt = typeof row?.updated_at === 'string' && !Number.isNaN(Date.parse(row.updated_at))
    ? row.updated_at
    : null;

  if (!flagKey || !updatedAt || !Number.isSafeInteger(version) || version < 1
    || (commandStatus !== 'APPLIED' && commandStatus !== 'REPLAYED')) {
    return intelligenceReleaseCommandFailure({
      code: 'INVALID_COMMAND_RESULT',
      message: 'Release control command returned an invalid result.',
    });
  }

  return {
    ok: true,
    commandStatus,
    flagKey: flagKey as IntelligenceReleaseFlagKey,
    ...(rolloutState ? { rolloutState: rolloutState as IntelligenceRolloutState } : {}),
    ...(checkKey ? { checkKey: checkKey as IntelligenceReleaseVerificationCommandInput['checkKey'] } : {}),
    ...(checkStatus ? { checkStatus: checkStatus as IntelligenceVerificationStatus } : {}),
    version,
    updatedAt,
  };
}

export function createIntelligenceReleaseRepository(
  client?: SupabaseClient | null,
): IntelligenceReleaseRepository {
  return {
    async readReadiness(businessDate) {
      const active = activeClient(client);
      if (!active) {
        return intelligenceReleaseReadFailure({
          code: 'NOT_CONFIGURED',
          message: 'Supabase is not configured.',
        });
      }

      const result = await active.schema('analytics').rpc(intelligenceReleaseReadRpcName, {
        p_business_date: businessDate,
      });
      if (result.error) return intelligenceReleaseReadFailure(result.error);
      const normalised = normaliseIntelligenceReleaseRows(result.data);
      return {
        ok: true,
        state: normalised.state,
        data: normalised.flags,
        issues: normalised.issues,
      };
    },

    async applyFlagCommand(input) {
      const issues = validateReleaseFlagCommand(input);
      if (issues.length) {
        return intelligenceReleaseCommandFailure({
          code: 'INVALID_FLAG_COMMAND',
          message: issues.join(','),
        });
      }
      const active = activeClient(client);
      if (!active) {
        return intelligenceReleaseCommandFailure({
          code: 'NOT_CONFIGURED',
          message: 'Supabase is not configured.',
        });
      }

      const result = await active.schema('analytics').rpc(intelligenceReleaseFlagCommandRpcName, {
        p_command_id: input.commandId,
        p_flag_key: input.flagKey,
        p_business_date: input.businessDate,
        p_expected_version: input.expectedVersion,
        p_next_state: input.nextState,
        p_reason: input.reason,
      });
      if (result.error) return intelligenceReleaseCommandFailure(result.error);
      return commandResult(firstRow(result.data));
    },

    async recordVerification(input) {
      const issues = validateReleaseVerificationCommand(input);
      if (issues.length) {
        return intelligenceReleaseCommandFailure({
          code: 'INVALID_VERIFICATION_COMMAND',
          message: issues.join(','),
        });
      }
      const active = activeClient(client);
      if (!active) {
        return intelligenceReleaseCommandFailure({
          code: 'NOT_CONFIGURED',
          message: 'Supabase is not configured.',
        });
      }

      const result = await active.schema('analytics').rpc(intelligenceReleaseVerificationCommandRpcName, {
        p_command_id: input.commandId,
        p_flag_key: input.flagKey,
        p_business_date: input.businessDate,
        p_check_key: input.checkKey,
        p_check_status: input.status,
        p_observed_value: input.observedValue ?? null,
        p_expected_value: input.expectedValue ?? null,
        p_note: input.note ?? null,
        p_source_as_of: input.sourceAsOf ?? null,
      });
      if (result.error) return intelligenceReleaseCommandFailure(result.error);
      return commandResult(firstRow(result.data));
    },
  };
}

export const intelligenceReleaseRepository = createIntelligenceReleaseRepository();
