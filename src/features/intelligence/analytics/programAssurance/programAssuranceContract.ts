import type { IntelligenceReleaseFlag } from '../releaseReadiness/releaseReadinessContract';

export const intelligenceProgramQualityPillars = [
  'DATA_CORRECTNESS',
  'UI_INTERACTION',
  'OPERATIONAL_SAFETY',
  'PERFORMANCE',
  'ACCESSIBILITY',
  'RELEASE_CONTROL',
] as const;
export type IntelligenceProgramQualityPillar = (typeof intelligenceProgramQualityPillars)[number];

export const intelligenceProgramQualityEvidence = [
  {
    key: 'DATA_CORRECTNESS',
    title: 'Data correctness',
    requirement: 'Metric grain, freshness, historical correction and Commercial/Physical SKU identity remain explicit.',
    evidence: 'Semantic foundation, metric readiness, domain intelligence and data-quality gates.',
  },
  {
    key: 'UI_INTERACTION',
    title: 'UI interaction',
    requirement: 'Routes, URL state, drill paths, drawers, inspectors, keyboard and mobile presentation preserve context.',
    evidence: 'Frontend foundation, Control Room, domain workspace and overlay contracts.',
  },
  {
    key: 'OPERATIONAL_SAFETY',
    title: 'Operational safety',
    requirement: 'Analytics remains read-only except for explicitly migrated server commands with revision and idempotency.',
    evidence: 'Action Integration gate and operational safety continuity workflow.',
  },
  {
    key: 'PERFORMANCE',
    title: 'Performance',
    requirement: 'Production bundles and canonical deep routes remain inside approved build and delivery budgets.',
    evidence: 'Phase 8 bundle budget and route smoke checks.',
  },
  {
    key: 'ACCESSIBILITY',
    title: 'Accessibility',
    requirement: 'Status is not colour-only; keyboard, labels, focus, reduced motion and responsive touch layouts are retained.',
    evidence: 'Design-system, overlay, workspace and Phase 8 accessibility audits.',
  },
  {
    key: 'RELEASE_CONTROL',
    title: 'Release control',
    requirement: 'Feature flags, shadow evidence, cutover and rollback remain revisioned, idempotent and fail closed.',
    evidence: 'Release Verification & Cutover gate and PostgreSQL command contracts.',
  },
] as const satisfies readonly {
  key: IntelligenceProgramQualityPillar;
  title: string;
  requirement: string;
  evidence: string;
}[];

export type IntelligenceCompletionDependency = 'NONE' | 'SHADOW_EVIDENCE' | 'CUTOVER_PER_FLAG';

export type IntelligenceFinalCompletionOutcome = {
  key: string;
  order: number;
  title: string;
  requirement: string;
  pillar: IntelligenceProgramQualityPillar;
  evidence: string;
  engineeringState: 'COMPLETE';
  productionDependency: IntelligenceCompletionDependency;
};

export const intelligenceFinalCompletionOutcomes = [
  {
    key: 'DECISION_FIRST_OWNER_ENTRY',
    order: 1,
    title: 'Decision-first Owner entry',
    requirement: 'Owner first sees the business problems that require a decision or intervention today.',
    pillar: 'UI_INTERACTION',
    evidence: 'Control Room 2.0 Operational Pulse, Attention Queue and Priority Work.',
    engineeringState: 'COMPLETE',
    productionDependency: 'CUTOVER_PER_FLAG',
  },
  {
    key: 'METRIC_TO_CAUSE_TO_ENTITY',
    order: 2,
    title: 'Metric to cause to entity',
    requirement: 'Every governed metric can drill to a cause and then to the affected order, SKU, customer or route.',
    pillar: 'UI_INTERACTION',
    evidence: 'Cross-filter, drill access, detail drawer and operational handoff contracts.',
    engineeringState: 'COMPLETE',
    productionDependency: 'SHADOW_EVIDENCE',
  },
  {
    key: 'CONTEXT_PRESERVATION',
    order: 3,
    title: 'Context preservation',
    requirement: 'Detail review preserves filters, analysis state, copied URL and browser Back/Forward behaviour.',
    pillar: 'UI_INTERACTION',
    evidence: 'Native routes, URL query state and overlay navigation foundation.',
    engineeringState: 'COMPLETE',
    productionDependency: 'SHADOW_EVIDENCE',
  },
  {
    key: 'CONSISTENT_METRIC_DEFINITION',
    order: 4,
    title: 'Consistent metric definition',
    requirement: 'Dashboard, Customer, Inventory and Delivery use the same approved semantic definition and grain.',
    pillar: 'DATA_CORRECTNESS',
    evidence: 'Metric registry, analytics schema and typed readiness repository.',
    engineeringState: 'COMPLETE',
    productionDependency: 'SHADOW_EVIDENCE',
  },
  {
    key: 'COMMERCIAL_PHYSICAL_SEPARATION',
    order: 5,
    title: 'Commercial and Physical SKU separation',
    requirement: 'Customer demand and the physical brand actually fulfilled remain separate and analytically connected.',
    pillar: 'DATA_CORRECTNESS',
    evidence: 'Semantic dimensions, fulfilment facts and Inventory & Substitution Intelligence.',
    engineeringState: 'COMPLETE',
    productionDependency: 'SHADOW_EVIDENCE',
  },
  {
    key: 'BACKGROUND_ANALYTICS_SOURCE',
    order: 6,
    title: 'Background analytics source',
    requirement: 'Trend analysis reads governed analytics facts and does not call Ordermentum from the browser.',
    pillar: 'DATA_CORRECTNESS',
    evidence: 'Analytics repository boundary and production data boundary audits.',
    engineeringState: 'COMPLETE',
    productionDependency: 'SHADOW_EVIDENCE',
  },
  {
    key: 'NO_FALSE_ZERO_OR_DEMO',
    order: 7,
    title: 'No false zero or demo fallback',
    requirement: 'Interrupted, stale, invalid or missing evidence remains degraded or unavailable rather than numeric zero.',
    pillar: 'DATA_CORRECTNESS',
    evidence: 'Metric readiness, domain manifests, release checks and no-demo/no-silent-zero contracts.',
    engineeringState: 'COMPLETE',
    productionDependency: 'SHADOW_EVIDENCE',
  },
  {
    key: 'LAYERED_WORKSPACE_MODEL',
    order: 8,
    title: 'Layered workspace model',
    requirement: 'The interface uses workspace, drawer, inspector, commit modal and full-screen task boundaries instead of flat card sprawl.',
    pillar: 'ACCESSIBILITY',
    evidence: 'Design system, Overlay Manager and native task-route contracts.',
    engineeringState: 'COMPLETE',
    productionDependency: 'SHADOW_EVIDENCE',
  },
  {
    key: 'SAFE_INSIGHT_TO_ACTION',
    order: 9,
    title: 'Safe insight to action',
    requirement: 'Analysis reaches real operational work without bypassing the domain command or server acknowledgement boundary.',
    pillar: 'OPERATIONAL_SAFETY',
    evidence: 'Action Handoff and Safe Inline Actions gate.',
    engineeringState: 'COMPLETE',
    productionDependency: 'CUTOVER_PER_FLAG',
  },
  {
    key: 'NATIVE_REACT_OWNERSHIP',
    order: 10,
    title: 'Native React ownership',
    requirement: 'New Intelligence capability is owned by native routes and components without expanding enhancer debt.',
    pillar: 'OPERATIONAL_SAFETY',
    evidence: 'Frontend foundation and repository hygiene audits.',
    engineeringState: 'COMPLETE',
    productionDependency: 'NONE',
  },
  {
    key: 'ROLE_SPECIFIC_SHARED_FACTS',
    order: 11,
    title: 'Role-specific shared facts',
    requirement: 'Owner, Account, Warehouse and Driver use the same business facts while receiving role-appropriate access and presentation.',
    pillar: 'ACCESSIBILITY',
    evidence: 'Analytics access control, release-readiness access envelope and domain handoff boundaries.',
    engineeringState: 'COMPLETE',
    productionDependency: 'SHADOW_EVIDENCE',
  },
  {
    key: 'ECOFLOW_OPERATIONAL_INTELLIGENCE',
    order: 12,
    title: 'EcoFlow operational intelligence',
    requirement: 'EcoFlow provides its own decision and operational intelligence instead of reproducing a generic BI product.',
    pillar: 'RELEASE_CONTROL',
    evidence: 'Semantic foundation through governed release control, with no report builder or arbitrary-query surface.',
    engineeringState: 'COMPLETE',
    productionDependency: 'CUTOVER_PER_FLAG',
  },
] as const satisfies readonly IntelligenceFinalCompletionOutcome[];

export const intelligenceCanonicalSmokeRoutes = [
  '/control-room',
  '/orders',
  '/inventory',
  '/customers',
  '/delivery',
  '/returns',
  '/exceptions',
  '/analytics',
  '/settings',
] as const;

export const intelligencePerformanceBudgets = {
  largestJavaScriptBytes: 750_000,
  totalJavaScriptBytes: 1_600_000,
  largestCssBytes: 320_000,
  totalCssBytes: 800_000,
  totalAssetCount: 160,
  indexHtmlBytes: 6_000,
} as const;

export function validateIntelligenceProgramAssurance(): string[] {
  const issues: string[] = [];
  const outcomeKeys = new Set<string>();
  const orders = new Set<number>();
  for (const outcome of intelligenceFinalCompletionOutcomes) {
    if (outcomeKeys.has(outcome.key)) issues.push(`DUPLICATE_OUTCOME:${outcome.key}`);
    if (orders.has(outcome.order)) issues.push(`DUPLICATE_ORDER:${outcome.order}`);
    if (!intelligenceProgramQualityPillars.includes(outcome.pillar)) issues.push(`INVALID_PILLAR:${outcome.key}`);
    if (outcome.engineeringState !== 'COMPLETE') issues.push(`INCOMPLETE_ENGINEERING:${outcome.key}`);
    outcomeKeys.add(outcome.key);
    orders.add(outcome.order);
  }
  if (intelligenceFinalCompletionOutcomes.length !== 12) issues.push('OUTCOME_CARDINALITY');
  if (intelligenceProgramQualityEvidence.length !== intelligenceProgramQualityPillars.length) issues.push('PILLAR_CARDINALITY');
  if (intelligenceCanonicalSmokeRoutes.length !== 9) issues.push('ROUTE_CARDINALITY');
  return issues;
}

export function intelligenceProgramCompletionSummary(flags: readonly IntelligenceReleaseFlag[]) {
  const on = flags.filter((flag) => flag.rolloutState === 'ON').length;
  const shadow = flags.filter((flag) => flag.rolloutState === 'SHADOW').length;
  const off = flags.filter((flag) => flag.rolloutState === 'OFF').length;
  const productionState = flags.length === 0
    ? 'NOT_AVAILABLE'
    : on === flags.length
      ? 'FULL_CUTOVER'
      : on > 0
        ? 'PARTIAL_CUTOVER'
        : shadow > 0
          ? 'SHADOW'
          : 'LEGACY_ONLY';
  return {
    engineeringComplete: intelligenceFinalCompletionOutcomes.filter((outcome) => outcome.engineeringState === 'COMPLETE').length,
    engineeringTotal: intelligenceFinalCompletionOutcomes.length,
    qualityPillarsComplete: intelligenceProgramQualityEvidence.length,
    qualityPillarsTotal: intelligenceProgramQualityPillars.length,
    releaseFlagsAvailable: flags.length,
    on,
    shadow,
    off,
    productionState,
  } as const;
}
