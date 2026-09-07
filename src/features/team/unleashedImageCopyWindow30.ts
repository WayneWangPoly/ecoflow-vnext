import type { SupabaseClient } from '@supabase/supabase-js';

export const IMAGE_COPY_WINDOW_30 = {
  commandId: '702f771d-d57a-4270-8831-c4757ed8a181',
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
  if ((row.assetsPlanned as number) > IMAGE_COPY_WINDOW_30.limit) return false;
  if ((row.assetsCopied as number) + (row.assetsReused as number) + (row.assetsFailed as number) !== row.assetsPlanned) return false;
  return true;
}

export async function runAuthorizedImageCopyWindow30(
  supabase: SupabaseClient,
): Promise<AuthorizedImageCopyWindowResult> {
  const [{ data: predecessor, error: predecessorError }, { data: rights, error: rightsError }] = await Promise.all([
    supabase.from('ecoflow_unleashed_asset_copy_runs')
      .select('id,status,assets_planned,assets_copied,assets_reused,assets_failed,bytes_copied,authorization_id')
      .eq('command_id', '4d731c72-ba5b-4292-8407-ae0f641a0391').single(),
    supabase.from('ecoflow_unleashed_asset_authorizations')
      .select('id,authorization_status,is_current,revision,storage_budget_bytes,max_object_bytes,expires_at')
      .eq('is_current', true).single(),
  ]);
  if (predecessorError) throw predecessorError;
  if (rightsError) throw rightsError;
  if (!predecessor || predecessor.id !== '2d8151ec-7e4a-4831-9377-802e905542cb'
      || predecessor.status !== 'PARTIAL' || predecessor.assets_planned !== 10
      || predecessor.assets_copied !== 5 || predecessor.assets_reused !== 0
      || predecessor.assets_failed !== 5 || predecessor.bytes_copied !== 1318029
      || predecessor.authorization_id !== '9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c') {
    throw new Error('UNLEASHED_IMAGE_COPY_W29_PREDECESSOR_REJECTED');
  }
  if (!rights || rights.id !== '15612d15-f97e-462e-a24f-49889b4668c2'
      || rights.authorization_status !== 'APPROVED' || rights.is_current !== true
      || rights.revision !== 2 || rights.storage_budget_bytes !== 134217728
      || rights.max_object_bytes !== 2097152 || rights.expires_at !== null) {
    throw new Error('UNLEASHED_IMAGE_COPY_W30_AUTHORIZATION_REJECTED');
  }

  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'COPY_IMAGES',
      commandId: IMAGE_COPY_WINDOW_30.commandId,
      limit: IMAGE_COPY_WINDOW_30.limit,
      reason: '#338 authorized bounded COPY_IMAGES window 30 after adjudicated W29 partial run 2d8151ec-7e4a-4831-9377-802e905542cb and explicit revision 2 aggregate budget 128 MiB; retry the five budget-exceeded FAILED assets plus bounded continuation, max 10, preserve 2 MiB/object and unchanged rights scope, stop for production verification before continuation',
    },
  });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  if (!isBoundedWindowResult(data)) throw new Error('UNLEASHED_IMAGE_COPY_WINDOW_RESULT_REJECTED');
  return data;
}
