import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  actionableExceptionLifecycleCommandFailure,
  actionableExceptionLifecycleCommandRpcName,
  actionableExceptionLifecycleReadFailure,
  actionableExceptionLifecycleReadRpcName,
  actionableExceptionLifecycleReadSuccess,
  normaliseActionableExceptionLifecycleCommand,
  normaliseActionableExceptionLifecycleCommandResult,
  normaliseActionableExceptionLifecycleReadRequest,
  normaliseActionableExceptionLifecycleRows,
  type ActionableExceptionLifecycleCommandInput,
  type ActionableExceptionLifecycleCommandResult,
  type ActionableExceptionLifecycleReadResult,
  type ActionableExceptionLifecycleRecord,
} from '@/features/intelligence/attention/actionableExceptionLifecycleContract';

export type ActionableExceptionLifecycleRepository = {
  readLifecycle: (
    exceptionIds: unknown,
    limit?: unknown,
  ) => Promise<ActionableExceptionLifecycleReadResult<readonly ActionableExceptionLifecycleRecord[]>>;
  applyCommand: (
    input: ActionableExceptionLifecycleCommandInput,
    nowAt?: string,
  ) => Promise<ActionableExceptionLifecycleCommandResult>;
};

function activeClient(client?: SupabaseClient | null): SupabaseClient | null {
  return client ?? supabase;
}

function unavailableRead() {
  return actionableExceptionLifecycleReadFailure({
    code: 'NOT_CONFIGURED',
    message: 'Supabase is not configured.',
  });
}

function unavailableCommand() {
  return actionableExceptionLifecycleCommandFailure({
    code: 'NOT_CONFIGURED',
    message: 'Supabase is not configured.',
  });
}

export function createActionableExceptionLifecycleRepository(
  client?: SupabaseClient | null,
): ActionableExceptionLifecycleRepository {
  return {
    async readLifecycle(exceptionIds, limit) {
      const request = normaliseActionableExceptionLifecycleReadRequest(exceptionIds, limit);
      if (!request.ok) {
        return actionableExceptionLifecycleReadFailure({
          code: request.issue.code,
          message: `${request.issue.field ?? 'request'}: ${request.issue.value ?? 'invalid'}`,
        });
      }
      if (request.request.exceptionIds.length === 0) {
        return actionableExceptionLifecycleReadSuccess([], 'empty', request.issues);
      }

      const active = activeClient(client);
      if (!active) return unavailableRead();

      const result = await active
        .schema('analytics')
        .rpc(actionableExceptionLifecycleReadRpcName, {
          p_exception_ids: request.request.exceptionIds,
          p_limit: request.request.limit,
        });
      if (result.error) return actionableExceptionLifecycleReadFailure(result.error);

      const normalised = normaliseActionableExceptionLifecycleRows(result.data);
      return actionableExceptionLifecycleReadSuccess(
        normalised.rows,
        normalised.state,
        [...request.issues, ...normalised.issues],
      );
    },

    async applyCommand(input, nowAt = new Date().toISOString()) {
      const request = normaliseActionableExceptionLifecycleCommand(input, nowAt);
      if (!request.ok) {
        return actionableExceptionLifecycleCommandFailure({
          code: request.issue.code,
          message: `${request.issue.field ?? 'command'}: ${request.issue.value ?? 'invalid'}`,
        });
      }

      const active = activeClient(client);
      if (!active) return unavailableCommand();

      const command = request.command;
      const result = await active
        .schema('analytics')
        .rpc(actionableExceptionLifecycleCommandRpcName, {
          p_command_id: command.commandId,
          p_exception_id: command.exceptionId,
          p_action: command.action,
          p_owner_team: command.ownerTeam,
          p_snoozed_until: command.snoozedUntil,
          p_resolution_note: command.resolutionNote,
          p_note: command.note,
        });
      if (result.error) return actionableExceptionLifecycleCommandFailure(result.error);

      const normalised = normaliseActionableExceptionLifecycleCommandResult(result.data);
      if (!normalised.record) {
        return actionableExceptionLifecycleCommandFailure({
          code: 'INVALID_COMMAND_RESULT',
          message: 'Lifecycle command returned an invalid result.',
        });
      }
      return { ok: true, data: normalised.record, issues: normalised.issues };
    },
  };
}

export const actionableExceptionLifecycleRepository = createActionableExceptionLifecycleRepository();
