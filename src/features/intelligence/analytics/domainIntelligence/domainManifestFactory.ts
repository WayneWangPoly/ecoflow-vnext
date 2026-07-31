import {
  phase4SurfaceCapabilities,
  type Phase4Capability,
  type Phase4DataState,
  type Phase4SurfaceCapability,
} from './domainIntelligenceContract';

const capabilityLabels: Readonly<Record<Phase4SurfaceCapability, string>> = {
  OVERVIEW: 'Domain overview',
  FILTERS: 'Governed filters',
  TREND: 'Governed trend',
  BREAKDOWN: 'Governed breakdown',
  TABLE: 'Domain tables',
  DETAIL_DRAWER: 'Detail drawer',
  TIMELINE: 'Domain timeline',
  FRESHNESS: 'Freshness evidence',
  EMPTY_DEGRADED_STATES: 'Empty and degraded states',
  OPERATIONAL_HANDOFF: 'Operational handoff',
};

type CapabilityOverride = {
  label?: string;
  data?: Phase4DataState;
  evidence?: string;
  blocker?: string;
};

export function createPhase4Capabilities(input: {
  domainLabel: string;
  defaultData: Phase4DataState;
  overrides?: Partial<Record<Phase4SurfaceCapability, CapabilityOverride>>;
}): readonly Phase4Capability[] {
  return phase4SurfaceCapabilities.map((key) => {
    const override = input.overrides?.[key];
    return {
      key,
      label: override?.label ?? capabilityLabels[key],
      implementation: 'READY',
      data: override?.data ?? input.defaultData,
      evidence: override?.evidence ?? `${input.domainLabel} publishes a bounded ${capabilityLabels[key].toLowerCase()} contract without client-side business inference.`,
      blocker: override?.blocker,
    };
  });
}
