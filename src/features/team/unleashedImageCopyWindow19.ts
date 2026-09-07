import type { SupabaseClient } from '@supabase/supabase-js';

export const IMAGE_COPY_WINDOW_19 = {
  commandId: '40c5fc75-6e7f-4681-85dd-bcf443a3e370',
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
  if ((row.assetsPlanned as number) > IMAGE_COPY_WINDOW_19.limit) return false;
  if ((row.assetsCopied as number) + (row.assetsReused as number) + (row.assetsFailed as number) !== row.assetsPlanned) return false;
  return true;
}

export async function runAuthorizedImageCopyWindow19(
  supabase: SupabaseClient,
): Promise<AuthorizedImageCopyWindowResult> {
  const { data: predecessor, error: predecessorError } = await supabase
    .from('ecoflow_unleashed_asset_copy_runs')
    .select('id,status,assets_planned,assets_copied,assets_reused,assets_failed,bytes_copied,authorization_id')
    .eq('command_id', '8a66ae1e-099b-4f1f-97ed-fc7e78b2fb7a').single();
  if (predecessorError) throw predecessorError;
  if (!predecessor || predecessor.id !== '6ef22524-1bd4-46d6-97b2-3ea6426842ac'
      || predecessor.status !== 'PARTIAL' || predecessor.assets_planned !== 10
      || predecessor.assets_copied !== 9 || predecessor.assets_reused !== 0
      || predecessor.assets_failed !== 1 || predecessor.bytes_copied !== 3538396
      || predecessor.authorization_id !== '9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c') {
    throw new Error('UNLEASHED_IMAGE_COPY_W18_PREDECESSOR_REJECTED');
  }

  const { data: terminalBlock, error: terminalBlockError } = await supabase
    .from('ecoflow_unleashed_product_assets')
    .select('id,asset_status,attempt_count,last_error_code,claimed_in_run_id,copied_in_run_id')
    .eq('id', '9a224708-61f5-497f-a86e-6ae6f2055025').single();
  if (terminalBlockError) throw terminalBlockError;
  if (!terminalBlock || terminalBlock.asset_status !== 'BLOCKED'
      || terminalBlock.attempt_count !== 1
      || terminalBlock.last_error_code !== 'UNLEASHED_IMAGE_OBJECT_TOO_LARGE'
      || terminalBlock.claimed_in_run_id !== null
      || terminalBlock.copied_in_run_id !== null) {
    throw new Error('UNLEASHED_IMAGE_COPY_W18_TERMINAL_BLOCK_REJECTED');
  }

  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'COPY_IMAGES',
      commandId: IMAGE_COPY_WINDOW_19.commandId,
      limit: IMAGE_COPY_WINDOW_19.limit,
      reason: '#338 authorized bounded COPY_IMAGES window 19 after W18 run 6ef22524-1bd4-46d6-97b2-3ea6426842ac adjudicated: PARTIAL 10/9/0/1, 3538396 bytes; failed asset 9a224708-61f5-497f-a86e-6ae6f2055025 terminal BLOCKED as UNLEASHED_IMAGE_OBJECT_TOO_LARGE under unchanged 2 MiB limit; cumulative Storage 179 private objects / 49262193 bytes, zero claims; limit 10 and stop for production verification',
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
