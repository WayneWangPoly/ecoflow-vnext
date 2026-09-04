export type NativeReadSurfaceState =
  | 'LOADING'
  | 'READY'
  | 'EMPTY'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'PERMISSION_DENIED';

export type NativeReadFreshness = 'CURRENT' | 'STALE' | 'UNKNOWN';

export type NativeReadAuthority =
  | 'ORDERMENTUM_COMMERCIAL'
  | 'WAYNX_CANONICAL'
  | 'WAYNX_PURCHASE_ORDER'
  | 'WAYNX_LOCATION_LEDGER'
  | 'UNLEASHED_MAPPING_REFERENCE'
  | 'UNLEASHED_WAREHOUSE_REFERENCE'
  | 'NONE';

export type NativeReadMetadata = {
  source: string;
  authority: NativeReadAuthority;
  isAuthoritative: boolean;
  freshness: NativeReadFreshness;
  readAt: string;
  sourceObservedAt?: string | null;
};

export type NativeReadResult<Row> = {
  state: Exclude<NativeReadSurfaceState, 'LOADING'>;
  rows: Row[];
  metadata: NativeReadMetadata;
  issues: string[];
};

export type NativeReadListRequest = {
  search?: string;
  filters?: readonly string[];
  sort?: string;
  cursor?: string;
  page?: number;
  pageSize?: number;
};
