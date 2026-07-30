import {
  isOperationalPulseMetricKey,
  type OperationalPulseAvailability,
  type OperationalPulseMetricKey,
} from '@/features/intelligence/operationalPulse/operationalPulseContract.ts';
import {
  matchIntelligenceRoute,
  type IntelligenceEntityKind,
  type IntelligenceWorkspaceId,
} from '@/features/intelligence/navigation/routeContract.ts';
import {
  withWorkspaceQuery,
  type WorkspaceQueryState,
} from '@/features/intelligence/navigation/queryState.ts';
import type { OverlayEntityRef } from '@/features/intelligence/navigation/overlayState';

export const crossFilterDrillCapabilities = ['AVAILABLE', 'UNAVAILABLE'] as const;
export type CrossFilterDrillCapability = (typeof crossFilterDrillCapabilities)[number];

export type CrossFilterDrillState = 'ready' | 'partial' | 'empty' | 'blocked' | 'invalid';

export type CrossFilterDrillIssueCode =
  | 'INVALID_INPUT'
  | 'UNKNOWN_METRIC_KEY'
  | 'UNKNOWN_METRIC_AVAILABILITY'
  | 'UNKNOWN_DRILL_CAPABILITY'
  | 'NON_DRILLABLE_DATA_SUPPRESSED'
  | 'INVALID_SUPPORTED_DIMENSIONS'
  | 'INVALID_DIMENSION_KEY'
  | 'DUPLICATE_DIMENSION_KEY'
  | 'INVALID_BREAKDOWN_COLLECTION'
  | 'INVALID_BREAKDOWN'
  | 'UNSUPPORTED_BREAKDOWN_DIMENSION'
  | 'DUPLICATE_BREAKDOWN_KEY'
  | 'INVALID_AFFECTED_COUNT'
  | 'INVALID_TRUNCATION_FLAG'
  | 'INVALID_ENTITY_COLLECTION'
  | 'INVALID_ENTITY'
  | 'UNKNOWN_ENTITY_KIND'
  | 'INVALID_ENTITY_ID'
  | 'DUPLICATE_ENTITY'
  | 'AFFECTED_COUNT_MISMATCH'
  | 'OPERATIONAL_ROUTE_UNAVAILABLE';

export type CrossFilterDrillIssue = {
  code: CrossFilterDrillIssueCode;
  metricKey?: string;
  breakdownKey?: string;
  entityKey?: string;
  field?: string;
  value?: string;
  row?: number;
};

export type CrossFilterDrillMetricInput = {
  metricKey: string;
  availability: string;
  quality?: string | null;
  freshness?: string | null;
};

export type CrossFilterAffectedEntityInput = {
  kind: string;
  id: string;
  label: string;
  subtitle?: string | null;
};

export type CrossFilterBreakdownInput = {
  dimensionKey: string;
  dimensionLabel: string;
  valueKey: string;
  valueLabel: string;
  affectedCount: unknown;
  truncated: unknown;
  entities: unknown;
};

export type CrossFilterDrillInput = {
  metric: CrossFilterDrillMetricInput;
  drillCapability: string;
  supportedDimensions: unknown;
  breakdowns: unknown;
};

export type CrossFilterOperationalRoute = {
  workspace: IntelligenceWorkspaceId;
  pathname: string;
  href: string;
  query: WorkspaceQueryState;
};

export type CrossFilterAffectedEntity = {
  key: string;
  entity: OverlayEntityRef;
  label: string;
  subtitle: string | null;
  primaryDrawer: OverlayEntityRef;
  operationalRoute: CrossFilterOperationalRoute;
};

export type CrossFilterBreakdown = {
  key: string;
  dimensionKey: string;
  dimensionLabel: string;
  valueKey: string;
  valueLabel: string;
  affectedCount: number;
  truncated: boolean;
  entities: readonly CrossFilterAffectedEntity[];
};

export type CrossFilterDrillModel = {
  state: CrossFilterDrillState;
  metricKey: OperationalPulseMetricKey | null;
  metricAvailability: OperationalPulseAvailability | 'UNKNOWN';
  metricQuality: string | null;
  metricFreshness: string | null;
  drillCapability: CrossFilterDrillCapability | 'UNKNOWN';
  supportedDimensions: readonly string[];
  breakdowns: readonly CrossFilterBreakdown[];
  issues: readonly CrossFilterDrillIssue[];
};

export type CrossFilterDrillPath = {
  metricKey: OperationalPulseMetricKey;
  breakdown: CrossFilterBreakdown;
  affectedEntity: CrossFilterAffectedEntity;
  primaryDrawer: OverlayEntityRef;
  operationalRoute: CrossFilterOperationalRoute;
};

export type CrossFilterDrillPathResult =
  | { status: 'READY'; path: CrossFilterDrillPath }
  | {
      status: 'UNAVAILABLE';
      reason: 'DRILL_NOT_AVAILABLE' | 'BREAKDOWN_NOT_FOUND' | 'ENTITY_NOT_FOUND';
    };

const MAX_DIMENSIONS = 12;
const MAX_BREAKDOWNS = 50;
const MAX_ENTITIES_PER_BREAKDOWN = 100;
const MAX_KEY_LENGTH = 80;
const MAX_LABEL_LENGTH = 160;
const MAX_SUBTITLE_LENGTH = 240;
const MAX_ENTITY_ID_LENGTH = 180;
const TOKEN = /^[a-z0-9][a-z0-9_.-]*$/i;
const ROUTEABLE_ENTITY_KINDS = new Set<IntelligenceEntityKind>([
  'order',
  'commercial-sku',
  'physical-sku',
  'customer',
  'store',
  'delivery-run',
]);
const AVAILABILITIES = new Set<OperationalPulseAvailability>([
  'READY',
  'SHADOW',
  'BLOCKED',
  'EMPTY',
  'FORBIDDEN',
  'UNAVAILABLE',
  'FAILED',
]);
const DRILL_CAPABILITIES = new Set<CrossFilterDrillCapability>(crossFilterDrillCapabilities);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maximum = MAX_LABEL_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function optionalText(value: unknown, maximum: number): string | null {
  const candidate = text(value, maximum);
  return candidate || null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function routePathForEntity(kind: IntelligenceEntityKind, id: string): string {
  const encoded = encodeURIComponent(id);
  if (kind === 'order') return `/orders/${encoded}`;
  if (kind === 'commercial-sku') return `/inventory/commercial/${encoded}`;
  if (kind === 'physical-sku') return `/inventory/physical/${encoded}`;
  if (kind === 'customer') return `/customers/${encoded}`;
  if (kind === 'store') return `/stores/${encoded}`;
  return `/delivery/runs/${encoded}`;
}

function routeForEntity(entity: OverlayEntityRef): CrossFilterOperationalRoute | null {
  if (!ROUTEABLE_ENTITY_KINDS.has(entity.kind as IntelligenceEntityKind)) return null;
  const kind = entity.kind as IntelligenceEntityKind;
  const pathname = routePathForEntity(kind, entity.id);
  const matched = matchIntelligenceRoute(pathname);
  if (matched.status !== 'READY'
    || matched.route.entityKind !== kind
    || matched.route.entityId !== entity.id) {
    return null;
  }
  const query: WorkspaceQueryState = {
    filters: [],
    selected: entity.id,
    primaryDrawer: `${entity.kind}:${entity.id}`,
  };
  return {
    workspace: matched.route.workspace,
    pathname,
    href: withWorkspaceQuery(pathname, query),
    query,
  };
}

function normaliseMetric(
  input: CrossFilterDrillMetricInput,
  issues: CrossFilterDrillIssue[],
): {
  metricKey: OperationalPulseMetricKey | null;
  availability: OperationalPulseAvailability | 'UNKNOWN';
  quality: string | null;
  freshness: string | null;
} {
  const metricKeyCandidate = text(input.metricKey, MAX_KEY_LENGTH).toLowerCase();
  const metricKey = isOperationalPulseMetricKey(metricKeyCandidate)
    ? metricKeyCandidate
    : null;
  if (!metricKey) {
    issues.push({
      code: 'UNKNOWN_METRIC_KEY',
      metricKey: metricKeyCandidate || undefined,
      field: 'metricKey',
    });
  }

  const availabilityCandidate = text(input.availability, MAX_KEY_LENGTH).toUpperCase();
  const availability = AVAILABILITIES.has(availabilityCandidate as OperationalPulseAvailability)
    ? availabilityCandidate as OperationalPulseAvailability
    : 'UNKNOWN';
  if (availability === 'UNKNOWN') {
    issues.push({
      code: 'UNKNOWN_METRIC_AVAILABILITY',
      metricKey: metricKeyCandidate || undefined,
      field: 'availability',
      value: availabilityCandidate || undefined,
    });
  }

  return {
    metricKey,
    availability,
    quality: optionalText(input.quality, MAX_KEY_LENGTH)?.toUpperCase() ?? null,
    freshness: optionalText(input.freshness, MAX_KEY_LENGTH)?.toUpperCase() ?? null,
  };
}

function normaliseDrillCapability(
  value: unknown,
  metricKey: string | undefined,
  issues: CrossFilterDrillIssue[],
): CrossFilterDrillCapability | 'UNKNOWN' {
  const candidate = text(value, MAX_KEY_LENGTH).toUpperCase();
  if (DRILL_CAPABILITIES.has(candidate as CrossFilterDrillCapability)) {
    return candidate as CrossFilterDrillCapability;
  }
  issues.push({
    code: 'UNKNOWN_DRILL_CAPABILITY',
    metricKey,
    field: 'drillCapability',
    value: candidate || undefined,
  });
  return 'UNKNOWN';
}

function normaliseSupportedDimensions(
  value: unknown,
  metricKey: string | undefined,
  issues: CrossFilterDrillIssue[],
): string[] {
  if (!Array.isArray(value)) {
    issues.push({
      code: 'INVALID_SUPPORTED_DIMENSIONS',
      metricKey,
      field: 'supportedDimensions',
    });
    return [];
  }
  const dimensions: string[] = [];
  const seen = new Set<string>();
  value.slice(0, MAX_DIMENSIONS).forEach((item, row) => {
    const candidate = text(item, MAX_KEY_LENGTH).toLowerCase();
    if (!candidate || !TOKEN.test(candidate)) {
      issues.push({
        code: 'INVALID_DIMENSION_KEY',
        metricKey,
        field: 'supportedDimensions',
        value: candidate || undefined,
        row,
      });
      return;
    }
    if (seen.has(candidate)) {
      issues.push({
        code: 'DUPLICATE_DIMENSION_KEY',
        metricKey,
        field: 'supportedDimensions',
        value: candidate,
        row,
      });
      return;
    }
    seen.add(candidate);
    dimensions.push(candidate);
  });
  if (value.length > MAX_DIMENSIONS) {
    issues.push({
      code: 'INVALID_SUPPORTED_DIMENSIONS',
      metricKey,
      field: 'supportedDimensions',
      value: String(value.length),
    });
  }
  return dimensions;
}

function normaliseEntity(
  raw: unknown,
  metricKey: OperationalPulseMetricKey,
  breakdownKey: string,
  row: number,
  issues: CrossFilterDrillIssue[],
): CrossFilterAffectedEntity | null {
  const record = recordOf(raw);
  if (!record) {
    issues.push({ code: 'INVALID_ENTITY', metricKey, breakdownKey, row });
    return null;
  }
  const kindCandidate = text(record.kind, MAX_KEY_LENGTH).toLowerCase();
  if (!ROUTEABLE_ENTITY_KINDS.has(kindCandidate as IntelligenceEntityKind)) {
    issues.push({
      code: 'UNKNOWN_ENTITY_KIND',
      metricKey,
      breakdownKey,
      field: 'kind',
      value: kindCandidate || undefined,
      row,
    });
    return null;
  }
  const id = text(record.id, MAX_ENTITY_ID_LENGTH);
  if (!id || id.includes('/')) {
    issues.push({
      code: 'INVALID_ENTITY_ID',
      metricKey,
      breakdownKey,
      field: 'id',
      value: id || undefined,
      row,
    });
    return null;
  }
  const label = text(record.label, MAX_LABEL_LENGTH);
  if (!label) {
    issues.push({
      code: 'INVALID_ENTITY',
      metricKey,
      breakdownKey,
      field: 'label',
      row,
    });
    return null;
  }
  const entity: OverlayEntityRef = {
    kind: kindCandidate as IntelligenceEntityKind,
    id,
  };
  const operationalRoute = routeForEntity(entity);
  if (!operationalRoute) {
    issues.push({
      code: 'OPERATIONAL_ROUTE_UNAVAILABLE',
      metricKey,
      breakdownKey,
      entityKey: `${entity.kind}:${entity.id}`,
      row,
    });
    return null;
  }
  return {
    key: `${entity.kind}:${entity.id}`,
    entity,
    label,
    subtitle: optionalText(record.subtitle, MAX_SUBTITLE_LENGTH),
    primaryDrawer: entity,
    operationalRoute,
  };
}

function normaliseBreakdowns(
  value: unknown,
  metricKey: OperationalPulseMetricKey,
  supportedDimensions: readonly string[],
  issues: CrossFilterDrillIssue[],
): CrossFilterBreakdown[] | null {
  if (!Array.isArray(value)) {
    issues.push({
      code: 'INVALID_BREAKDOWN_COLLECTION',
      metricKey,
      field: 'breakdowns',
    });
    return null;
  }
  const dimensionSet = new Set(supportedDimensions);
  const breakdowns: CrossFilterBreakdown[] = [];
  const seenBreakdowns = new Set<string>();

  value.slice(0, MAX_BREAKDOWNS).forEach((raw, row) => {
    const record = recordOf(raw);
    if (!record) {
      issues.push({ code: 'INVALID_BREAKDOWN', metricKey, row });
      return;
    }
    const dimensionKey = text(record.dimensionKey, MAX_KEY_LENGTH).toLowerCase();
    const dimensionLabel = text(record.dimensionLabel, MAX_LABEL_LENGTH);
    const valueKey = text(record.valueKey, MAX_KEY_LENGTH);
    const valueLabel = text(record.valueLabel, MAX_LABEL_LENGTH);
    if (!dimensionKey || !TOKEN.test(dimensionKey)
      || !dimensionLabel || !valueKey || !valueLabel) {
      issues.push({
        code: 'INVALID_BREAKDOWN',
        metricKey,
        row,
      });
      return;
    }
    if (!dimensionSet.has(dimensionKey)) {
      issues.push({
        code: 'UNSUPPORTED_BREAKDOWN_DIMENSION',
        metricKey,
        field: 'dimensionKey',
        value: dimensionKey,
        row,
      });
      return;
    }
    const breakdownKey = `${dimensionKey}:${valueKey}`;
    if (seenBreakdowns.has(breakdownKey)) {
      issues.push({
        code: 'DUPLICATE_BREAKDOWN_KEY',
        metricKey,
        breakdownKey,
        row,
      });
      return;
    }

    const affectedCount = nonNegativeInteger(record.affectedCount);
    if (affectedCount === null) {
      issues.push({
        code: 'INVALID_AFFECTED_COUNT',
        metricKey,
        breakdownKey,
        field: 'affectedCount',
        value: String(record.affectedCount).slice(0, 120),
        row,
      });
      return;
    }
    if (typeof record.truncated !== 'boolean') {
      issues.push({
        code: 'INVALID_TRUNCATION_FLAG',
        metricKey,
        breakdownKey,
        field: 'truncated',
        value: String(record.truncated).slice(0, 120),
        row,
      });
      return;
    }
    if (!Array.isArray(record.entities)) {
      issues.push({
        code: 'INVALID_ENTITY_COLLECTION',
        metricKey,
        breakdownKey,
        field: 'entities',
        row,
      });
      return;
    }

    const entities: CrossFilterAffectedEntity[] = [];
    const seenEntities = new Set<string>();
    record.entities.slice(0, MAX_ENTITIES_PER_BREAKDOWN).forEach((entityRaw, entityRow) => {
      const entity = normaliseEntity(entityRaw, metricKey, breakdownKey, entityRow, issues);
      if (!entity) return;
      if (seenEntities.has(entity.key)) {
        issues.push({
          code: 'DUPLICATE_ENTITY',
          metricKey,
          breakdownKey,
          entityKey: entity.key,
          row: entityRow,
        });
        return;
      }
      seenEntities.add(entity.key);
      entities.push(entity);
    });

    if (record.entities.length > MAX_ENTITIES_PER_BREAKDOWN
      || affectedCount < entities.length
      || (!record.truncated && affectedCount !== entities.length)) {
      issues.push({
        code: 'AFFECTED_COUNT_MISMATCH',
        metricKey,
        breakdownKey,
        field: 'affectedCount',
        value: `${affectedCount}:${entities.length}:${String(record.truncated)}`,
        row,
      });
    }

    seenBreakdowns.add(breakdownKey);
    breakdowns.push({
      key: breakdownKey,
      dimensionKey,
      dimensionLabel,
      valueKey,
      valueLabel,
      affectedCount,
      truncated: record.truncated,
      entities,
    });
  });

  if (value.length > MAX_BREAKDOWNS) {
    issues.push({
      code: 'INVALID_BREAKDOWN_COLLECTION',
      metricKey,
      field: 'breakdowns',
      value: String(value.length),
    });
  }
  return breakdowns;
}

export function buildCrossFilterDrillModel(input: unknown): CrossFilterDrillModel {
  const issues: CrossFilterDrillIssue[] = [];
  const record = recordOf(input);
  if (!record) {
    return {
      state: 'invalid',
      metricKey: null,
      metricAvailability: 'UNKNOWN',
      metricQuality: null,
      metricFreshness: null,
      drillCapability: 'UNKNOWN',
      supportedDimensions: [],
      breakdowns: [],
      issues: [{ code: 'INVALID_INPUT' }],
    };
  }
  const metricRecord = recordOf(record.metric);
  if (!metricRecord) {
    return {
      state: 'invalid',
      metricKey: null,
      metricAvailability: 'UNKNOWN',
      metricQuality: null,
      metricFreshness: null,
      drillCapability: 'UNKNOWN',
      supportedDimensions: [],
      breakdowns: [],
      issues: [{ code: 'INVALID_INPUT', field: 'metric' }],
    };
  }
  const metric = normaliseMetric({
    metricKey: String(metricRecord.metricKey ?? ''),
    availability: String(metricRecord.availability ?? ''),
    quality: metricRecord.quality as string | null | undefined,
    freshness: metricRecord.freshness as string | null | undefined,
  }, issues);
  const drillCapability = normaliseDrillCapability(
    record.drillCapability,
    metric.metricKey ?? undefined,
    issues,
  );
  const supportedDimensions = normaliseSupportedDimensions(
    record.supportedDimensions,
    metric.metricKey ?? undefined,
    issues,
  );

  if (!metric.metricKey || metric.availability === 'UNKNOWN') {
    return {
      state: 'invalid',
      metricKey: metric.metricKey,
      metricAvailability: metric.availability,
      metricQuality: metric.quality,
      metricFreshness: metric.freshness,
      drillCapability,
      supportedDimensions,
      breakdowns: [],
      issues,
    };
  }

  const drillable = metric.availability === 'READY' && drillCapability === 'AVAILABLE';
  if (!drillable) {
    if (Array.isArray(record.breakdowns) && record.breakdowns.length > 0) {
      issues.push({
        code: 'NON_DRILLABLE_DATA_SUPPRESSED',
        metricKey: metric.metricKey,
        field: 'breakdowns',
        value: String(record.breakdowns.length),
      });
    }
    return {
      state: 'blocked',
      metricKey: metric.metricKey,
      metricAvailability: metric.availability,
      metricQuality: metric.quality,
      metricFreshness: metric.freshness,
      drillCapability,
      supportedDimensions,
      breakdowns: [],
      issues,
    };
  }

  const breakdowns = normaliseBreakdowns(
    record.breakdowns,
    metric.metricKey,
    supportedDimensions,
    issues,
  );
  if (!breakdowns) {
    return {
      state: 'invalid',
      metricKey: metric.metricKey,
      metricAvailability: metric.availability,
      metricQuality: metric.quality,
      metricFreshness: metric.freshness,
      drillCapability,
      supportedDimensions,
      breakdowns: [],
      issues,
    };
  }

  return {
    state: breakdowns.length === 0
      ? issues.length ? 'partial' : 'empty'
      : issues.length ? 'partial' : 'ready',
    metricKey: metric.metricKey,
    metricAvailability: metric.availability,
    metricQuality: metric.quality,
    metricFreshness: metric.freshness,
    drillCapability,
    supportedDimensions,
    breakdowns,
    issues,
  };
}

export function buildCrossFilterDrillPath(
  model: CrossFilterDrillModel,
  breakdownKey: string,
  entityKey: string,
): CrossFilterDrillPathResult {
  if (!model.metricKey
    || model.drillCapability !== 'AVAILABLE'
    || model.metricAvailability !== 'READY'
    || (model.state !== 'ready' && model.state !== 'partial')) {
    return { status: 'UNAVAILABLE', reason: 'DRILL_NOT_AVAILABLE' };
  }
  const breakdown = model.breakdowns.find((candidate) => candidate.key === breakdownKey.trim());
  if (!breakdown) return { status: 'UNAVAILABLE', reason: 'BREAKDOWN_NOT_FOUND' };
  const affectedEntity = breakdown.entities.find((candidate) => candidate.key === entityKey.trim());
  if (!affectedEntity) return { status: 'UNAVAILABLE', reason: 'ENTITY_NOT_FOUND' };
  return {
    status: 'READY',
    path: {
      metricKey: model.metricKey,
      breakdown,
      affectedEntity,
      primaryDrawer: affectedEntity.primaryDrawer,
      operationalRoute: affectedEntity.operationalRoute,
    },
  };
}
