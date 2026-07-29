export type AnalyticsVisualTone = 'success' | 'warning' | 'danger' | 'information' | 'neutral';

export type AnalyticsSeriesDatum = {
  key: string;
  label: string;
  value: number | null;
};

export type AnalyticsSeriesIssue = {
  code: 'INVALID_KEY' | 'INVALID_LABEL' | 'INVALID_VALUE';
  index: number;
  value?: string;
};

export type AnalyticsNormalisedSeries = {
  data: AnalyticsSeriesDatum[];
  issues: AnalyticsSeriesIssue[];
  domain: { min: number; max: number } | null;
};

export type AnalyticsLinePoint = AnalyticsSeriesDatum & {
  index: number;
  x: number;
  y: number | null;
};

export type AnalyticsLineSegment = {
  key: string;
  points: readonly AnalyticsLinePoint[];
};

export type AnalyticsLineGeometry = {
  width: number;
  height: number;
  padding: number;
  domain: { min: number; max: number } | null;
  points: readonly AnalyticsLinePoint[];
  segments: readonly AnalyticsLineSegment[];
  issues: readonly AnalyticsSeriesIssue[];
};

export type AnalyticsBarGeometryRow = AnalyticsSeriesDatum & {
  index: number;
  startPercent: number | null;
  widthPercent: number | null;
  direction: 'positive' | 'negative' | 'zero' | 'missing';
};

export type AnalyticsBarGeometry = {
  domain: { min: number; max: number } | null;
  zeroPercent: number;
  rows: readonly AnalyticsBarGeometryRow[];
  issues: readonly AnalyticsSeriesIssue[];
};

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function expandedDomain(values: readonly number[]): { min: number; max: number } | null {
  if (!values.length) return null;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum !== maximum) return { min: minimum, max: maximum };
  const padding = Math.abs(minimum) * 0.1 || 1;
  return { min: minimum - padding, max: maximum + padding };
}

export function normaliseAnalyticsSeries(
  input: readonly { key: string; label: string; value: unknown }[],
): AnalyticsNormalisedSeries {
  const issues: AnalyticsSeriesIssue[] = [];
  const data = input.map((datum, index) => {
    const key = typeof datum.key === 'string' ? datum.key.trim() : '';
    const label = typeof datum.label === 'string' ? datum.label.trim() : '';
    if (!key) issues.push({ code: 'INVALID_KEY', index, value: String(datum.key) });
    if (!label) issues.push({ code: 'INVALID_LABEL', index, value: String(datum.label) });
    const value = finiteNumber(datum.value);
    if (datum.value !== null && datum.value !== undefined && datum.value !== '' && value === null) {
      issues.push({ code: 'INVALID_VALUE', index, value: String(datum.value).slice(0, 120) });
    }
    return {
      key: key || `datum-${index + 1}`,
      label: label || key || `Datum ${index + 1}`,
      value,
    };
  });
  const values = data.map((datum) => datum.value).filter((value): value is number => value !== null);
  return { data, issues, domain: expandedDomain(values) };
}

function boundedDimension(value: number, fallback: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

export function buildAnalyticsLineGeometry(
  input: readonly { key: string; label: string; value: unknown }[],
  options: { width?: number; height?: number; padding?: number } = {},
): AnalyticsLineGeometry {
  const normalised = normaliseAnalyticsSeries(input);
  const width = boundedDimension(options.width ?? 720, 720, 120);
  const height = boundedDimension(options.height ?? 260, 260, 80);
  const padding = Math.min(
    boundedDimension(options.padding ?? 24, 24, 0),
    Math.max(0, Math.min(width, height) / 3),
  );
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  const denominator = Math.max(1, normalised.data.length - 1);
  const points = normalised.data.map((datum, index): AnalyticsLinePoint => {
    const x = normalised.data.length === 1
      ? padding + innerWidth / 2
      : padding + (index / denominator) * innerWidth;
    if (datum.value === null || !normalised.domain) return { ...datum, index, x, y: null };
    const ratio = (datum.value - normalised.domain.min) / (normalised.domain.max - normalised.domain.min);
    return { ...datum, index, x, y: padding + innerHeight - ratio * innerHeight };
  });

  const segments: AnalyticsLineSegment[] = [];
  let current: AnalyticsLinePoint[] = [];
  points.forEach((point) => {
    if (point.y === null) {
      if (current.length) segments.push({ key: `segment-${segments.length + 1}`, points: current });
      current = [];
      return;
    }
    current.push(point);
  });
  if (current.length) segments.push({ key: `segment-${segments.length + 1}`, points: current });

  return {
    width,
    height,
    padding,
    domain: normalised.domain,
    points,
    segments,
    issues: normalised.issues,
  };
}

export function buildAnalyticsBarGeometry(
  input: readonly { key: string; label: string; value: unknown }[],
): AnalyticsBarGeometry {
  const normalised = normaliseAnalyticsSeries(input);
  const values = normalised.data.map((datum) => datum.value).filter((value): value is number => value !== null);
  if (!values.length) {
    return {
      domain: null,
      zeroPercent: 0,
      rows: normalised.data.map((datum, index) => ({
        ...datum,
        index,
        startPercent: null,
        widthPercent: null,
        direction: 'missing',
      })),
      issues: normalised.issues,
    };
  }

  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const domain = minimum === maximum ? { min: minimum, max: maximum + 1 } : { min: minimum, max: maximum };
  const span = domain.max - domain.min;
  const zeroPercent = ((0 - domain.min) / span) * 100;
  const rows = normalised.data.map((datum, index): AnalyticsBarGeometryRow => {
    if (datum.value === null) {
      return { ...datum, index, startPercent: null, widthPercent: null, direction: 'missing' };
    }
    const valuePercent = ((datum.value - domain.min) / span) * 100;
    if (datum.value === 0) {
      return { ...datum, index, startPercent: zeroPercent, widthPercent: 0, direction: 'zero' };
    }
    return {
      ...datum,
      index,
      startPercent: Math.min(zeroPercent, valuePercent),
      widthPercent: Math.abs(valuePercent - zeroPercent),
      direction: datum.value > 0 ? 'positive' : 'negative',
    };
  });

  return { domain, zeroPercent, rows, issues: normalised.issues };
}

export function buildAnalyticsNumericTicks(
  domain: { min: number; max: number } | null,
  count = 5,
): readonly number[] {
  if (!domain) return [];
  const boundedCount = Math.max(2, Math.min(8, Math.trunc(count)));
  return Array.from({ length: boundedCount }, (_, index) => (
    domain.min + ((domain.max - domain.min) * index) / (boundedCount - 1)
  ));
}

export function selectAnalyticsLabelTicks(
  dataLength: number,
  maximum = 6,
): readonly number[] {
  const length = Math.max(0, Math.trunc(dataLength));
  if (!length) return [];
  const count = Math.max(2, Math.min(length, Math.trunc(maximum)));
  if (length <= count) return Array.from({ length }, (_, index) => index);
  return Array.from(new Set(
    Array.from({ length: count }, (_, index) => Math.round((index * (length - 1)) / (count - 1))),
  ));
}

export function analyticsPath(points: readonly AnalyticsLinePoint[]): string {
  return points
    .filter((point): point is AnalyticsLinePoint & { y: number } => point.y !== null)
    .map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
}
