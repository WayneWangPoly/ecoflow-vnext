import type { AnalyticsMetricReadinessRow } from './metricReadinessContract';
import {
  buildOperationalPulseDeck,
  operationalPulseMetricKeys,
  type OperationalPulseAvailability,
  type OperationalPulseDeck,
  type OperationalPulseMetricInput,
} from '../operationalPulse/operationalPulseContract';

export type OperationalPulseReadinessSummary = {
  total: number;
  ready: number;
  shadow: number;
  blocked: number;
  unavailable: number;
};

function availabilityFor(row: AnalyticsMetricReadinessRow): OperationalPulseAvailability {
  if (row.projectionStatus === 'READY') return 'READY';
  if (row.projectionStatus === 'SHADOW') return 'SHADOW';
  if (row.projectionStatus === 'BLOCKED') return 'BLOCKED';
  return 'UNAVAILABLE';
}

export function readinessRowsToOperationalPulse(
  rows: readonly AnalyticsMetricReadinessRow[],
): OperationalPulseDeck {
  const inputs: OperationalPulseMetricInput[] = rows.map((row) => ({
    metricKey: row.metricKey,
    displayName: row.displayName,
    unitKind: row.unitKind,
    availability: availabilityFor(row),
    value: null,
    displayValue: null,
    freshness: 'UNKNOWN',
    quality: row.metricStatus === 'ACTIVE' ? 'TRUSTED' : 'UNKNOWN',
    asOfAt: row.readinessUpdatedAt,
    blockerCodes: row.blockerCodes,
  }));
  return buildOperationalPulseDeck(inputs);
}

export function operationalPulseReadinessSummary(
  deck: OperationalPulseDeck,
): OperationalPulseReadinessSummary {
  const summary: OperationalPulseReadinessSummary = {
    total: deck.metrics.length,
    ready: 0,
    shadow: 0,
    blocked: 0,
    unavailable: 0,
  };
  for (const metric of deck.metrics) {
    if (metric.availability === 'READY') summary.ready += 1;
    else if (metric.availability === 'SHADOW') summary.shadow += 1;
    else if (metric.availability === 'BLOCKED') summary.blocked += 1;
    else summary.unavailable += 1;
  }
  return summary;
}

export function hasCanonicalOperationalPulseCoverage(deck: OperationalPulseDeck): boolean {
  return deck.metrics.length === operationalPulseMetricKeys.length
    && operationalPulseMetricKeys.every((metricKey, index) => deck.metrics[index]?.metricKey === metricKey);
}
