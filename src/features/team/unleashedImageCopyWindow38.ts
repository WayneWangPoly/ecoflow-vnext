import type { SupabaseClient } from '@supabase/supabase-js';

export const IMAGE_COPY_WINDOW_38 = { commandId: '1a4ae8ae-43c3-4b28-85bb-b939e88a8519', limit: 10 } as const;
export type AuthorizedImageCopyWindowResult = { runId: string; status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'; assetsPlanned: number; assetsCopied: number; assetsReused: number; assetsFailed: number; bytesCopied: number; errorCode: string | null; replayed: boolean; };
type ConnectorError = { error?: string; details?: string };
function isBoundedWindowResult(value: unknown): value is AuthorizedImageCopyWindowResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AuthorizedImageCopyWindowResult>;
  if (typeof row.runId !== 'string' || !row.runId) return false;
  if (!['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(String(row.status))) return false;
  for (const key of ['assetsPlanned', 'assetsCopied', 'assetsReused', 'assetsFailed', 'bytesCopied'] as const) if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0) return false;
  if ((row.assetsPlanned as number) > IMAGE_COPY_WINDOW_38.limit) return false;
  if ((row.assetsCopied as number) + (row.assetsReused as number) + (row.assetsFailed as number) !== row.assetsPlanned) return false;
  return true;
}
export async function runAuthorizedImageCopyWindow38(supabase: SupabaseClient): Promise<AuthorizedImageCopyWindowResult> {
  const [{ data: predecessor, error: predecessorError }, { data: rights, error: rightsError }] = await Promise.all([
    supabase.from('ecoflow_unleashed_asset_copy_runs').select('id,status,assets_planned,assets_copied,assets_reused,assets_failed,bytes_copied,authorization_id').eq('command_id', 'f6e21021-7249-4aff-80bd-0164e4fd9604').single(),
    supabase.from('ecoflow_unleashed_asset_authorizations').select('id,authorization_status,is_current,revision,storage_budget_bytes,max_object_bytes,expires_at').eq('is_current', true).single(),
  ]);
  if (predecessorError) throw predecessorError; if (rightsError) throw rightsError;
  if (!predecessor || predecessor.id !== '778cefff-eba6-4b49-8c59-95aebc2cb3ea' || predecessor.status !== 'SUCCEEDED' || predecessor.assets_planned !== 10 || predecessor.assets_copied !== 10 || predecessor.assets_reused !== 0 || predecessor.assets_failed !== 0 || predecessor.bytes_copied !== 1919184 || predecessor.authorization_id !== '15612d15-f97e-462e-a24f-49889b4668c2') throw new Error('UNLEASHED_IMAGE_COPY_W37_PREDECESSOR_REJECTED');
  if (!rights || rights.id !== '15612d15-f97e-462e-a24f-49889b4668c2' || rights.authorization_status !== 'APPROVED' || rights.is_current !== true || rights.revision !== 2 || rights.storage_budget_bytes !== 134217728 || rights.max_object_bytes !== 2097152 || rights.expires_at !== null) throw new Error('UNLEASHED_IMAGE_COPY_W38_AUTHORIZATION_REJECTED');
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', { body: { mode: 'COPY_IMAGES', commandId: IMAGE_COPY_WINDOW_38.commandId, limit: IMAGE_COPY_WINDOW_38.limit, reason: '#338 authorized bounded COPY_IMAGES window 38 after verified W37 run 778cefff-eba6-4b49-8c59-95aebc2cb3ea: 10 copied, 1919184 bytes; cumulative Storage 360 private objects / 90734750 bytes, 75 PLANNED, 32 terminal BLOCKED and zero claims; revision 2 128 MiB aggregate budget, 2 MiB/object, max 10 and stop for production verification before continuation' } });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  if (!isBoundedWindowResult(data)) throw new Error('UNLEASHED_IMAGE_COPY_WINDOW_RESULT_REJECTED');
  return data;
}
