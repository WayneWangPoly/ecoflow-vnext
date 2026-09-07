import type { SupabaseClient } from '@supabase/supabase-js';

export const IMAGE_COPY_WINDOW_25 = {
  commandId: '488d4bb7-b1d0-4079-9b20-5f5c5ea9d064',
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
  if ((row.assetsPlanned as number) > IMAGE_COPY_WINDOW_25.limit) return false;
  if ((row.assetsCopied as number) + (row.assetsReused as number) + (row.assetsFailed as number) !== row.assetsPlanned) return false;
  return true;
}

export async function runAuthorizedImageCopyWindow25(
  supabase: SupabaseClient,
): Promise<AuthorizedImageCopyWindowResult> {
  const { data: predecessor, error: predecessorError } = await supabase
    .from('ecoflow_unleashed_asset_copy_runs')
    .select('id,status,assets_planned,assets_copied,assets_reused,assets_failed,bytes_copied,authorization_id')
    .eq('command_id', '10c70593-802d-42b9-91a6-21f93cb923a3').single();
  if (predecessorError) throw predecessorError;
  if (!predecessor || predecessor.id !== '097d3b0e-5593-4fa3-9d95-ebe549860830'
      || predecessor.status !== 'SUCCEEDED' || predecessor.assets_planned !== 10
      || predecessor.assets_copied !== 10 || predecessor.assets_reused !== 0
      || predecessor.assets_failed !== 0 || predecessor.bytes_copied !== 847062
      || predecessor.authorization_id !== '9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c') {
    throw new Error('UNLEASHED_IMAGE_COPY_W24_PREDECESSOR_REJECTED');
  }

  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'COPY_IMAGES',
      commandId: IMAGE_COPY_WINDOW_25.commandId,
      limit: IMAGE_COPY_WINDOW_25.limit,
      reason: '#338 authorized bounded COPY_IMAGES window 25 after verified W24 run 097d3b0e-5593-4fa3-9d95-ebe549860830: 10 copied, 847062 bytes; cumulative Storage 236 private objects / 58116194 bytes, 31 terminal BLOCKED assets and zero claims; limit 10 and stop for production verification before continuation',
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
