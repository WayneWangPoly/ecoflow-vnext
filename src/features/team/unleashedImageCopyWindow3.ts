import type { SupabaseClient } from '@supabase/supabase-js';

export const IMAGE_COPY_WINDOW_3 = {
  commandId: 'e5002bc3-fb8f-48ef-881e-0cfb46b54159',
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
  if ((row.assetsPlanned as number) > IMAGE_COPY_WINDOW_3.limit) return false;
  if ((row.assetsCopied as number) + (row.assetsReused as number) + (row.assetsFailed as number) !== row.assetsPlanned) return false;
  return true;
}

export async function runAuthorizedImageCopyWindow3(
  supabase: SupabaseClient,
): Promise<AuthorizedImageCopyWindowResult> {
  const { data: predecessor, error: predecessorError } = await supabase
    .from('ecoflow_unleashed_asset_copy_runs')
    .select('id,status,assets_planned,assets_copied,assets_reused,assets_failed,bytes_copied,authorization_id')
    .eq('command_id', 'd921e548-2d44-4716-a478-985518f1be21').single();
  if (predecessorError) throw predecessorError;
  if (!predecessor || predecessor.id !== '6309ef23-fc1c-4c3e-9b25-db32707dbd34'
      || predecessor.status !== 'SUCCEEDED' || predecessor.assets_planned !== 10
      || predecessor.assets_copied !== 10 || predecessor.assets_reused !== 0
      || predecessor.assets_failed !== 0 || predecessor.bytes_copied !== 7289531
      || predecessor.authorization_id !== '9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c') {
    throw new Error('UNLEASHED_IMAGE_COPY_W2_PREDECESSOR_REJECTED');
  }
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'COPY_IMAGES',
      commandId: IMAGE_COPY_WINDOW_3.commandId,
      limit: IMAGE_COPY_WINDOW_3.limit,
      reason: '#338 authorized bounded COPY_IMAGES window 3 after verified W2 run 6309ef23-fc1c-4c3e-9b25-db32707dbd34: 10 copied, 7289531 bytes; cumulative Storage 20 private objects / 8249663 bytes, valid provenance and zero claims; limit 10 and stop for production verification before continuation',
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
