import {
  operationalPulseMetricKeys,
} from '../operationalPulse/operationalPulseContract.ts';
import type {
  MetricDrillAccessCapability,
  MetricDrillAccessRecord,
} from './metricDrillAccessContract.ts';

export type MetricDrillAccessTone = 'success' | 'warning' | 'neutral';

export type MetricDrillAccessSummary = {
  total: number;
  available: number;
  unavailable: number;
  unknown: number;
  issueCount: number;
  canonicalCoverage: boolean;
  readAt: string | null;
};

export function metricDrillAccessSummary(
  rows: readonly MetricDrillAccessRecord[],
  issueCount = 0,
): MetricDrillAccessSummary {
  const readTimes = new Set(rows.map((row) => row.readAt));
  return {
    total: rows.length,
    available: rows.filter((row) => row.drillCapability === 'AVAILABLE').length,
    unavailable: rows.filter((row) => row.drillCapability === 'UNAVAILABLE').length,
    unknown: rows.filter((row) => row.drillCapability === 'UNKNOWN').length,
    issueCount,
    canonicalCoverage: rows.length === operationalPulseMetricKeys.length
      && operationalPulseMetricKeys.every(
        (metricKey, index) => rows[index]?.metricKey === metricKey,
      ),
    readAt: readTimes.size === 1 ? rows[0]?.readAt ?? null : null,
  };
}

export function metricDrillAccessCapabilityLabel(
  capability: MetricDrillAccessCapability,
): string {
  if (capability === 'AVAILABLE') return 'AVAILABLE';
  if (capability === 'UNAVAILABLE') return 'UNAVAILABLE';
  return 'UNKNOWN';
}

export function metricDrillAccessCapabilityTone(
  capability: MetricDrillAccessCapability,
): MetricDrillAccessTone {
  if (capability === 'AVAILABLE') return 'success';
  if (capability === 'UNKNOWN') return 'warning';
  return 'neutral';
}

export function metricDrillAccessListLabel(values: readonly string[]): string {
  return values.length ? values.join(' · ') : '—';
}

export function formatMetricDrillAccessMoment(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
