import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import {
  intelligenceSavedViewCommandRpcName,
  intelligenceSavedViewReadRpcName,
  normaliseSavedViewRows,
  type SavedViewCommandInput,
  type SavedViewCommandResult,
  type SavedViewReadResult,
  type SavedViewWorkspace,
} from '@/features/intelligence/analytics/productivity/productivityContract';

export type SavedViewRepository = {
  readSavedViews: (workspace?: SavedViewWorkspace | null) => Promise<SavedViewReadResult>;
  applyCommand: (input: SavedViewCommandInput) => Promise<SavedViewCommandResult>;
};

function activeClient(client?: SupabaseClient | null): SupabaseClient | null {
  return client ?? supabase;
}

function classifyError(error: { code?: string | null; message?: string | null }): {
  state: 'forbidden' | 'invalid' | 'conflict' | 'unavailable' | 'failed';
  code: string;
  message: string;
} {
  const code = error.code ?? 'UNKNOWN';
  const message = error.message ?? 'Saved View operation failed.';
  if (code === '42501') return { state: 'forbidden', code, message };
  if (code === '22023' || code === '23514') return { state: 'invalid', code, message };
  if (code === '23505' || message.includes('CONFLICT')) return { state: 'conflict', code, message };
  if (code === 'PGRST202' || code === 'PGRST301' || message.includes('schema cache')) {
    return { state: 'unavailable', code, message };
  }
  return { state: 'failed', code, message };
}

export function createSavedViewRepository(client?: SupabaseClient | null): SavedViewRepository {
  return {
    async readSavedViews(workspace = null) {
      const active = activeClient(client);
      if (!active) {
        return { ok: false, state: 'unavailable', data: null, error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      const result = await active.schema('analytics').rpc(intelligenceSavedViewReadRpcName, {
        p_workspace: workspace,
      });
      if (result.error) {
        const failure = classifyError(result.error);
        return { ok: false, state: failure.state === 'conflict' ? 'failed' : failure.state, data: null, error: { code: failure.code, message: failure.message } };
      }
      const normalised = normaliseSavedViewRows(result.data);
      return { ok: true, state: normalised.state, data: normalised.rows, issues: normalised.issues };
    },

    async applyCommand(input) {
      const active = activeClient(client);
      if (!active) {
        return { ok: false, state: 'unavailable', error: { code: 'NOT_CONFIGURED', message: 'Supabase is not configured.' } };
      }
      const result = await active.schema('analytics').rpc(intelligenceSavedViewCommandRpcName, {
        p_action: input.action,
        p_saved_view_id: input.savedViewId ?? null,
        p_workspace: input.workspace ?? null,
        p_name: input.name ?? null,
        p_view_state: input.state ?? null,
        p_role_scope: input.roleScope ?? null,
      });
      if (result.error) {
        const failure = classifyError(result.error);
        return { ok: false, state: failure.state, error: { code: failure.code, message: failure.message } };
      }
      const row = Array.isArray(result.data) ? result.data[0] : null;
      const updatedAt = typeof row?.updated_at === 'string' && !Number.isNaN(Date.parse(row.updated_at))
        ? row.updated_at
        : null;
      const commandStatus = row?.command_status;
      const version = row?.version === null || row?.version === undefined ? null : Number(row.version);
      const savedViewId = typeof row?.saved_view_id === 'string' ? row.saved_view_id : null;
      if (commandStatus !== 'APPLIED' || !updatedAt || (version !== null && (!Number.isSafeInteger(version) || version < 1))) {
        return { ok: false, state: 'failed', error: { code: 'INVALID_COMMAND_RESULT', message: 'Saved View command returned an invalid result.' } };
      }
      return { ok: true, commandStatus, savedViewId, version, updatedAt };
    },
  };
}

export const savedViewRepository = createSavedViewRepository();
