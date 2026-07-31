import {
  matchIntelligenceRoute,
  type IntelligenceEntityKind,
  type IntelligenceWorkspaceId,
} from '@/features/intelligence/navigation/routeContract.ts';
import {
  withWorkspaceQuery,
  type WorkspaceQueryState,
} from '@/features/intelligence/navigation/queryState.ts';

export const inventoryIntelligenceSurfaceCapabilities = [
  'OVERVIEW',
  'FILTERS',
  'TREND',
  'BREAKDOWN',
  'COMMERCIAL_TABLE',
  'PHYSICAL_TABLE',
  'DETAIL_DRAWER',
  'TIMELINE',
  'FRESHNESS',
  'OPERATIONAL_HANDOFF',
] as const;
export type InventoryIntelligenceSurfaceCapability =
  (typeof inventoryIntelligenceSurfaceCapabilities)[number];

export const inventoryIntelligenceReadStates = [
  'READY',
  'PARTIAL',
  'EMPTY',
  'DEGRADED',
  'UNAVAILABLE',
  'FORBIDDEN',
  'FAILED',
] as const;
export type InventoryIntelligenceReadState =
  (typeof inventoryIntelligenceReadStates)[number];

export const inventoryIdentityStates = ['RESOLVED', 'AMBIGUOUS', 'UNRESOLVED'] as const;
export type InventoryIdentityState = (typeof inventoryIdentityStates)[number];

export const inventoryQuantityDomains = ['GLOBAL_BASE', 'LOCATION_PACKAGE'] as const;
export type InventoryQuantityDomain = (typeof inventoryQuantityDomains)[number];

export const inventoryCoverageStates = ['FULL', 'PARTIAL', 'NONE', 'UNKNOWN'] as const;
export type InventoryCoverageState = (typeof inventoryCoverageStates)[number];

export const inventoryRiskStates = ['NONE', 'WATCH', 'REORDER', 'STOCKOUT', 'UNKNOWN'] as const;
export type InventoryRiskState = (typeof inventoryRiskStates)[number];

export const inventoryTimelineEventTypes = [
  'RECEIVING',
  'PUTAWAY',
  'TRANSFER',
  'ALLOCATION',
  'PICK',
  'ADJUSTMENT',
  'RETURN',
  'SCRAP',
  'STOCKTAKE',
] as const;
export type InventoryTimelineEventType = (typeof inventoryTimelineEventTypes)[number];

export type InventoryIntelligenceStatus =
  | 'ready'
  | 'partial'
  | 'empty'
  | 'degraded'
  | 'blocked'
  | 'invalid';

export type InventoryIntelligenceIssueCode =
  | 'INVALID_INPUT'
  | 'UNKNOWN_READ_STATE'
  | 'INVALID_ENVELOPE_TIMESTAMP'
  | 'TIMESTAMP_ORDER_INVALID'
  | 'INVALID_COLLECTION'
  | 'INVALID_COMMERCIAL_SKU'
  | 'INVALID_PHYSICAL_SKU'
  | 'DUPLICATE_COMMERCIAL_SKU'
  | 'DUPLICATE_PHYSICAL_SKU'
  | 'INVALID_IDENTITY_STATE'
  | 'INVALID_QUANTITY_DOMAIN'
  | 'INVALID_COVERAGE_STATE'
  | 'INVALID_RISK_STATE'
  | 'INVALID_NUMBER'
  | 'COMMERCIAL_PHYSICAL_IDENTITY_COLLISION'
  | 'INVALID_TIMELINE_EVENT'
  | 'DUPLICATE_TIMELINE_EVENT'
  | 'UNKNOWN_TIMELINE_EVENT_TYPE'
  | 'ROW_TIMESTAMP_INVALID'
  | 'NON_DATA_STATE_SUPPRESSED'
  | 'ROUTE_UNAVAILABLE';

export type InventoryIntelligenceIssue = {
  code: InventoryIntelligenceIssueCode;
  collection?: 'commercialSkus' | 'physicalSkus' | 'timeline';
  row?: number;
  field?: string;
  value?: string;
  entityKey?: string;
};

export type InventoryCommercialSkuInput = {
  commercialSkuId: unknown;
  label: unknown;
  identityState: unknown;
  coverageState: unknown;
  approvedPhysicalSkuCount: unknown;
  availablePhysicalSkuCount: unknown;
  affectedOrderCount: unknown;
  daysOfCover: unknown;
  reorderRisk: unknown;
  asOfAt: unknown;
};

export type InventoryPhysicalSkuInput = {
  physicalSkuId: unknown;
  label: unknown;
  identityState: unknown;
  commercialSkuId?: unknown;
  commercialSkuLabel?: unknown;
  supplier?: unknown;
  brand?: unknown;
  locationId?: unknown;
  locationLabel?: unknown;
  quantityDomain: unknown;
  unitLevel: unknown;
  onHand: unknown;
  available: unknown;
  reserved: unknown;
  daysOfCover: unknown;
  reorderRisk: unknown;
  asOfAt: unknown;
};

export type InventoryTimelineInput = {
  eventId: unknown;
  occurredAt: unknown;
  eventType: unknown;
  physicalSkuId: unknown;
  physicalSkuLabel: unknown;
  commercialSkuId?: unknown;
  locationId?: unknown;
  locationLabel?: unknown;
  quantityDomain: unknown;
  unitLevel: unknown;
  quantityDelta: unknown;
  referenceKind?: unknown;
  referenceId?: unknown;
  referenceLabel?: unknown;
};

export type InventoryIntelligenceInput = {
  state: unknown;
  asOfAt: unknown;
  serverReadAt: unknown;
  freshness: unknown;
  quality: unknown;
  commercialSkus: unknown;
  physicalSkus: unknown;
  timeline: unknown;
};

export type InventoryCommercialSku = {
  key: string;
  commercialSkuId: string;
  label: string;
  identityState: InventoryIdentityState;
  coverageState: InventoryCoverageState;
  approvedPhysicalSkuCount: number | null;
  availablePhysicalSkuCount: number | null;
  affectedOrderCount: number | null;
  daysOfCover: number | null;
  reorderRisk: InventoryRiskState;
  asOfAt: string;
};

export type InventoryPhysicalSku = {
  key: string;
  physicalSkuId: string;
  label: string;
  identityState: InventoryIdentityState;
  commercialSkuId: string | null;
  commercialSkuLabel: string | null;
  supplier: string | null;
  brand: string | null;
  locationId: string | null;
  locationLabel: string | null;
  quantityDomain: InventoryQuantityDomain;
  unitLevel: string;
  onHand: number | null;
  available: number | null;
  reserved: number | null;
  daysOfCover: number | null;
  reorderRisk: InventoryRiskState;
  asOfAt: string;
};

export type InventoryTimelineReference = {
  kind: 'order';
  id: string;
  label: string;
};

export type InventoryTimelineEvent = {
  key: string;
  eventId: string;
  occurredAt: string;
  eventType: InventoryTimelineEventType;
  physicalSkuId: string;
  physicalSkuLabel: string;
  commercialSkuId: string | null;
  locationId: string | null;
  locationLabel: string | null;
  quantityDomain: InventoryQuantityDomain;
  unitLevel: string;
  quantityDelta: number | null;
  reference: InventoryTimelineReference | null;
};

export type InventoryIntelligenceModel = {
  status: InventoryIntelligenceStatus;
  state: InventoryIntelligenceReadState | 'UNKNOWN';
  capabilities: readonly InventoryIntelligenceSurfaceCapability[];
  asOfAt: string | null;
  serverReadAt: string | null;
  freshness: string | null;
  quality: string | null;
  commercialSkus: readonly InventoryCommercialSku[];
  physicalSkus: readonly InventoryPhysicalSku[];
  timeline: readonly InventoryTimelineEvent[];
  issues: readonly InventoryIntelligenceIssue[];
};

export type InventoryIntelligenceHandoff = {
  kind: 'commercial-sku' | 'physical-sku' | 'order';
  id: string;
  workspace: IntelligenceWorkspaceId;
  pathname: string;
  href: string;
  query: WorkspaceQueryState;
};

export type InventoryIntelligenceHandoffResult =
  | { status: 'READY'; handoff: InventoryIntelligenceHandoff }
  | { status: 'UNAVAILABLE'; reason: 'INVALID_ENTITY_ID' | 'ROUTE_UNAVAILABLE' };

const MAX_ROWS = 500;
const MAX_TIMELINE_ROWS = 1000;
const MAX_ID_LENGTH = 180;
const MAX_LABEL_LENGTH = 180;
const MAX_TEXT_LENGTH = 120;
const READ_STATES = new Set<InventoryIntelligenceReadState>(inventoryIntelligenceReadStates);
const IDENTITY_STATES = new Set<InventoryIdentityState>(inventoryIdentityStates);
const QUANTITY_DOMAINS = new Set<InventoryQuantityDomain>(inventoryQuantityDomains);
const COVERAGE_STATES = new Set<InventoryCoverageState>(inventoryCoverageStates);
const RISK_STATES = new Set<InventoryRiskState>(inventoryRiskStates);
const TIMELINE_EVENT_TYPES = new Set<InventoryTimelineEventType>(inventoryTimelineEventTypes);
const DATA_BEARING_STATES = new Set<InventoryIntelligenceReadState>(['READY', 'PARTIAL', 'DEGRADED']);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum = MAX_TEXT_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function optionalText(value: unknown, maximum = MAX_TEXT_LENGTH): string | null {
  const candidate = text(value, maximum);
  return candidate || null;
}

function canonicalId(value: unknown): string {
  const candidate = text(value, MAX_ID_LENGTH);
  return candidate && !candidate.includes('/') ? candidate : '';
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = value.trim();
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? candidate : null;
}

function nullableNonNegativeNumber(
  value: unknown,
  collection: InventoryIntelligenceIssue['collection'],
  row: number,
  field: string,
  issues: InventoryIntelligenceIssue[],
): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    issues.push({
      code: 'INVALID_NUMBER',
      collection,
      row,
      field,
      value: String(value).slice(0, MAX_TEXT_LENGTH),
    });
    return null;
  }
  return parsed;
}

function nullableSignedNumber(
  value: unknown,
  row: number,
  issues: InventoryIntelligenceIssue[],
): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    issues.push({
      code: 'INVALID_NUMBER',
      collection: 'timeline',
      row,
      field: 'quantityDelta',
      value: String(value).slice(0, MAX_TEXT_LENGTH),
    });
    return null;
  }
  return parsed;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T | null {
  const candidate = text(value).toUpperCase();
  return allowed.has(candidate as T) ? candidate as T : null;
}

function validRowTimestamp(
  value: unknown,
  serverReadAt: string,
  collection: InventoryIntelligenceIssue['collection'],
  row: number,
  field: string,
  issues: InventoryIntelligenceIssue[],
): string | null {
  const candidate = isoTimestamp(value);
  if (!candidate || Date.parse(candidate) > Date.parse(serverReadAt)) {
    issues.push({
      code: 'ROW_TIMESTAMP_INVALID',
      collection,
      row,
      field,
      value: text(value),
    });
    return null;
  }
  return candidate;
}

function normaliseCommercialSkus(
  value: unknown,
  serverReadAt: string,
  issues: InventoryIntelligenceIssue[],
): InventoryCommercialSku[] {
  if (!Array.isArray(value)) {
    issues.push({ code: 'INVALID_COLLECTION', collection: 'commercialSkus' });
    return [];
  }
  const rows: InventoryCommercialSku[] = [];
  const seen = new Set<string>();
  value.slice(0, MAX_ROWS).forEach((raw, row) => {
    const record = recordOf(raw);
    if (!record) {
      issues.push({ code: 'INVALID_COMMERCIAL_SKU', collection: 'commercialSkus', row });
      return;
    }
    const commercialSkuId = canonicalId(record.commercialSkuId);
    const label = text(record.label, MAX_LABEL_LENGTH);
    const identityState = enumValue(record.identityState, IDENTITY_STATES);
    const coverageState = enumValue(record.coverageState, COVERAGE_STATES);
    const reorderRisk = enumValue(record.reorderRisk, RISK_STATES);
    const asOfAt = validRowTimestamp(
      record.asOfAt,
      serverReadAt,
      'commercialSkus',
      row,
      'asOfAt',
      issues,
    );
    if (!commercialSkuId || !label || !identityState || !coverageState || !reorderRisk || !asOfAt) {
      if (!identityState) {
        issues.push({
          code: 'INVALID_IDENTITY_STATE',
          collection: 'commercialSkus',
          row,
          field: 'identityState',
          value: text(record.identityState),
        });
      }
      if (!coverageState) {
        issues.push({
          code: 'INVALID_COVERAGE_STATE',
          collection: 'commercialSkus',
          row,
          field: 'coverageState',
          value: text(record.coverageState),
        });
      }
      if (!reorderRisk) {
        issues.push({
          code: 'INVALID_RISK_STATE',
          collection: 'commercialSkus',
          row,
          field: 'reorderRisk',
          value: text(record.reorderRisk),
        });
      }
      issues.push({ code: 'INVALID_COMMERCIAL_SKU', collection: 'commercialSkus', row });
      return;
    }
    const key = `commercial-sku:${commercialSkuId}`;
    if (seen.has(key)) {
      issues.push({ code: 'DUPLICATE_COMMERCIAL_SKU', collection: 'commercialSkus', row, entityKey: key });
      return;
    }
    seen.add(key);
    rows.push({
      key,
      commercialSkuId,
      label,
      identityState,
      coverageState,
      approvedPhysicalSkuCount: nullableNonNegativeNumber(
        record.approvedPhysicalSkuCount,
        'commercialSkus',
        row,
        'approvedPhysicalSkuCount',
        issues,
      ),
      availablePhysicalSkuCount: nullableNonNegativeNumber(
        record.availablePhysicalSkuCount,
        'commercialSkus',
        row,
        'availablePhysicalSkuCount',
        issues,
      ),
      affectedOrderCount: nullableNonNegativeNumber(
        record.affectedOrderCount,
        'commercialSkus',
        row,
        'affectedOrderCount',
        issues,
      ),
      daysOfCover: nullableNonNegativeNumber(
        record.daysOfCover,
        'commercialSkus',
        row,
        'daysOfCover',
        issues,
      ),
      reorderRisk,
      asOfAt,
    });
  });
  if (value.length > MAX_ROWS) {
    issues.push({
      code: 'INVALID_COLLECTION',
      collection: 'commercialSkus',
      field: 'length',
      value: String(value.length),
    });
  }
  return rows;
}

function normalisePhysicalSkus(
  value: unknown,
  serverReadAt: string,
  commercialIds: ReadonlySet<string>,
  issues: InventoryIntelligenceIssue[],
): InventoryPhysicalSku[] {
  if (!Array.isArray(value)) {
    issues.push({ code: 'INVALID_COLLECTION', collection: 'physicalSkus' });
    return [];
  }
  const rows: InventoryPhysicalSku[] = [];
  const seen = new Set<string>();
  value.slice(0, MAX_ROWS).forEach((raw, row) => {
    const record = recordOf(raw);
    if (!record) {
      issues.push({ code: 'INVALID_PHYSICAL_SKU', collection: 'physicalSkus', row });
      return;
    }
    const physicalSkuId = canonicalId(record.physicalSkuId);
    const label = text(record.label, MAX_LABEL_LENGTH);
    const identityState = enumValue(record.identityState, IDENTITY_STATES);
    const quantityDomain = enumValue(record.quantityDomain, QUANTITY_DOMAINS);
    const reorderRisk = enumValue(record.reorderRisk, RISK_STATES);
    const unitLevel = text(record.unitLevel, MAX_TEXT_LENGTH);
    const commercialSkuId = optionalText(record.commercialSkuId, MAX_ID_LENGTH);
    const asOfAt = validRowTimestamp(
      record.asOfAt,
      serverReadAt,
      'physicalSkus',
      row,
      'asOfAt',
      issues,
    );
    if (!physicalSkuId || !label || !identityState || !quantityDomain || !reorderRisk || !unitLevel || !asOfAt) {
      if (!identityState) {
        issues.push({
          code: 'INVALID_IDENTITY_STATE',
          collection: 'physicalSkus',
          row,
          field: 'identityState',
          value: text(record.identityState),
        });
      }
      if (!quantityDomain) {
        issues.push({
          code: 'INVALID_QUANTITY_DOMAIN',
          collection: 'physicalSkus',
          row,
          field: 'quantityDomain',
          value: text(record.quantityDomain),
        });
      }
      if (!reorderRisk) {
        issues.push({
          code: 'INVALID_RISK_STATE',
          collection: 'physicalSkus',
          row,
          field: 'reorderRisk',
          value: text(record.reorderRisk),
        });
      }
      issues.push({ code: 'INVALID_PHYSICAL_SKU', collection: 'physicalSkus', row });
      return;
    }
    if (commercialSkuId && commercialSkuId === physicalSkuId) {
      issues.push({
        code: 'COMMERCIAL_PHYSICAL_IDENTITY_COLLISION',
        collection: 'physicalSkus',
        row,
        entityKey: `physical-sku:${physicalSkuId}`,
      });
      return;
    }
    if (commercialSkuId && !commercialIds.has(commercialSkuId)) {
      issues.push({
        code: 'INVALID_PHYSICAL_SKU',
        collection: 'physicalSkus',
        row,
        field: 'commercialSkuId',
        value: commercialSkuId,
      });
    }
    const key = `physical-sku:${physicalSkuId}`;
    if (seen.has(key)) {
      issues.push({ code: 'DUPLICATE_PHYSICAL_SKU', collection: 'physicalSkus', row, entityKey: key });
      return;
    }
    seen.add(key);
    rows.push({
      key,
      physicalSkuId,
      label,
      identityState,
      commercialSkuId,
      commercialSkuLabel: optionalText(record.commercialSkuLabel, MAX_LABEL_LENGTH),
      supplier: optionalText(record.supplier, MAX_LABEL_LENGTH),
      brand: optionalText(record.brand, MAX_LABEL_LENGTH),
      locationId: optionalText(record.locationId, MAX_ID_LENGTH),
      locationLabel: optionalText(record.locationLabel, MAX_LABEL_LENGTH),
      quantityDomain,
      unitLevel,
      onHand: nullableNonNegativeNumber(record.onHand, 'physicalSkus', row, 'onHand', issues),
      available: nullableNonNegativeNumber(record.available, 'physicalSkus', row, 'available', issues),
      reserved: nullableNonNegativeNumber(record.reserved, 'physicalSkus', row, 'reserved', issues),
      daysOfCover: nullableNonNegativeNumber(record.daysOfCover, 'physicalSkus', row, 'daysOfCover', issues),
      reorderRisk,
      asOfAt,
    });
  });
  if (value.length > MAX_ROWS) {
    issues.push({
      code: 'INVALID_COLLECTION',
      collection: 'physicalSkus',
      field: 'length',
      value: String(value.length),
    });
  }
  return rows;
}

function normaliseTimeline(
  value: unknown,
  serverReadAt: string,
  issues: InventoryIntelligenceIssue[],
): InventoryTimelineEvent[] {
  if (!Array.isArray(value)) {
    issues.push({ code: 'INVALID_COLLECTION', collection: 'timeline' });
    return [];
  }
  const rows: InventoryTimelineEvent[] = [];
  const seen = new Set<string>();
  value.slice(0, MAX_TIMELINE_ROWS).forEach((raw, row) => {
    const record = recordOf(raw);
    if (!record) {
      issues.push({ code: 'INVALID_TIMELINE_EVENT', collection: 'timeline', row });
      return;
    }
    const eventId = canonicalId(record.eventId);
    const occurredAt = validRowTimestamp(
      record.occurredAt,
      serverReadAt,
      'timeline',
      row,
      'occurredAt',
      issues,
    );
    const eventType = enumValue(record.eventType, TIMELINE_EVENT_TYPES);
    const physicalSkuId = canonicalId(record.physicalSkuId);
    const physicalSkuLabel = text(record.physicalSkuLabel, MAX_LABEL_LENGTH);
    const quantityDomain = enumValue(record.quantityDomain, QUANTITY_DOMAINS);
    const unitLevel = text(record.unitLevel, MAX_TEXT_LENGTH);
    if (!eventId || !occurredAt || !eventType || !physicalSkuId || !physicalSkuLabel || !quantityDomain || !unitLevel) {
      if (!eventType) {
        issues.push({
          code: 'UNKNOWN_TIMELINE_EVENT_TYPE',
          collection: 'timeline',
          row,
          field: 'eventType',
          value: text(record.eventType),
        });
      }
      if (!quantityDomain) {
        issues.push({
          code: 'INVALID_QUANTITY_DOMAIN',
          collection: 'timeline',
          row,
          field: 'quantityDomain',
          value: text(record.quantityDomain),
        });
      }
      issues.push({ code: 'INVALID_TIMELINE_EVENT', collection: 'timeline', row });
      return;
    }
    const key = `inventory-event:${eventId}`;
    if (seen.has(key)) {
      issues.push({ code: 'DUPLICATE_TIMELINE_EVENT', collection: 'timeline', row, entityKey: key });
      return;
    }
    seen.add(key);
    const referenceKind = text(record.referenceKind).toLowerCase();
    const referenceId = canonicalId(record.referenceId);
    const referenceLabel = text(record.referenceLabel, MAX_LABEL_LENGTH);
    const reference = referenceKind === 'order' && referenceId && referenceLabel
      ? { kind: 'order' as const, id: referenceId, label: referenceLabel }
      : null;
    rows.push({
      key,
      eventId,
      occurredAt,
      eventType,
      physicalSkuId,
      physicalSkuLabel,
      commercialSkuId: optionalText(record.commercialSkuId, MAX_ID_LENGTH),
      locationId: optionalText(record.locationId, MAX_ID_LENGTH),
      locationLabel: optionalText(record.locationLabel, MAX_LABEL_LENGTH),
      quantityDomain,
      unitLevel,
      quantityDelta: nullableSignedNumber(record.quantityDelta, row, issues),
      reference,
    });
  });
  if (value.length > MAX_TIMELINE_ROWS) {
    issues.push({
      code: 'INVALID_COLLECTION',
      collection: 'timeline',
      field: 'length',
      value: String(value.length),
    });
  }
  return rows;
}

function invalidModel(issues: InventoryIntelligenceIssue[]): InventoryIntelligenceModel {
  return {
    status: 'invalid',
    state: 'UNKNOWN',
    capabilities: inventoryIntelligenceSurfaceCapabilities,
    asOfAt: null,
    serverReadAt: null,
    freshness: null,
    quality: null,
    commercialSkus: [],
    physicalSkus: [],
    timeline: [],
    issues,
  };
}

export function buildInventoryIntelligenceModel(input: unknown): InventoryIntelligenceModel {
  const record = recordOf(input);
  if (!record) return invalidModel([{ code: 'INVALID_INPUT' }]);

  const issues: InventoryIntelligenceIssue[] = [];
  const stateCandidate = text(record.state).toUpperCase();
  const state = READ_STATES.has(stateCandidate as InventoryIntelligenceReadState)
    ? stateCandidate as InventoryIntelligenceReadState
    : 'UNKNOWN';
  if (state === 'UNKNOWN') {
    issues.push({ code: 'UNKNOWN_READ_STATE', field: 'state', value: stateCandidate || undefined });
    return invalidModel(issues);
  }

  const asOfAt = isoTimestamp(record.asOfAt);
  const serverReadAt = isoTimestamp(record.serverReadAt);
  if (!asOfAt || !serverReadAt) {
    issues.push({ code: 'INVALID_ENVELOPE_TIMESTAMP' });
    return invalidModel(issues);
  }
  if (Date.parse(asOfAt) > Date.parse(serverReadAt)) {
    issues.push({ code: 'TIMESTAMP_ORDER_INVALID', field: 'asOfAt,serverReadAt' });
    return invalidModel(issues);
  }

  if (!DATA_BEARING_STATES.has(state)) {
    const hasSuppliedData = [record.commercialSkus, record.physicalSkus, record.timeline]
      .some((value) => Array.isArray(value) && value.length > 0);
    if (hasSuppliedData) issues.push({ code: 'NON_DATA_STATE_SUPPRESSED' });
    return {
      status: state === 'EMPTY' ? 'empty' : 'blocked',
      state,
      capabilities: inventoryIntelligenceSurfaceCapabilities,
      asOfAt,
      serverReadAt,
      freshness: optionalText(record.freshness),
      quality: optionalText(record.quality),
      commercialSkus: [],
      physicalSkus: [],
      timeline: [],
      issues,
    };
  }

  const commercialSkus = normaliseCommercialSkus(record.commercialSkus, serverReadAt, issues);
  const commercialIds = new Set(commercialSkus.map((row) => row.commercialSkuId));
  const physicalSkus = normalisePhysicalSkus(record.physicalSkus, serverReadAt, commercialIds, issues);
  const timeline = normaliseTimeline(record.timeline, serverReadAt, issues);
  const hasData = commercialSkus.length > 0 || physicalSkus.length > 0 || timeline.length > 0;

  let status: InventoryIntelligenceStatus;
  if (!hasData) status = 'empty';
  else if (state === 'DEGRADED') status = 'degraded';
  else if (state === 'PARTIAL' || issues.length > 0) status = 'partial';
  else status = 'ready';

  return {
    status,
    state,
    capabilities: inventoryIntelligenceSurfaceCapabilities,
    asOfAt,
    serverReadAt,
    freshness: optionalText(record.freshness),
    quality: optionalText(record.quality),
    commercialSkus,
    physicalSkus,
    timeline,
    issues,
  };
}

function routePath(kind: InventoryIntelligenceHandoff['kind'], id: string): string {
  const encoded = encodeURIComponent(id);
  if (kind === 'commercial-sku') return `/inventory/commercial/${encoded}`;
  if (kind === 'physical-sku') return `/inventory/physical/${encoded}`;
  return `/orders/${encoded}`;
}

export function buildInventoryIntelligenceHandoff(
  kind: InventoryIntelligenceHandoff['kind'],
  rawId: string,
): InventoryIntelligenceHandoffResult {
  const id = canonicalId(rawId);
  if (!id) return { status: 'UNAVAILABLE', reason: 'INVALID_ENTITY_ID' };
  const pathname = routePath(kind, id);
  const matched = matchIntelligenceRoute(pathname);
  const expectedKind = kind as IntelligenceEntityKind;
  if (matched.status !== 'READY'
    || matched.route.entityKind !== expectedKind
    || matched.route.entityId !== id) {
    return { status: 'UNAVAILABLE', reason: 'ROUTE_UNAVAILABLE' };
  }
  const query: WorkspaceQueryState = {
    filters: [],
    selected: id,
    primaryDrawer: `${kind}:${id}`,
  };
  return {
    status: 'READY',
    handoff: {
      kind,
      id,
      workspace: matched.route.workspace,
      pathname,
      href: withWorkspaceQuery(pathname, query),
      query,
    },
  };
}
