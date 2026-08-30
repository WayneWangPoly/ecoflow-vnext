import type { SupabaseClient } from '@supabase/supabase-js';

export type UnleashedProbePage = {
  resource: 'warehouses';
  endpointPath: string;
  pageNumber: number;
  pageSize: number;
  httpStatus: number;
  responseSha256: string;
  recordsSeen: number;
  recordsStaged: number;
  highWatermark: string | null;
  pagination: Record<string, unknown>;
};

export type UnleashedProbeResult = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: true;
  resources: ['warehouses'];
  pageSize: 1;
  maxPages: 1;
  recordsSeen: number;
  recordsStaged: 0;
  recordsFailed: number;
  pages: UnleashedProbePage[];
  errorCode: string | null;
  errorMessage: string | null;
};

type ProbeError = {
  error?: string;
  details?: string;
};

function isProbeResult(value: unknown): value is UnleashedProbeResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<UnleashedProbeResult>;
  return result.dryRun === true
    && result.pageSize === 1
    && result.maxPages === 1
    && result.recordsStaged === 0
    && Array.isArray(result.resources)
    && result.resources.length === 1
    && result.resources[0] === 'warehouses'
    && Array.isArray(result.pages)
    && result.pages.every((page) => page.resource === 'warehouses' && page.pageSize === 1 && page.recordsStaged === 0);
}

export async function runUnleashedReadonlyProbe(supabase: SupabaseClient): Promise<UnleashedProbeResult> {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-readonly-sync', {
    body: {
      mode: 'probe',
      resources: ['warehouses'],
      dryRun: true,
      pageSize: 1,
      maxPages: 1,
      reason: `Admin connection test from EcoFlow Settings at ${new Date().toISOString()}`,
    },
  });

  if (error) throw error;
  const probeError = data as ProbeError | null;
  if (probeError?.error) {
    throw new Error(`${probeError.error}${probeError.details ? `: ${probeError.details}` : ''}`);
  }
  if (!isProbeResult(data)) throw new Error('UNLEASHED_PROBE_CONTRACT_VIOLATION');
  return data;
}
