import type { SupabaseClient } from '@supabase/supabase-js';

export const IMAGE_COPY_WINDOW_34 = {
  commandId: '73817562-0aab-439d-a45d-88d53979d360',
  limit: 10,
} as const;

export type AuthorizedImageCopyWindowResult = {
  runId: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  assetsPlanned: number;
  assetsCopied: number;
  assetsReused: number;
  assetsFailed: number;
  bytesCopied: number;
  errorCode: string | null;
  replayed: boolean;
};

type ConnectorError = { error?: string; details?: string };

function isBoundedWindowResult(value: unknown): value is AuthorizedImageCopyWindowResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AuthorizedImageCopyWindowResult>;
  if (typeof row.runId !== 'string' || !row.runId) return false;
  if (!['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(String(row.status))) return false;
  for (const key of ['assetsPlanned', 'assetsCopied', 'assetsReused', 'assetsFailed', 'bytesCopied'] as const) {
    if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0) return false;
  }
  if ((row.assetsPlanned as number) > IMAGE_COPY_WINDOW_34.limit) return false;
  if ((row.assetsCopied as number) + (row.assetsReused as number) + (row.assetsFailed as number) !== row.assetsPlanned) return false;
  return true;
}

export async function runAuthorizedImageCopyWindow34(
  supabase: SupabaseClient,
): Promise<AuthorizedImageCopyWindowResult> {
  const [{ data: predecessor, error: predecessorError }, { data: rights, error: rightsError }] = await Promise.all([
    supabase.from('ecoflow_unleashed_asset_copy_runs')
      .select('id,status,assets_planned,assets_copied,assets_reused,assets_failed,bytes_copied,authorization_id')
      .eq('command_id', '2a4b5e7e-662e-4d76-a682-3dfc70ccd2e2').single(),
    supabase.from('ecoflow_unleashed_asset_authorizations')
      .select('id,authorization_status,is_current,revision,storage_budget_bytes,max_object_bytes,expires_at')
      .eq('is_current', true).single(),
  ]);
  if (predecessorError) throw predecessorError;
  if (rightsError) throw rightsError;
  if (!predecessor || predecessor.id !== 'c9d04dbd-53eb-435d-8006-3f49834d0d86'
      || predecessor.status !== 'SUCCEEDED' || predecessor.assets_planned !== 10
      || predecessor.assets_copied !== 10 || predecessor.assets_reused !== 0
      || predecessor.assets_failed !== 0 || predecessor.bytes_copied !== 2557686
      || predecessor.authorization_id !== '15612d15-f97e-462e-a24f-49889b4668c2') {
    throw new Error('UNLEASHED_IMAGE_COPY_W33_PREDECESSOR_REJECTED');
  }
  if (!rights || rights.id !== '15612d15-f97e-462e-a24f-49889b4668c2'
      || rights.authorization_status !== 'APPROVED' || rights.is_current !== true
      || rights.revision !== 2 || rights.storage_budget_bytes !== 134217728
      || rights.max_object_bytes !== 2097152 || rights.expires_at !== null) {
    throw new Error('UNLEASHED_IMAGE_COPY_W34_AUTHORIZATION_REJECTED');
  }
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'COPY_IMAGES',
      commandId: IMAGE_COPY_WINDOW_34.commandId,
      limit: IMAGE_COPY_WINDOW_34.limit,
      reason: '#338 authorized bounded COPY_IMAGES window 34 after verified W33 run c9d04dbd-53eb-435d-8006-3f49834d0d86: 10 copied, 2557686 bytes; cumulative Storage 320 private objects / 82966711 bytes, 115 PLANNED, 32 terminal BLOCKED and zero claims; revision 2 128 MiB aggregate budget, 2 MiB/object, max 10 and stop for production verification before continuation',
    },
  });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  if (!isBoundedWindowResult(data)) throw new Error('UNLEASHED_IMAGE_COPY_WINDOW_RESULT_REJECTED');
  return data;
}
