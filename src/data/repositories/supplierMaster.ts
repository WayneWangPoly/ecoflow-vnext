import type { SupabaseClient } from '@supabase/supabase-js';
import type { NativeReadListRequest, NativeReadResult } from './nativeReadModel';

export const SUPPLIER_MASTER_FILTER_ORDER = [
  'supplier',
  'obsolete',
] as const;

export const SUPPLIER_MASTER_COLUMN_ORDER = [
  'code',
  'name',
  'city',
  'country',
  'currency',
  'action',
] as const;

export type SupplierMasterMappingStatus = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'RETIRED' | 'UNAVAILABLE';

export type SupplierMasterRow = {
  supplierId: string | null;
  code: string;
  name: string;
  city: string | null;
  country: string | null;
  currency: string | null;
  isObsolete: boolean | null;
  sourceExternalKey: string | null;
  mappingStatus: SupplierMasterMappingStatus;
  sourceObservedAt: string | null;
};

export type SupplierMasterListRequest = NativeReadListRequest;
export type SupplierMasterListResult = NativeReadResult<SupplierMasterRow>;

/**
 * #340A deliberately defines Supplier Master independently from purchase-order
 * strings. Until a governed canonical supplier directory exists, a reader must
 * expose UNAVAILABLE/DEGRADED state or governed mapping-reference evidence. Raw
 * Unleashed staging snapshots are not an operational supplier master.
 */
export type SupplierMasterReader = {
  readList(request?: SupplierMasterListRequest): Promise<SupplierMasterListResult>;
  readDetail(supplierId: string): Promise<SupplierMasterListResult>;
};

type SupplierMappingReferenceRow = {
  id: string;
  source_external_code: string | null;
  source_external_key: string;
  source_observed_at: string | null;
  canonical_code: string | null;
  mapping_status: string;
};

function clean(value: string | null | undefined) {
  return String(value || '').trim();
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' · ') || 'Supplier reference read failed.';
  }
  return String(error || 'Supplier reference read failed.');
}

function isPermissionError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const row = error as Record<string, unknown>;
  const code = String(row.code || '').toUpperCase();
  const text = message(error).toLowerCase();
  return code === '42501' || text.includes('permission denied') || text.includes('not authorized') || text.includes('not authorised');
}

function mapReference(row: SupplierMappingReferenceRow): SupplierMasterRow {
  const status = ['MATCHED', 'AMBIGUOUS', 'UNMATCHED', 'RETIRED'].includes(row.mapping_status)
    ? row.mapping_status as SupplierMasterMappingStatus
    : 'UNAVAILABLE';
  return {
    // The mapping-row id is used only as route identity. A matched canonical id
    // is not promoted into a Supplier master without a governed directory read.
    supplierId: row.id,
    code: clean(row.canonical_code) || clean(row.source_external_code) || clean(row.source_external_key),
    name: '',
    city: null,
    country: null,
    currency: null,
    isObsolete: status === 'RETIRED' ? true : null,
    sourceExternalKey: clean(row.source_external_key) || null,
    mappingStatus: status,
    sourceObservedAt: row.source_observed_at,
  };
}

function latestObservedAt(rows: SupplierMasterRow[]) {
  return rows
    .map((row) => row.sourceObservedAt)
    .filter((value): value is string => Boolean(value) && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function applyRequest(rows: SupplierMasterRow[], request: SupplierMasterListRequest) {
  const search = clean(request.search).toLowerCase();
  const filters = new Map<string, string[]>();
  for (const raw of request.filters ?? []) {
    const separator = raw.indexOf(':');
    if (separator <= 0) continue;
    const key = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1).trim();
    if (key && value) filters.set(key, [...(filters.get(key) ?? []), value]);
  }

  let next = rows.filter((row) => {
    if (search && ![row.code, row.name].some((value) => clean(value).toLowerCase().includes(search))) return false;
    const supplierFilters = filters.get('supplier');
    if (supplierFilters?.length && !supplierFilters.some((value) => clean(row.code).toLowerCase().includes(clean(value).toLowerCase()))) return false;
    const obsoleteFilters = filters.get('obsolete');
    if (obsoleteFilters?.length && !obsoleteFilters.some((value) => {
      const normalized = clean(value).toLowerCase();
      return normalized === 'all' || (row.isObsolete === null ? normalized === 'unknown' : normalized === String(row.isObsolete));
    })) return false;
    return true;
  });

  if (request.sort === 'code-desc') next = [...next].sort((a, b) => b.code.localeCompare(a.code, 'en-AU', { numeric: true }));
  else next = [...next].sort((a, b) => a.code.localeCompare(b.code, 'en-AU', { numeric: true }));
  return next.slice(0, Math.min(100, Math.max(1, request.pageSize ?? 50)));
}

function unavailableResult(state: 'UNAVAILABLE' | 'PERMISSION_DENIED', issue: string): SupplierMasterListResult {
  return {
    state,
    rows: [],
    metadata: {
      source: 'governed Unleashed supplier mapping reference',
      authority: 'UNLEASHED_MAPPING_REFERENCE',
      isAuthoritative: false,
      freshness: 'UNKNOWN',
      readAt: new Date().toISOString(),
      sourceObservedAt: null,
    },
    issues: [issue],
  };
}

function degradedResult(rows: SupplierMasterRow[]): SupplierMasterListResult {
  return {
    state: 'DEGRADED',
    rows,
    metadata: {
      source: 'ecoflow_unleashed_master_mappings · SUPPLIER references',
      authority: 'UNLEASHED_MAPPING_REFERENCE',
      isAuthoritative: false,
      freshness: latestObservedAt(rows) ? 'CURRENT' : 'UNKNOWN',
      readAt: new Date().toISOString(),
      sourceObservedAt: latestObservedAt(rows),
    },
    issues: [
      'Supplier mapping references are migration evidence, not a canonical Supplier directory.',
      'Name, address, city, country and currency remain unavailable until a governed Supplier master read model exists.',
      'This surface never reads raw Unleashed staging snapshots and exposes no Supplier mutation.',
    ],
  };
}

export function createSupplierMasterReader(client: SupabaseClient): SupplierMasterReader {
  return {
    async readList(request = {}) {
      const { data, error } = await client
        .from('ecoflow_unleashed_master_mappings')
        .select('id,source_external_code,source_external_key,source_observed_at,canonical_code,mapping_status')
        .eq('entity_type', 'SUPPLIER')
        .order('source_external_code', { ascending: true, nullsFirst: false })
        .limit(500);

      if (error) return unavailableResult(isPermissionError(error) ? 'PERMISSION_DENIED' : 'UNAVAILABLE', message(error));
      const sourceRows = ((data ?? []) as SupplierMappingReferenceRow[]).map(mapReference);
      if (!sourceRows.length) {
        return unavailableResult(
          'UNAVAILABLE',
          'No governed Supplier mapping references are available. EcoFlow will not substitute purchase-order strings or raw Unleashed evidence for a canonical Supplier master.',
        );
      }
      return degradedResult(applyRequest(sourceRows, request));
    },

    async readDetail(supplierId: string) {
      const id = clean(supplierId);
      if (!id) return unavailableResult('UNAVAILABLE', 'Supplier reference id is required.');
      const { data, error } = await client
        .from('ecoflow_unleashed_master_mappings')
        .select('id,source_external_code,source_external_key,source_observed_at,canonical_code,mapping_status')
        .eq('entity_type', 'SUPPLIER')
        .eq('id', id)
        .maybeSingle();
      if (error) return unavailableResult(isPermissionError(error) ? 'PERMISSION_DENIED' : 'UNAVAILABLE', message(error));
      if (!data) return unavailableResult('UNAVAILABLE', 'The requested governed Supplier reference does not exist or is not visible to this role.');
      return degradedResult([mapReference(data as SupplierMappingReferenceRow)]);
    },
  };
}
