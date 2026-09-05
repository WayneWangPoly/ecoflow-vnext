import type { SupabaseClient } from '@supabase/supabase-js';
import { CUSTOMER_STAGING_PLAN } from './unleashedCustomerStagingPlan';

const RESOURCE = 'customers' as const;
const PAGE_SIZE = 200 as const;
const TOTAL_ITEMS = 623;
const TOTAL_PAGES = 4;
const C4 = CUSTOMER_STAGING_PLAN.expectedSequence[3];
const C4_SHA = CUSTOMER_STAGING_PLAN.freshSourceEvidence.pages[3].responseSha256;
const C4_PREVIOUS_RUN_ID = CUSTOMER_STAGING_PLAN.c3Verification.continuationAnchorRunId;

type ConnectorError = { error?: string; details?: string };

type CustomerPage = {
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

type CustomerWindow = {
  resource: typeof RESOURCE;
  startPage: number;
  lastPage: number | null;
  numberOfPages: number | null;
  windowComplete: boolean;
  nextPage: number | null;
  highWatermark: string | null;
};

export type CustomerC4Result = {
  ok: boolean;
  runId: string;
  requestedAt: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  dryRun: false;
  resources: [typeof RESOURCE];
  pageSize: typeof PAGE_SIZE;
  maxPages: 1;
  startPage: 4;
  previousRunId: string;
  allResourcesComplete: true;
  paginationWindows: CustomerWindow[];
  recordsSeen: number;
  recordsStaged: number;
  recordsInserted: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsFailed: number;
  failedResources: string[];
  pages: CustomerPage[];
  errorCode: string | null;
  errorMessage: string | null;
};

function paginationNumber(page: CustomerPage | undefined, key: 'NumberOfItems' | 'NumberOfPages') {
  const value = page?.pagination?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function isExactC4(value: unknown): value is CustomerC4Result {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<CustomerC4Result>;
  if (
    result.ok !== true
    || result.status !== 'SUCCEEDED'
    || result.dryRun !== false
    || !Array.isArray(result.resources)
    || result.resources.length !== 1
    || result.resources[0] !== RESOURCE
    || result.pageSize !== PAGE_SIZE
    || result.maxPages !== 1
    || result.startPage !== C4.startPage
    || result.previousRunId !== C4_PREVIOUS_RUN_ID
    || result.allResourcesComplete !== true
    || result.recordsSeen !== C4.expectedRows
    || result.recordsStaged !== C4.expectedRows
    || result.recordsInserted !== C4.expectedRows
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
    || page.pageNumber !== C4.startPage
    || page.pageSize !== PAGE_SIZE
    || page.httpStatus !== 200
    || page.responseSha256 !== C4_SHA
    || page.recordsSeen !== C4.expectedRows
    || page.recordsStaged !== C4.expectedRows
    || page.recordsInserted !== C4.expectedRows
    || page.recordsChanged !== 0
    || page.recordsUnchanged !== 0
    || paginationNumber(page, 'NumberOfItems') !== TOTAL_ITEMS
    || paginationNumber(page, 'NumberOfPages') !== TOTAL_PAGES
  ) return false;

  const window = result.paginationWindows[0];
  return window.resource === RESOURCE
    && window.startPage === C4.startPage
    && window.lastPage === C4.startPage
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

export async function runAuthorizedCustomerC4(supabase: SupabaseClient): Promise<CustomerC4Result> {
  if (!CUSTOMER_STAGING_PLAN.authorization.granted || CUSTOMER_STAGING_PLAN.authorization.currentExposedWindow !== 'C4') {
    throw new Error('UNLEASHED_CUSTOMER_C4_NOT_AUTHORIZED');
  }

  const result = await invoke(supabase, {
    mode: CUSTOMER_STAGING_PLAN.mode,
    resources: [RESOURCE],
    dryRun: false,
    pageSize: PAGE_SIZE,
    maxPages: 1,
    startPage: C4.startPage,
    previousRunId: C4_PREVIOUS_RUN_ID,
    reason: `#338 authorized customer C4 final window only; continuation anchor ${C4_PREVIOUS_RUN_ID}; fresh dry evidence ${CUSTOMER_STAGING_PLAN.freshSourceEvidence.dryRunId}; ${new Date().toISOString()}`,
  });

  if (!isExactC4(result)) {
    throw new Error('UNLEASHED_CUSTOMER_C4_RESULT_REJECTED');
  }
  return result;
}
