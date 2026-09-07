import type { SupabaseClient } from '@supabase/supabase-js';

export const IMAGE_COPY_WINDOW_27 = {
  commandId: '3fe47bbc-3c5d-4898-a58b-9fb3ec5ea76b',
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

const W26_TERMINAL_BLOCK_IDS = ['5a121d99-eefb-4287-b16d-4ae78f40ca9e'] as const;

function isBoundedWindowResult(value: unknown): value is AuthorizedImageCopyWindowResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AuthorizedImageCopyWindowResult>;
  if (typeof row.runId !== 'string' || !row.runId) return false;
  if (!['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(String(row.status))) return false;
  for (const key of ['assetsPlanned', 'assetsCopied', 'assetsReused', 'assetsFailed', 'bytesCopied'] as const) {
    if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0) return false;
  }
  if ((row.assetsPlanned as number) > IMAGE_COPY_WINDOW_27.limit) return false;
  if ((row.assetsCopied as number) + (row.assetsReused as number) + (row.assetsFailed as number) !== row.assetsPlanned) return false;
  return true;
}

export async function runAuthorizedImageCopyWindow27(
  supabase: SupabaseClient,
): Promise<AuthorizedImageCopyWindowResult> {
  const { data: predecessor, error: predecessorError } = await supabase
    .from('ecoflow_unleashed_asset_copy_runs')
    .select('id,status,assets_planned,assets_copied,assets_reused,assets_failed,bytes_copied,authorization_id')
    .eq('command_id', 'f3b54e4f-d8ce-493b-a486-709b10e66f33').single();
  if (predecessorError) throw predecessorError;
  if (!predecessor || predecessor.id !== '3cfff46f-b65c-41e9-bf2b-e98f2e380e98'
      || predecessor.status !== 'PARTIAL' || predecessor.assets_planned !== 10
      || predecessor.assets_copied !== 9 || predecessor.assets_reused !== 0
      || predecessor.assets_failed !== 1 || predecessor.bytes_copied !== 2880905
      || predecessor.authorization_id !== '9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c') {
    throw new Error('UNLEASHED_IMAGE_COPY_W26_PREDECESSOR_REJECTED');
  }

  const { data: terminalBlocks, error: terminalBlockError } = await supabase
    .from('ecoflow_unleashed_product_assets')
    .select('id,asset_status,attempt_count,last_error_code,claimed_in_run_id,copied_in_run_id')
    .in('id', [...W26_TERMINAL_BLOCK_IDS])
    .order('id');
  if (terminalBlockError) throw terminalBlockError;
  if (!terminalBlocks || terminalBlocks.length !== W26_TERMINAL_BLOCK_IDS.length) {
    throw new Error('UNLEASHED_IMAGE_COPY_W26_TERMINAL_BLOCK_REJECTED');
  }
  const row = terminalBlocks[0];
  if (!row || row.id !== W26_TERMINAL_BLOCK_IDS[0] || row.asset_status !== 'BLOCKED'
      || row.attempt_count !== 1 || row.last_error_code !== 'UNLEASHED_IMAGE_MIME_CONTENT_MISMATCH'
      || row.claimed_in_run_id !== null || row.copied_in_run_id !== null) {
    throw new Error('UNLEASHED_IMAGE_COPY_W26_TERMINAL_BLOCK_REJECTED');
  }

  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'COPY_IMAGES',
      commandId: IMAGE_COPY_WINDOW_27.commandId,
      limit: IMAGE_COPY_WINDOW_27.limit,
      reason: '#338 authorized bounded COPY_IMAGES window 27 after W26 run 3cfff46f-b65c-41e9-bf2b-e98f2e380e98 adjudicated: PARTIAL 10/9/0/1, 2880905 bytes; deterministic UNLEASHED_IMAGE_MIME_CONTENT_MISMATCH asset terminal BLOCKED; cumulative Storage 255 private objects / 61786819 bytes, 32 BLOCKED and zero claims; limit 10 and stop for production verification',
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
