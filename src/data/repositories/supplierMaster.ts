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
 * unleashed_* snapshots are not an operational supplier master.
 */
export type SupplierMasterReader = {
  readList(request?: SupplierMasterListRequest): Promise<SupplierMasterListResult>;
};
