import type { SupabaseClient } from '@supabase/supabase-js';
import { PRODUCT_STAGING_PLAN } from './unleashedProductStagingPlan';

const RESOURCE = 'products' as const;
const PAGE_SIZE = 200 as const;
const TOTAL_ITEMS = 466;
const TOTAL_PAGES = 3;
const P3 = PRODUCT_STAGING_PLAN.expectedSequence[2];
const P3_SHA = PRODUCT_STAGING_PLAN.freshSourceEvidence.pages[2].responseSha256;
const P2_RUN_ID = PRODUCT_STAGING_PLAN.verifiedWindows.P2.runId;

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

export type ProductP3Result = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: false;
  resources: [typeof RESOURCE];
  pageSize: typeof PAGE_SIZE;
  maxPages: 1;
  startPage: 3;
  previousRunId: string;
  allResourcesComplete: true;
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

function isExactP3(value: unknown): value is ProductP3Result {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<ProductP3Result>;
  if (
    result.ok !== true
    || result.status !== 'SUCCEEDED'
    || result.dryRun !== false
    || !Array.isArray(result.resources)
    || result.resources.length !== 1
    || result.resources[0] !== RESOURCE
    || result.pageSize !== PAGE_SIZE
    || result.maxPages !== 1
    || result.startPage !== P3.startPage
    || result.previousRunId !== P2_RUN_ID
    || result.allResourcesComplete !== true
    || result.recordsSeen !== P3.expectedRowsSeen
    || result.recordsStaged !== P3.expectedRowsSeen
    || result.recordsInserted !== P3.expectedRowsSeen
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
    || page.pageNumber !== P3.startPage
    || page.pageSize !== PAGE_SIZE
    || page.httpStatus !== 200
    || page.responseSha256 !== P3_SHA
    || page.recordsSeen !== P3.expectedRowsSeen
    || page.recordsStaged !== P3.expectedRowsSeen
    || page.recordsInserted !== P3.expectedRowsSeen
    || page.recordsChanged !== 0
    || page.recordsUnchanged !== 0
    || paginationNumber(page, 'NumberOfItems') !== TOTAL_ITEMS
    || paginationNumber(page, 'NumberOfPages') !== TOTAL_PAGES
  ) return false;

  const window = result.paginationWindows[0];
  return window.resource === RESOURCE
    && window.startPage === P3.startPage
    && window.lastPage === P3.startPage
    && window.numberOfPages === TOTAL_PAGES
    && window.windowComplete === true
    && window.nextPage === null
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

export async function runAuthorizedProductP3(supabase: SupabaseClient): Promise<ProductP3Result> {
  if (!PRODUCT_STAGING_PLAN.authorization.granted || PRODUCT_STAGING_PLAN.authorization.currentExposedWindow !== 'P3') {
    throw new Error('UNLEASHED_PRODUCT_P3_NOT_AUTHORIZED');
  }
  if (PRODUCT_STAGING_PLAN.overlapBudget.remaining !== 0) {
    throw new Error('UNLEASHED_PRODUCT_P3_OVERLAP_BUDGET_NOT_EXHAUSTED');
  }

  const result = await invoke(supabase, {
    mode: PRODUCT_STAGING_PLAN.mode,
    resources: [RESOURCE],
    dryRun: false,
    pageSize: PAGE_SIZE,
    maxPages: 1,
    startPage: P3.startPage,
    previousRunId: P2_RUN_ID,
    reason: `#338 authorized final product P3 only; P1 consumed historical overlap and P2 verified pure insert; fresh dry evidence ${PRODUCT_STAGING_PLAN.freshSourceEvidence.dryRunId}; ${new Date().toISOString()}`,
  });

  if (!isExactP3(result)) {
    throw new Error('UNLEASHED_PRODUCT_P3_RESULT_REJECTED');
  }
  return result;
}
