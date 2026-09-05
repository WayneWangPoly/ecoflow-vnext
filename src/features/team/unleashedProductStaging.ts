import type { SupabaseClient } from '@supabase/supabase-js';
import { PRODUCT_STAGING_PLAN } from './unleashedProductStagingPlan';

const RESOURCE = 'products' as const;
const PAGE_SIZE = 200 as const;
const TOTAL_ITEMS = 466;
const TOTAL_PAGES = 3;
const P2 = PRODUCT_STAGING_PLAN.expectedSequence[1];
const P2_SHA = PRODUCT_STAGING_PLAN.freshSourceEvidence.pages[1].responseSha256;
const P1_RUN_ID = PRODUCT_STAGING_PLAN.verifiedWindows.P1.runId;

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

export type ProductP2Result = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: false;
  resources: [typeof RESOURCE];
  pageSize: typeof PAGE_SIZE;
  maxPages: 1;
  startPage: 2;
  previousRunId: string;
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

function isExactP2(value: unknown): value is ProductP2Result {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<ProductP2Result>;
  if (
    result.ok !== true
    || result.status !== 'SUCCEEDED'
    || result.dryRun !== false
    || !Array.isArray(result.resources)
    || result.resources.length !== 1
    || result.resources[0] !== RESOURCE
    || result.pageSize !== PAGE_SIZE
    || result.maxPages !== 1
    || result.startPage !== P2.startPage
    || result.previousRunId !== P1_RUN_ID
    || result.allResourcesComplete !== false
    || result.recordsSeen !== P2.expectedRowsSeen
    || result.recordsStaged !== P2.expectedRowsSeen
    || result.recordsInserted !== P2.expectedRowsSeen
    || result.recordsChanged !== 0
    || result.recordsUnchanged !== 0
    || result.recordsFailed !== 0
    || !Array.isArray(result.failedResources)
    || result.failedResources.length !== 0
    || !Array.isArray(result.pages)
    || result.pages.length !== 1
    || !Array.isArray(result.paginationWindows)
    || result.paginationWindows.length !== 1
  ) return false;

  const page = result.pages[0];
  if (
    !page
    || page.resource !== RESOURCE
    || page.pageNumber !== P2.startPage
    || page.pageSize !== PAGE_SIZE
    || page.httpStatus !== 200
    || page.responseSha256 !== P2_SHA
    || page.recordsSeen !== P2.expectedRowsSeen
    || page.recordsStaged !== P2.expectedRowsSeen
    || page.recordsInserted !== P2.expectedRowsSeen
    || page.recordsChanged !== 0
    || page.recordsUnchanged !== 0
    || paginationNumber(page, 'NumberOfItems') !== TOTAL_ITEMS
    || paginationNumber(page, 'NumberOfPages') !== TOTAL_PAGES
  ) return false;

  const window = result.paginationWindows[0];
  return window.resource === RESOURCE
    && window.startPage === P2.startPage
    && window.lastPage === P2.startPage
    && window.numberOfPages === TOTAL_PAGES
    && window.windowComplete === P2.expectedWindowComplete
    && window.nextPage === P2.expectedNextPage
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

export async function runAuthorizedProductP2(supabase: SupabaseClient): Promise<ProductP2Result> {
  if (!PRODUCT_STAGING_PLAN.authorization.granted || PRODUCT_STAGING_PLAN.authorization.currentExposedWindow !== 'P2') {
    throw new Error('UNLEASHED_PRODUCT_P2_NOT_AUTHORIZED');
  }
  if (PRODUCT_STAGING_PLAN.overlapBudget.remaining !== 0) {
    throw new Error('UNLEASHED_PRODUCT_P2_OVERLAP_BUDGET_NOT_EXHAUSTED');
  }

  const result = await invoke(supabase, {
    mode: PRODUCT_STAGING_PLAN.mode,
    resources: [RESOURCE],
    dryRun: false,
    pageSize: PAGE_SIZE,
    maxPages: 1,
    startPage: P2.startPage,
    previousRunId: P1_RUN_ID,
    reason: `#338 authorized product P2 only; historical overlap already consumed in P1; fresh dry evidence ${PRODUCT_STAGING_PLAN.freshSourceEvidence.dryRunId}; ${new Date().toISOString()}`,
  });

  if (!isExactP2(result)) {
    throw new Error('UNLEASHED_PRODUCT_P2_RESULT_REJECTED');
  }
  return result;
}
