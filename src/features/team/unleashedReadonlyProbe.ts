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

export const UNLEASHED_DRY_RUN_CENSUS_RESOURCES = [
  'products',
  'customers',
  'customer_delivery_addresses',
  'suppliers',
] as const;

export type UnleashedDryRunCensusResource = typeof UNLEASHED_DRY_RUN_CENSUS_RESOURCES[number];

export type UnleashedDryRunCensusResult = Omit<UnleashedProbeResult, 'resources' | 'pages'> & {
  resources: [UnleashedDryRunCensusResource];
  pages: Array<Omit<UnleashedProbePage, 'resource'> & { resource: UnleashedDryRunCensusResource }>;
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

function isDryRunCensusResult(
  value: unknown,
  resource: UnleashedDryRunCensusResource,
): value is UnleashedDryRunCensusResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<UnleashedDryRunCensusResult>;
  return result.ok === true
    && result.status === 'SUCCEEDED'
    && result.dryRun === true
    && result.pageSize === 1
    && result.maxPages === 1
    && result.recordsStaged === 0
    && result.recordsFailed === 0
    && Array.isArray(result.resources)
    && result.resources.length === 1
    && result.resources[0] === resource
    && Array.isArray(result.pages)
    && result.pages.length === 1
    && result.pages.every((page) => page.resource === resource && page.pageSize === 1 && page.recordsStaged === 0);
}

export async function runRemainingUnleashedDryRunCensus(
  supabase: SupabaseClient,
): Promise<UnleashedDryRunCensusResult[]> {
  const results: UnleashedDryRunCensusResult[] = [];
  for (const resource of UNLEASHED_DRY_RUN_CENSUS_RESOURCES) {
    const { data, error } = await supabase.functions.invoke('trigger-unleashed-readonly-sync', {
      body: {
        mode: 'bounded_snapshot',
        resources: [resource],
        dryRun: true,
        pageSize: 1,
        maxPages: 1,
        reason: `#338 Work Batch 1A GET-only dry-run census: ${resource}; ${new Date().toISOString()}`,
      },
    });
    if (error) throw error;
    const probeError = data as ProbeError | null;
    if (probeError?.error) {
      throw new Error(`${probeError.error}${probeError.details ? `: ${probeError.details}` : ''}`);
    }
    if (!isDryRunCensusResult(data, resource)) {
      throw new Error(`UNLEASHED_DRY_RUN_CENSUS_REJECTED:${resource}`);
    }
    results.push(data);
  }
  return results;
}
