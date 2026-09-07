import type { SupabaseClient } from '@supabase/supabase-js';

export const IMAGE_COPY_WINDOW_44 = { commandId: 'ff6153da-5726-4df6-a961-fbbfd5796643', limit: 10 } as const;
export type AuthorizedImageCopyWindowResult = { runId: string; status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'; assetsPlanned: number; assetsCopied: number; assetsReused: number; assetsFailed: number; bytesCopied: number; errorCode: string | null; replayed: boolean; };
type ConnectorError = { error?: string; details?: string };
function isBoundedWindowResult(value: unknown): value is AuthorizedImageCopyWindowResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AuthorizedImageCopyWindowResult>;
  if (typeof row.runId !== 'string' || !row.runId) return false;
  if (!['SUCCEEDED','PARTIAL','FAILED'].includes(String(row.status))) return false;
  for (const key of ['assetsPlanned','assetsCopied','assetsReused','assetsFailed','bytesCopied'] as const) if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0) return false;
  if ((row.assetsPlanned as number) > IMAGE_COPY_WINDOW_44.limit) return false;
  if ((row.assetsCopied as number) + (row.assetsReused as number) + (row.assetsFailed as number) !== row.assetsPlanned) return false;
  return true;
}
export async function runAuthorizedImageCopyWindow44(supabase: SupabaseClient): Promise<AuthorizedImageCopyWindowResult> {
  const [{ data: predecessor, error: predecessorError }, { data: rights, error: rightsError }] = await Promise.all([
    supabase.from('ecoflow_unleashed_asset_copy_runs').select('id,status,assets_planned,assets_copied,assets_reused,assets_failed,bytes_copied,authorization_id').eq('command_id','e3483b9e-ae17-46bd-bd63-781754568c5a').single(),
    supabase.from('ecoflow_unleashed_asset_authorizations').select('id,authorization_status,is_current,revision,storage_budget_bytes,max_object_bytes,expires_at').eq('is_current',true).single(),
  ]);
  if (predecessorError) throw predecessorError; if (rightsError) throw rightsError;
  if (!predecessor || predecessor.id !== '69425c64-1e68-4e5a-baa8-e0f850c430ad' || predecessor.status !== 'SUCCEEDED' || predecessor.assets_planned !== 10 || predecessor.assets_copied !== 9 || predecessor.assets_reused !== 1 || predecessor.assets_failed !== 0 || predecessor.bytes_copied !== 1462866 || predecessor.authorization_id !== '15612d15-f97e-462e-a24f-49889b4668c2') throw new Error('UNLEASHED_IMAGE_COPY_W43_PREDECESSOR_REJECTED');
  if (!rights || rights.id !== '15612d15-f97e-462e-a24f-49889b4668c2' || rights.authorization_status !== 'APPROVED' || rights.is_current !== true || rights.revision !== 2 || rights.storage_budget_bytes !== 134217728 || rights.max_object_bytes !== 2097152 || rights.expires_at !== null) throw new Error('UNLEASHED_IMAGE_COPY_W44_AUTHORIZATION_REJECTED');
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-master-migration', { body: { mode:'COPY_IMAGES', commandId:IMAGE_COPY_WINDOW_44.commandId, limit:IMAGE_COPY_WINDOW_44.limit, reason:'#338 authorized bounded COPY_IMAGES window 44 after verified W43 run 69425c64-1e68-4e5a-baa8-e0f850c430ad: 9 copied, 1 reused, 0 failed, 1462866 new bytes; cumulative Storage 419 private objects / 100570514 bytes, 420 COPIED, 15 PLANNED, 32 terminal BLOCKED and zero claims; revision 2 128 MiB aggregate budget, 2 MiB/object, max 10 and stop for production verification before continuation' } });
  if (error) throw error;
  const connectorError=data as ConnectorError | null; if (connectorError?.error) throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  if (!isBoundedWindowResult(data)) throw new Error('UNLEASHED_IMAGE_COPY_WINDOW_RESULT_REJECTED');
  return data;
}
