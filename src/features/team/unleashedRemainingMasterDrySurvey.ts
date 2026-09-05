import type { SupabaseClient } from '@supabase/supabase-js';

const RESOURCES = ['customers', 'products'] as const;
const PAGE_SIZE = 200 as const;
const MAX_PAGES = 4 as const;

type ResourceName = (typeof RESOURCES)[number];

type DrySurveyPage = {
  resource: ResourceName;
  pageNumber: number;
  pageSize: number;
  httpStatus: number;
  responseSha256: string;
  recordsSeen: number;
  recordsStaged: number;
  pagination: Record<string, unknown>;
};

type DrySurveyWindow = {
  resource: ResourceName;
  startPage: number;
  lastPage: number | null;
  numberOfPages: number | null;
  windowComplete: boolean;
  nextPage: number | null;
};

export type RemainingMasterDrySurveyResult = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: boolean;
  resources: ResourceName[];
  pageSize: number;
  maxPages: number;
  allResourcesComplete: boolean;
  recordsSeen: number;
  recordsStaged: number;
  recordsFailed: number;
  failedResources: string[];
  paginationWindows: DrySurveyWindow[];
  pages: DrySurveyPage[];
};

type ConnectorError = { error?: string; details?: string };

function isExactDrySurvey(value: unknown): value is RemainingMasterDrySurveyResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<RemainingMasterDrySurveyResult>;
  if (
    result.ok !== true
    || result.status !== 'SUCCEEDED'
    || result.dryRun !== true
    || result.pageSize !== PAGE_SIZE
    || result.maxPages !== MAX_PAGES
    || result.recordsStaged !== 0
    || result.recordsFailed !== 0
    || result.allResourcesComplete !== true
    || !Array.isArray(result.resources)
    || result.resources.length !== RESOURCES.length
    || !RESOURCES.every((resource, index) => result.resources?.[index] === resource)
    || !Array.isArray(result.failedResources)
    || result.failedResources.length !== 0
    || !Array.isArray(result.paginationWindows)
    || result.paginationWindows.length !== RESOURCES.length
    || !Array.isArray(result.pages)
  ) return false;

  for (const resource of RESOURCES) {
    const window = result.paginationWindows.find((entry) => entry.resource === resource);
    if (!window || window.startPage !== 1 || window.windowComplete !== true || window.nextPage !== null) return false;
    if (window.numberOfPages === null || window.numberOfPages < 1 || window.numberOfPages > MAX_PAGES) return false;

    const pages = result.pages.filter((page) => page.resource === resource);
    if (pages.length !== window.numberOfPages) return false;
    for (const page of pages) {
      if (page.httpStatus !== 200 || page.pageSize !== PAGE_SIZE || page.recordsStaged !== 0 || !page.responseSha256) return false;
    }
  }
  return true;
}

export function itemCountForResource(result: RemainingMasterDrySurveyResult, resource: ResourceName) {
  const firstPage = result.pages.find((page) => page.resource === resource && page.pageNumber === 1);
  const value = firstPage?.pagination?.NumberOfItems;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

export async function runRemainingMasterDrySurvey(
  supabase: SupabaseClient,
): Promise<RemainingMasterDrySurveyResult> {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-readonly-sync', {
    body: {
      mode: 'bounded_snapshot',
      resources: [...RESOURCES],
      dryRun: true,
      pageSize: PAGE_SIZE,
      maxPages: MAX_PAGES,
      reason: `#338 remaining master GET-only dry sizing survey customers+products; ${new Date().toISOString()}`,
    },
  });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  if (!isExactDrySurvey(data)) throw new Error('UNLEASHED_REMAINING_MASTER_DRY_SURVEY_REJECTED');
  return data;
}
