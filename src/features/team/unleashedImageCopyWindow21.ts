import type { SupabaseClient } from '@supabase/supabase-js';

export const IMAGE_COPY_WINDOW_21 = {
  commandId: 'a9fb6b96-28b1-4f77-b07c-941c7816409a',
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

const W20_TERMINAL_BLOCK_IDS = [
  '32792498-12af-4bd5-8ce5-15e5eeac6c2b',
  'a16ce48b-e71e-47f2-b1e6-7a127037dc30',
  'f41c87ea-0813-4b3c-9ac3-fba70f95bfd6',
] as const;

function isBoundedWindowResult(value: unknown): value is AuthorizedImageCopyWindowResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AuthorizedImageCopyWindowResult>;
  if (typeof row.runId !== 'string' || !row.runId) return false;
  if (!['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(String(row.status))) return false;
  for (const key of ['assetsPlanned', 'assetsCopied', 'assetsReused', 'assetsFailed', 'bytesCopied'] as const) {
    if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0) return false;
  }
  if ((row.assetsPlanned as number) > IMAGE_COPY_WINDOW_21.limit) return false;
  if ((row.assetsCopied as number) + (row.assetsReused as number) + (row.assetsFailed as number) !== row.assetsPlanned) return false;
  return true;
}

export async function runAuthorizedImageCopyWindow21(
  supabase: SupabaseClient,
): Promise<AuthorizedImageCopyWindowResult> {
  const { data: predecessor, error: predecessorError } = await supabase
    .from('ecoflow_unleashed_asset_copy_runs')
    .select('id,status,assets_planned,assets_copied,assets_reused,assets_failed,bytes_copied,authorization_id')
    .eq('command_id', 'cd35fb77-cae0-430b-a733-e224a270bbb2').single();
  if (predecessorError) throw predecessorError;
  if (!predecessor || predecessor.id !== '210f3abe-b825-47c0-91a8-db39571b8ed3'
      || predecessor.status !== 'PARTIAL' || predecessor.assets_planned !== 10
      || predecessor.assets_copied !== 7 || predecessor.assets_reused !== 0
      || predecessor.assets_failed !== 3 || predecessor.bytes_copied !== 1731521
      || predecessor.authorization_id !== '9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c') {
    throw new Error('UNLEASHED_IMAGE_COPY_W20_PREDECESSOR_REJECTED');
  }

  const { data: terminalBlocks, error: terminalBlockError } = await supabase
    .from('ecoflow_unleashed_product_assets')
    .select('id,asset_status,attempt_count,last_error_code,claimed_in_run_id,copied_in_run_id')
    .in('id', [...W20_TERMINAL_BLOCK_IDS])
    .order('id');
  if (terminalBlockError) throw terminalBlockError;
  if (!terminalBlocks || terminalBlocks.length !== W20_TERMINAL_BLOCK_IDS.length) {
    throw new Error('UNLEASHED_IMAGE_COPY_W20_TERMINAL_BLOCK_REJECTED');
  }
  const byId = new Map(terminalBlocks.map((row) => [row.id, row]));
  for (const id of W20_TERMINAL_BLOCK_IDS) {
    const row = byId.get(id);
    if (!row || row.asset_status !== 'BLOCKED' || row.attempt_count !== 1
        || row.last_error_code !== 'UNLEASHED_IMAGE_MIME_CONTENT_MISMATCH'
        || row.claimed_in_run_id !== null || row.copied_in_run_id !== null) {
      throw new Error('UNLEASHED_IMAGE_COPY_W20_TERMINAL_BLOCK_REJECTED');
    }
  }

  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', {
    body: {
      mode: 'COPY_IMAGES',
      commandId: IMAGE_COPY_WINDOW_21.commandId,
      limit: IMAGE_COPY_WINDOW_21.limit,
      reason: '#338 authorized bounded COPY_IMAGES window 21 after W20 run 210f3abe-b825-47c0-91a8-db39571b8ed3 adjudicated: PARTIAL 10/7/0/3, 1731521 bytes; three deterministic UNLEASHED_IMAGE_MIME_CONTENT_MISMATCH assets terminal BLOCKED; cumulative Storage 196 private objects / 53196844 bytes, 31 BLOCKED and zero claims; limit 10 and stop for production verification',
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
