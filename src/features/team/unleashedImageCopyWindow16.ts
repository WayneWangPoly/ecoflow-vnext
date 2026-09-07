import type { SupabaseClient } from '@supabase/supabase-js';

export const IMAGE_COPY_WINDOW_16 = {
  commandId: 'e83b3a7f-e660-4be6-96ba-b64b8a619ff2',
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
  if ((row.assetsPlanned as number) > IMAGE_COPY_WINDOW_16.limit) return false;
  if ((row.assetsCopied as number) + (row.assetsReused as number) + (row.assetsFailed as number) !== row.assetsPlanned) return false;
  return true;
}

export async function runAuthorizedImageCopyWindow16(
  supabase: SupabaseClient,
): Promise<AuthorizedImageCopyWindowResult> {
  const { data: predecessor, error: predecessorError } = await supabase
    .from('ecoflow_unleashed_asset_copy_runs')
    .select('id,status,assets_planned,assets_copied,assets_reused,assets_failed,bytes_copied,authorization_id')
    .eq('command_id', '39771ddf-19be-44ef-aa0f-ac99ff5001ff').single();
  if (predecessorError) throw predecessorError;
  if (!predecessor || predecessor.id !== 'a1e5afa1-13ef-4c16-b9bb-10ffb29b5289'
      || predecessor.status !== 'SUCCEEDED' || predecessor.assets_planned !== 10
      || predecessor.assets_copied !== 10 || predecessor.assets_reused !== 0
      || predecessor.assets_failed !== 0 || predecessor.bytes_copied !== 1523918
      || predecessor.authorization_id !== '9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c') {
    throw new Error('UNLEASHED_IMAGE_COPY_W15_PREDECESSOR_REJECTED');
  }
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'COPY_IMAGES',
      commandId: IMAGE_COPY_WINDOW_16.commandId,
      limit: IMAGE_COPY_WINDOW_16.limit,
      reason: '#338 authorized bounded COPY_IMAGES window 16 after verified W15 run a1e5afa1-13ef-4c16-b9bb-10ffb29b5289: 10 copied, 1523918 bytes; cumulative Storage 150 private objects / 42047946 bytes, valid provenance and zero claims; limit 10 and stop for production verification before continuation',
    },
  });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  if (!isBoundedWindowResult(data)) throw new Error('UNLEASHED_IMAGE_COPY_WINDOW_RESULT_REJECTED');
  return data;
}
