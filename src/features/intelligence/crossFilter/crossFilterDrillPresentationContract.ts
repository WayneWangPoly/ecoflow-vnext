import type {
  OperationalPulseMetricKey,
} from '@/features/intelligence/operationalPulse/operationalPulseContract.ts';
import type {
  CrossFilterAffectedEntity,
  CrossFilterBreakdown,
  CrossFilterDrillModel,
} from './crossFilterDrillContract';

export type CrossFilterDrillPresentationTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'information'
  | 'neutral';

export type CrossFilterDrillStatePresentation = {
  label: string;
  title: string;
  description: string;
  tone: CrossFilterDrillPresentationTone;
};

const OPERATIONAL_PULSE_METRIC_LABELS = {
  revenue: 'Revenue',
  gross_margin: 'Gross margin',
  fill_rate: 'Fill rate',
  on_time_delivery_rate: 'On-time delivery rate',
  stockout_risk_count: 'Stockout risk count',
  dead_stock_value: 'Dead stock value',
  substitution_rate: 'Substitution rate',
  lines_picked_per_hour: 'Lines picked per hour',
  inventory_days_of_cover: 'Inventory days of cover',
  customer_concentration: 'Customer concentration',
} satisfies Record<OperationalPulseMetricKey, string>;

export function crossFilterDrillMetricLabel(model: CrossFilterDrillModel): string {
  return model.metricKey ? OPERATIONAL_PULSE_METRIC_LABELS[model.metricKey] : 'Unknown metric';
}

export function crossFilterDrillStatePresentation(
  model: CrossFilterDrillModel,
): CrossFilterDrillStatePresentation {
  if (model.state === 'ready') {
    return {
      label: 'DRILL READY',
      title: 'Governed breakdown available',
      description: 'Select a breakdown value to review its verified affected entities.',
      tone: 'information',
    };
  }
  if (model.state === 'partial') {
    return {
      label: 'PARTIAL DRILL',
      title: 'Validated drill data is incomplete',
      description: 'Only the breakdowns and entities that passed the governed contract are shown.',
      tone: 'warning',
    };
  }
  if (model.state === 'empty') {
    return {
      label: 'NO BREAKDOWNS',
      title: 'No governed breakdown values',
      description: 'The metric is drillable, but no breakdown values were returned.',
      tone: 'neutral',
    };
  }
  if (model.state === 'blocked') {
    return {
      label: 'DRILL BLOCKED',
      title: 'Cross-filter drill is unavailable',
      description: 'The metric or drill capability is not authorised for governed drill-through.',
      tone: 'warning',
    };
  }
  return {
    label: 'DRILL INVALID',
    title: 'Cross-filter drill data is invalid',
    description: 'No breakdown or affected-entity data can be trusted from this response.',
    tone: 'danger',
  };
}

export function resolveCrossFilterBreakdown(
  model: CrossFilterDrillModel,
  requestedKey?: string | null,
): CrossFilterBreakdown | null {
  if ((model.state !== 'ready' && model.state !== 'partial') || model.breakdowns.length === 0) {
    return null;
  }
  const candidate = requestedKey?.trim();
  if (candidate) {
    return model.breakdowns.find((breakdown) => breakdown.key === candidate) ?? null;
  }
  return model.breakdowns[0] ?? null;
}

export function crossFilterBreakdownMeta(breakdown: CrossFilterBreakdown): string {
  const visible = breakdown.entities.length;
  if (breakdown.truncated) return `${visible} routed of ${breakdown.affectedCount} affected`;
  return `${breakdown.affectedCount} affected`;
}

export function crossFilterEntityKindLabel(entity: CrossFilterAffectedEntity): string {
  if (entity.entity.kind === 'order') return 'Order';
  if (entity.entity.kind === 'commercial-sku') return 'Commercial SKU';
  if (entity.entity.kind === 'physical-sku') return 'Physical SKU';
  if (entity.entity.kind === 'customer') return 'Customer';
  if (entity.entity.kind === 'store') return 'Store';
  return 'Delivery run';
}

export function crossFilterOperationalRouteLabel(entity: CrossFilterAffectedEntity): string {
  const workspace = entity.operationalRoute.workspace;
  if (workspace === 'orders') return 'Open Orders';
  if (workspace === 'inventory') return 'Open Inventory';
  if (workspace === 'customers') return 'Open Customers';
  if (workspace === 'stores') return 'Open Stores';
  return 'Open Delivery';
}
