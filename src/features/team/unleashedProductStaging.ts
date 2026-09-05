import type { SupabaseClient } from '@supabase/supabase-js';
import { PRODUCT_STAGING_PLAN } from './unleashedProductStagingPlan';

const RESOURCE = 'products' as const;
const PAGE_SIZE = 200 as const;
const TOTAL_ITEMS = 466;
const TOTAL_PAGES = 3;
const P1 = PRODUCT_STAGING_PLAN.expectedSequence[0];
const P1_SHA = PRODUCT_STAGING_PLAN.freshSourceEvidence.pages[0].responseSha256;

type ConnectorError = { error?: string; details?: string };

type ProductPage = {
  resource: typeof RESOURCE;
  endpointPath: string;
  pageNumber: number;
  pageSize: number;
  httpStatus: number;
  responseSha256: string;
  recordsSeen: number;
  recordsStaged: number;
  recordsInserted: number;
  recordsChanged: number;
  recordsUnchanged: number;
  fetchAttempts: number;
  highWatermark: string | null;
  pagination: Record<string, unknown>;
};

type ProductWindow = {
  resource: typeof RESOURCE;
  startPage: number;
  lastPage: number | null;
  numberOfPages: number | null;
  windowComplete: boolean;
  nextPage: number | null;
  highWatermark: string | null;
};

export type ProductP1Result = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: false;
  resources: [typeof RESOURCE];
  pageSize: typeof PAGE_SIZE;
  maxPages: 1;
  startPage: 1;
  previousRunId: null;
  allResourcesComplete: false;
  paginationWindows: ProductWindow[];
  recordsSeen: number;
  recordsStaged: number;
  recordsInserted: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsFailed: number;
  failedResources: string[];
  pages: ProductPage[];
  errorCode: string | null;
  errorMessage: string | null;
};

function paginationNumber(page: ProductPage | undefined, key: 'NumberOfItems' | 'NumberOfPages') {
  const value = page?.pagination?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function withinOverlapBudget(inserted: number, changed: number, unchanged: number, expectedRows: number) {
  const overlap = changed + unchanged;
  return overlap >= 0
    && overlap <= PRODUCT_STAGING_PLAN.overlapBudget.remaining
    && inserted + changed + unchanged === expectedRows;
}

function isExactP1(value: unknown): value is ProductP1Result {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<ProductP1Result>;
  if (
    result.ok !== true
    || result.status !== 'SUCCEEDED'
    || result.dryRun !== false
    || !Array.isArray(result.resources)
    || result.resources.length !== 1
    || result.resources[0] !== RESOURCE
    || result.pageSize !== PAGE_SIZE
    || result.maxPages !== 1
    || result.startPage !== P1.startPage
    || result.previousRunId !== null
    || result.allResourcesComplete !== false
    || result.recordsSeen !== P1.expectedRowsSeen
    || result.recordsFailed !== 0
    || !Array.isArray(result.failedResources)
    || result.failedResources.length !== 0
    || !Array.isArray(result.pages)
    || result.pages.length !== 1
    || !Array.isArray(result.paginationWindows)
    || result.paginationWindows.length !== 1
    || typeof result.recordsInserted !== 'number'
    || typeof result.recordsChanged !== 'number'
    || typeof result.recordsUnchanged !== 'number'
    || typeof result.recordsStaged !== 'number'
    || !withinOverlapBudget(result.recordsInserted, result.recordsChanged, result.recordsUnchanged, P1.expectedRowsSeen)
    || result.recordsStaged !== result.recordsInserted + result.recordsChanged
  ) return false;

  const page = result.pages[0];
  if (
    !page
    || page.resource !== RESOURCE
    || page.pageNumber !== P1.startPage
    || page.pageSize !== PAGE_SIZE
    || page.httpStatus !== 200
    || page.responseSha256 !== P1_SHA
    || page.recordsSeen !== P1.expectedRowsSeen
    || typeof page.recordsInserted !== 'number'
    || typeof page.recordsChanged !== 'number'
    || typeof page.recordsUnchanged !== 'number'
    || !withinOverlapBudget(page.recordsInserted, page.recordsChanged, page.recordsUnchanged, P1.expectedRowsSeen)
    || page.recordsStaged !== page.recordsInserted + page.recordsChanged
    || paginationNumber(page, 'NumberOfItems') !== TOTAL_ITEMS
    || paginationNumber(page, 'NumberOfPages') !== TOTAL_PAGES
  ) return false;

  const window = result.paginationWindows[0];
  return window.resource === RESOURCE
    && window.startPage === P1.startPage
    && window.lastPage === P1.startPage
    && window.numberOfPages === TOTAL_PAGES
    && window.windowComplete === P1.expectedWindowComplete
    && window.nextPage === P1.expectedNextPage
    && typeof window.highWatermark === 'string'
    && window.highWatermark.length > 0;
}

async function invoke(supabase: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-readonly-sync', { body });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  return data;
}

export async function runAuthorizedProductP1(supabase: SupabaseClient): Promise<ProductP1Result> {
  if (!PRODUCT_STAGING_PLAN.authorization.granted || PRODUCT_STAGING_PLAN.authorization.currentExposedWindow !== 'P1') {
    throw new Error('UNLEASHED_PRODUCT_P1_NOT_AUTHORIZED');
  }

  const result = await invoke(supabase, {
    mode: PRODUCT_STAGING_PLAN.mode,
    resources: [RESOURCE],
    dryRun: false,
    pageSize: PAGE_SIZE,
    maxPages: 1,
    startPage: P1.startPage,
    reason: `#338 authorized product P1 only; one-overlap budget=${PRODUCT_STAGING_PLAN.overlapBudget.remaining}; fresh dry evidence ${PRODUCT_STAGING_PLAN.freshSourceEvidence.dryRunId}; ${new Date().toISOString()}`,
  });

  if (!isExactP1(result)) {
    throw new Error('UNLEASHED_PRODUCT_P1_RESULT_REJECTED');
  }
  return result;
}
