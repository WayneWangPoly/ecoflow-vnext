import type { SupabaseClient } from '@supabase/supabase-js';

export const R5_002_REQUEST = {
  requestKey: 'ECOFLOW-R5-002',
  mode: 'bounded_snapshot',
  resources: ['stock_on_hand'],
  reason: 'ECOFLOW-R5-002 production ADL1 warehouse-scoped StockOnHand acquisition',
  dryRun: false,
  pageSize: 200,
  maxPages: 5,
  target: { warehouseCode: 'ADL1' },
} as const;


export const R5_002_R2_REQUEST = {
  requestKey: 'ECOFLOW-R5-002-R2',
  mode: 'bounded_snapshot',
  resources: ['stock_on_hand'],
  reason: 'ECOFLOW-R5-002-R2 recovery after classification-read defect',
  dryRun: false,
  pageSize: 200,
  maxPages: 5,
  target: { warehouseCode: 'ADL1' },
} as const;

type AcquisitionPage = {
  resource: 'stock_on_hand';
  endpointPath: string;
  pageNumber: number;
  pageSize: 200;
  httpStatus: 200;
  responseSha256: string;
  recordsSeen: number;
  recordsStaged: number;
  recordsInserted: number;
  recordsChanged: number;
  recordsUnchanged: number;
  fetchAttempts: number;
};

type AcquisitionWindow = {
  resource: 'stock_on_hand';
  startPage: 1;
  lastPage: number;
  numberOfPages: number;
  windowComplete: true;
  nextPage: null;
};

export type R5002AcquisitionResult = {
  ok: true;
  runId: string;
  requestKey: 'ECOFLOW-R5-002' | 'ECOFLOW-R5-002-R2' | 'ECOFLOW-R5-008';
  requestedAt: string;
  status: 'SUCCEEDED';
  dryRun: false;
  resources: ['stock_on_hand'];
  pageSize: 200;
  maxPages: 5;
  startPage: 1;
  previousRunId: null;
  allResourcesComplete: true;
  target: { warehouseCode: 'ADL1' };
  recordsSeen: number;
  recordsStaged: number;
  recordsInserted: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsFailed: 0;
  failedResources: [];
  paginationWindows: [AcquisitionWindow];
  pages: AcquisitionPage[];
  errorCode: null;
  errorMessage: null;
};

type ConnectorError = { error?: string; details?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isAcquisitionPage(value: unknown, expectedPage: number): value is AcquisitionPage {
  if (!isRecord(value)) return false;
  return value.resource === 'stock_on_hand'
    && value.endpointPath === `/StockOnHand/${expectedPage}`
    && value.pageNumber === expectedPage
    && value.pageSize === 200
    && value.httpStatus === 200
    && typeof value.responseSha256 === 'string'
    && /^[0-9a-f]{64}$/.test(value.responseSha256)
    && isNonNegativeInteger(value.recordsSeen)
    && isNonNegativeInteger(value.recordsStaged)
    && isNonNegativeInteger(value.recordsInserted)
    && isNonNegativeInteger(value.recordsChanged)
    && isNonNegativeInteger(value.recordsUnchanged)
    && Number.isInteger(value.fetchAttempts)
    && Number(value.fetchAttempts) >= 1
    && Number(value.fetchAttempts) <= 3
    && value.recordsStaged === Number(value.recordsInserted) + Number(value.recordsChanged);
}

function assertAcquisitionResult(
  value: unknown,
  expectedRequestKey: 'ECOFLOW-R5-002' | 'ECOFLOW-R5-002-R2' | 'ECOFLOW-R5-008' = R5_002_REQUEST.requestKey,
): R5002AcquisitionResult {
  if (!isRecord(value)) throw new Error('R5_002_ACQUISITION_CONTRACT_VIOLATION');
  const target = value.target;
  const windows = value.paginationWindows;
  const pages = value.pages;
  if (!isRecord(target) || !Array.isArray(windows) || !Array.isArray(pages)) {
    throw new Error('R5_002_ACQUISITION_CONTRACT_VIOLATION');
  }
  const window = windows[0];
  const counts = [
    value.recordsSeen,
    value.recordsStaged,
    value.recordsInserted,
    value.recordsChanged,
    value.recordsUnchanged,
    value.recordsFailed,
  ];
  const fixedShape = value.ok === true
    && typeof value.runId === 'string'
    && typeof value.requestedAt === 'string'
    && value.requestKey === expectedRequestKey
    && value.status === 'SUCCEEDED'
    && value.dryRun === false
    && Array.isArray(value.resources)
    && value.resources.length === 1
    && value.resources[0] === 'stock_on_hand'
    && value.pageSize === 200
    && value.maxPages === 5
    && value.startPage === 1
    && value.previousRunId === null
    && value.allResourcesComplete === true
    && Object.keys(target).length === 1
    && target.warehouseCode === 'ADL1'
    && counts.every(isNonNegativeInteger)
    && value.recordsFailed === 0
    && Array.isArray(value.failedResources)
    && value.failedResources.length === 0
    && value.errorCode === null
    && value.errorMessage === null;
  const validWindow = windows.length === 1
    && isRecord(window)
    && window.resource === 'stock_on_hand'
    && window.startPage === 1
    && Number.isInteger(window.lastPage)
    && Number(window.lastPage) >= 1
    && Number(window.lastPage) <= 5
    && window.numberOfPages === window.lastPage
    && window.windowComplete === true
    && window.nextPage === null;
  const validPages = validWindow
    && pages.length === window.lastPage
    && pages.every((page, index) => isAcquisitionPage(page, index + 1));
  const pageCountsMatch = validPages
    && pages.reduce((sum, page) => sum + page.recordsSeen, 0) === value.recordsSeen
    && pages.reduce((sum, page) => sum + page.recordsStaged, 0) === value.recordsStaged
    && pages.reduce((sum, page) => sum + page.recordsInserted, 0) === value.recordsInserted
    && pages.reduce((sum, page) => sum + page.recordsChanged, 0) === value.recordsChanged
    && pages.reduce((sum, page) => sum + page.recordsUnchanged, 0) === value.recordsUnchanged
    && value.recordsStaged === Number(value.recordsInserted) + Number(value.recordsChanged);

  if (!fixedShape || !validWindow || !validPages || !pageCountsMatch) {
    throw new Error('R5_002_ACQUISITION_RESULT_REJECTED');
  }
  return value as R5002AcquisitionResult;
}

export async function runR5002Adl1StockOnHandAcquisition(
  supabase: SupabaseClient,
): Promise<R5002AcquisitionResult> {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-readonly-sync', {
    body: R5_002_REQUEST,
  });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  return assertAcquisitionResult(data);
}


export async function runR5002R2Adl1StockOnHandAcquisition(
  supabase: SupabaseClient,
): Promise<R5002AcquisitionResult> {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-readonly-sync', {
    body: R5_002_R2_REQUEST,
  });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  return assertAcquisitionResult(data, R5_002_R2_REQUEST.requestKey);
}

export async function runR5008Adl1StockOnHandAcquisition(
  supabase: SupabaseClient,
): Promise<R5002AcquisitionResult> {
  const { data, error } = await supabase.functions.invoke('trigger-unleashed-readonly-sync', {
    body: R5_008_REQUEST,
  });
  if (error) throw error;
  const connectorError = data as ConnectorError | null;
  if (connectorError?.error) {
    throw new Error(`${connectorError.error}${connectorError.details ? `: ${connectorError.details}` : ''}`);
  }
  return assertAcquisitionResult(data, R5_008_REQUEST.requestKey);
}
