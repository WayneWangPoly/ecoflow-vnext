export const operationalPulseMetricKeys = [
  'revenue',
  'gross_margin',
  'fill_rate',
  'on_time_delivery_rate',
  'stockout_risk_count',
  'dead_stock_value',
  'substitution_rate',
  'lines_picked_per_hour',
  'inventory_days_of_cover',
  'customer_concentration',
] as const;

export type OperationalPulseMetricKey = (typeof operationalPulseMetricKeys)[number];
export type OperationalPulseAvailability =
  | 'READY'
  | 'SHADOW'
  | 'BLOCKED'
  | 'EMPTY'
  | 'FORBIDDEN'
  | 'UNAVAILABLE'
  | 'FAILED';
export type OperationalPulseFreshness =
  | 'CURRENT'
  | 'REFRESHING'
  | 'STALE'
  | 'DEGRADED'
  | 'FAILED'
  | 'NEVER'
  | 'UNKNOWN';
export type OperationalPulseQuality = 'TRUSTED' | 'WARNING' | 'INVALID' | 'UNKNOWN';
export type OperationalPulseTone = 'neutral' | 'success' | 'warning' | 'danger' | 'information';
export type OperationalPulseDeckState = 'ready' | 'partial' | 'empty';

export type OperationalPulseIssueCode =
  | 'UNKNOWN_METRIC_KEY'
  | 'DUPLICATE_METRIC_KEY'
  | 'INVALID_DISPLAY_NAME'
  | 'INVALID_UNIT_KIND'
  | 'UNKNOWN_AVAILABILITY'
  | 'UNKNOWN_FRESHNESS'
  | 'UNKNOWN_QUALITY'
  | 'READY_VALUE_INVALID'
  | 'READY_DISPLAY_VALUE_REQUIRED'
  | 'NON_READY_VALUE_SUPPRESSED'
  | 'INVALID_AS_OF_TIMESTAMP';

export type OperationalPulseIssue = {
  code: OperationalPulseIssueCode;
  metricKey?: string;
  field?: string;
  value?: string;
};

export type OperationalPulseMetricInput = {
  metricKey: string;
  displayName: string;
  unitKind: string;
  availability: string;
  value?: unknown;
  displayValue?: string | null;
  freshness?: string | null;
  quality?: string | null;
  asOfAt?: string | null;
  blockerCodes?: readonly string[] | null;
};

type OperationalPulseMetricBase = {
  metricKey: OperationalPulseMetricKey;
  displayName: string;
  unitKind: string;
  freshness: OperationalPulseFreshness;
  quality: OperationalPulseQuality;
  asOfAt: string | null;
  blockerCodes: readonly string[];
};

export type OperationalPulseReadyMetric = OperationalPulseMetricBase & {
  availability: 'READY';
  value: number;
  displayValue: string;
};

export type OperationalPulseUnavailableMetric = OperationalPulseMetricBase & {
  availability: Exclude<OperationalPulseAvailability, 'READY'>;
  value: null;
  displayValue: null;
};

export type OperationalPulseMetric = OperationalPulseReadyMetric | OperationalPulseUnavailableMetric;

export type OperationalPulseDeck = {
  state: OperationalPulseDeckState;
  metrics: readonly OperationalPulseMetric[];
  issues: readonly OperationalPulseIssue[];
};

const METRIC_KEY_SET = new Set<string>(operationalPulseMetricKeys);
const AVAILABILITY_SET = new Set<OperationalPulseAvailability>([
  'READY',
  'SHADOW',
  'BLOCKED',
  'EMPTY',
  'FORBIDDEN',
  'UNAVAILABLE',
  'FAILED',
]);
const FRESHNESS_SET = new Set<OperationalPulseFreshness>([
  'CURRENT',
  'REFRESHING',
  'STALE',
  'DEGRADED',
  'FAILED',
  'NEVER',
  'UNKNOWN',
]);
const QUALITY_SET = new Set<OperationalPulseQuality>([
  'TRUSTED',
  'WARNING',
  'INVALID',
  'UNKNOWN',
]);

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanCodeList(value: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanText).filter(Boolean))].slice(0, 4);
}

function normaliseTimestamp(
  value: string | null | undefined,
  metricKey: string,
  issues: OperationalPulseIssue[],
): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) {
    issues.push({
      code: 'INVALID_AS_OF_TIMESTAMP',
      metricKey,
      field: 'asOfAt',
      value: cleaned.slice(0, 120),
    });
    return null;
  }
  return cleaned;
}

function normaliseFreshness(
  value: string | null | undefined,
  metricKey: string,
  issues: OperationalPulseIssue[],
): OperationalPulseFreshness {
  const candidate = cleanText(value).toUpperCase() as OperationalPulseFreshness;
  if (FRESHNESS_SET.has(candidate)) return candidate;
  if (candidate) {
    issues.push({ code: 'UNKNOWN_FRESHNESS', metricKey, field: 'freshness', value: candidate });
  }
  return 'UNKNOWN';
}

function normaliseQuality(
  value: string | null | undefined,
  metricKey: string,
  issues: OperationalPulseIssue[],
): OperationalPulseQuality {
  const candidate = cleanText(value).toUpperCase() as OperationalPulseQuality;
  if (QUALITY_SET.has(candidate)) return candidate;
  if (candidate) {
    issues.push({ code: 'UNKNOWN_QUALITY', metricKey, field: 'quality', value: candidate });
  }
  return 'UNKNOWN';
}

function metricBase(
  input: OperationalPulseMetricInput,
  metricKey: OperationalPulseMetricKey,
  displayName: string,
  unitKind: string,
  issues: OperationalPulseIssue[],
): OperationalPulseMetricBase {
  return {
    metricKey,
    displayName,
    unitKind,
    freshness: normaliseFreshness(input.freshness, metricKey, issues),
    quality: normaliseQuality(input.quality, metricKey, issues),
    asOfAt: normaliseTimestamp(input.asOfAt, metricKey, issues),
    blockerCodes: cleanCodeList(input.blockerCodes),
  };
}

export function isOperationalPulseMetricKey(value: string): value is OperationalPulseMetricKey {
  return METRIC_KEY_SET.has(value);
}

export function normaliseOperationalPulseMetric(
  input: OperationalPulseMetricInput,
): { metric: OperationalPulseMetric | null; issues: readonly OperationalPulseIssue[] } {
  const issues: OperationalPulseIssue[] = [];
  const metricKeyCandidate = cleanText(input.metricKey).toLowerCase();
  if (!isOperationalPulseMetricKey(metricKeyCandidate)) {
    return {
      metric: null,
      issues: [{ code: 'UNKNOWN_METRIC_KEY', metricKey: metricKeyCandidate || undefined }],
    };
  }

  const displayName = cleanText(input.displayName);
  if (!displayName) {
    return {
      metric: null,
      issues: [{ code: 'INVALID_DISPLAY_NAME', metricKey: metricKeyCandidate, field: 'displayName' }],
    };
  }

  const unitKind = cleanText(input.unitKind).toUpperCase();
  if (!unitKind) {
    return {
      metric: null,
      issues: [{ code: 'INVALID_UNIT_KIND', metricKey: metricKeyCandidate, field: 'unitKind' }],
    };
  }

  const availabilityCandidate = cleanText(input.availability).toUpperCase() as OperationalPulseAvailability;
  const availability = AVAILABILITY_SET.has(availabilityCandidate)
    ? availabilityCandidate
    : 'UNAVAILABLE';
  if (!AVAILABILITY_SET.has(availabilityCandidate)) {
    issues.push({
      code: 'UNKNOWN_AVAILABILITY',
      metricKey: metricKeyCandidate,
      field: 'availability',
      value: availabilityCandidate || undefined,
    });
  }

  const base = metricBase(input, metricKeyCandidate, displayName, unitKind, issues);
  if (availability === 'READY') {
    const numericValue = finiteNumber(input.value);
    const displayValue = cleanText(input.displayValue);
    if (numericValue === null) {
      issues.push({
        code: 'READY_VALUE_INVALID',
        metricKey: metricKeyCandidate,
        field: 'value',
        value: input.value === undefined ? undefined : String(input.value).slice(0, 120),
      });
      return {
        metric: {
          ...base,
          availability: 'EMPTY',
          value: null,
          displayValue: null,
        },
        issues,
      };
    }
    if (!displayValue) {
      issues.push({
        code: 'READY_DISPLAY_VALUE_REQUIRED',
        metricKey: metricKeyCandidate,
        field: 'displayValue',
      });
      return {
        metric: {
          ...base,
          availability: 'EMPTY',
          value: null,
          displayValue: null,
        },
        issues,
      };
    }
    return {
      metric: {
        ...base,
        availability: 'READY',
        value: numericValue,
        displayValue,
      },
      issues,
    };
  }

  if (
    (input.value !== null && input.value !== undefined)
    || cleanText(input.displayValue)
  ) {
    issues.push({
      code: 'NON_READY_VALUE_SUPPRESSED',
      metricKey: metricKeyCandidate,
      field: 'value',
    });
  }

  return {
    metric: {
      ...base,
      availability,
      value: null,
      displayValue: null,
    },
    issues,
  };
}

export function buildOperationalPulseDeck(
  inputs: readonly OperationalPulseMetricInput[],
): OperationalPulseDeck {
  const metricsByKey = new Map<OperationalPulseMetricKey, OperationalPulseMetric>();
  const issues: OperationalPulseIssue[] = [];

  for (const input of inputs) {
    const normalised = normaliseOperationalPulseMetric(input);
    issues.push(...normalised.issues);
    if (!normalised.metric) continue;
    if (metricsByKey.has(normalised.metric.metricKey)) {
      issues.push({
        code: 'DUPLICATE_METRIC_KEY',
        metricKey: normalised.metric.metricKey,
      });
      continue;
    }
    metricsByKey.set(normalised.metric.metricKey, normalised.metric);
  }

  const metrics = operationalPulseMetricKeys
    .map((metricKey) => metricsByKey.get(metricKey))
    .filter((metric): metric is OperationalPulseMetric => Boolean(metric));

  return {
    state: metrics.length === 0
      ? 'empty'
      : metrics.every((metric) => metric.availability === 'READY') && issues.length === 0
        ? 'ready'
        : 'partial',
    metrics,
    issues,
  };
}

export function operationalPulseAvailabilityTone(
  availability: OperationalPulseAvailability,
): OperationalPulseTone {
  if (availability === 'READY') return 'success';
  if (availability === 'SHADOW') return 'information';
  if (availability === 'BLOCKED' || availability === 'EMPTY') return 'warning';
  if (availability === 'FAILED') return 'danger';
  return 'neutral';
}

export function operationalPulseSignalTone(metric: OperationalPulseMetric): OperationalPulseTone {
  if (metric.availability === 'FAILED' || metric.freshness === 'FAILED' || metric.quality === 'INVALID') {
    return 'danger';
  }
  if (
    metric.availability === 'BLOCKED'
    || metric.availability === 'EMPTY'
    || metric.freshness === 'STALE'
    || metric.freshness === 'DEGRADED'
    || metric.freshness === 'NEVER'
    || metric.quality === 'WARNING'
  ) {
    return 'warning';
  }
  if (metric.availability === 'SHADOW' || metric.freshness === 'REFRESHING') {
    return 'information';
  }
  if (metric.availability === 'READY' && metric.freshness === 'CURRENT' && metric.quality === 'TRUSTED') {
    return 'success';
  }
  return 'neutral';
}

export function formatOperationalPulseMoment(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}
