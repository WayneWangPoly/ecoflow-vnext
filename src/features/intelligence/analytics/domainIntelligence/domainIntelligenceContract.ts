export const phase4DomainOrder = [
  'inventory',
  'orders',
  'customers',
  'delivery',
  'returns',
  'data-quality',
] as const;

export type Phase4DomainId = (typeof phase4DomainOrder)[number];

export const phase4SurfaceCapabilities = [
  'OVERVIEW',
  'FILTERS',
  'TREND',
  'BREAKDOWN',
  'TABLE',
  'DETAIL_DRAWER',
  'TIMELINE',
  'FRESHNESS',
  'EMPTY_DEGRADED_STATES',
  'OPERATIONAL_HANDOFF',
] as const;

export type Phase4SurfaceCapability = (typeof phase4SurfaceCapabilities)[number];
export type Phase4ImplementationState = 'READY' | 'PARTIAL' | 'UNAVAILABLE';
export type Phase4DataState = 'READY' | 'SHADOW' | 'BLOCKED' | 'UNAVAILABLE';

export type Phase4Capability = {
  key: Phase4SurfaceCapability;
  label: string;
  implementation: Phase4ImplementationState;
  data: Phase4DataState;
  evidence: string;
  blocker?: string;
};

export type Phase4Breakdown = {
  key: string;
  label: string;
  data: Phase4DataState;
  description: string;
};

export type Phase4Trend = {
  key: string;
  label: string;
  data: Phase4DataState;
  value: number | null;
  formattedValue: string | null;
  sourceAsOfAt: string | null;
};

export type Phase4TableDefinition = {
  key: string;
  label: string;
  grain: string;
  columns: readonly string[];
  data: Phase4DataState;
};

export type Phase4Handoff = {
  key: string;
  label: string;
  pathTemplate: string;
  workspace: string;
};

export type Phase4TimelineEntry = {
  key: string;
  label: string;
  state: Phase4ImplementationState;
  evidence: string;
};

export type Phase4DomainManifest = {
  id: Phase4DomainId;
  eyebrow: string;
  title: string;
  summary: string;
  primaryPath: string;
  implementation: Phase4ImplementationState;
  data: Phase4DataState;
  capabilities: readonly Phase4Capability[];
  breakdowns: readonly Phase4Breakdown[];
  trends: readonly Phase4Trend[];
  tables: readonly Phase4TableDefinition[];
  handoffs: readonly Phase4Handoff[];
  timeline: readonly Phase4TimelineEntry[];
  freshness: {
    state: Phase4DataState;
    sourceAsOfAt: string | null;
    serverReadAt: string | null;
    message: string;
  };
};

export type Phase4ManifestIssue = {
  code:
    | 'CAPABILITY_COVERAGE_INVALID'
    | 'CAPABILITY_ORDER_INVALID'
    | 'DUPLICATE_CAPABILITY'
    | 'INVALID_PRIMARY_PATH'
    | 'INVALID_HANDOFF_PATH'
    | 'READY_DATA_WITHOUT_TIMESTAMP'
    | 'DUPLICATE_DOMAIN';
  domain: Phase4DomainId;
  key?: string;
};

export type Phase4ManifestValidation = {
  ok: boolean;
  issues: readonly Phase4ManifestIssue[];
};

function isCanonicalPath(value: string): boolean {
  return value.startsWith('/') && !value.includes('?') && !value.includes('#') && !value.includes('//');
}

export function validatePhase4DomainManifest(manifest: Phase4DomainManifest): Phase4ManifestValidation {
  const issues: Phase4ManifestIssue[] = [];
  const seen = new Set<Phase4SurfaceCapability>();

  manifest.capabilities.forEach((capability, index) => {
    if (seen.has(capability.key)) {
      issues.push({ code: 'DUPLICATE_CAPABILITY', domain: manifest.id, key: capability.key });
    }
    seen.add(capability.key);
    if (phase4SurfaceCapabilities[index] !== capability.key) {
      issues.push({ code: 'CAPABILITY_ORDER_INVALID', domain: manifest.id, key: capability.key });
    }
  });

  if (manifest.capabilities.length !== phase4SurfaceCapabilities.length
    || phase4SurfaceCapabilities.some((capability) => !seen.has(capability))) {
    issues.push({ code: 'CAPABILITY_COVERAGE_INVALID', domain: manifest.id });
  }

  if (!isCanonicalPath(manifest.primaryPath)) {
    issues.push({ code: 'INVALID_PRIMARY_PATH', domain: manifest.id, key: manifest.primaryPath });
  }

  manifest.handoffs.forEach((handoff) => {
    if (!isCanonicalPath(handoff.pathTemplate)) {
      issues.push({ code: 'INVALID_HANDOFF_PATH', domain: manifest.id, key: handoff.key });
    }
  });

  if (manifest.data === 'READY'
    && (!manifest.freshness.sourceAsOfAt || !manifest.freshness.serverReadAt)) {
    issues.push({ code: 'READY_DATA_WITHOUT_TIMESTAMP', domain: manifest.id });
  }

  return { ok: issues.length === 0, issues };
}

export function validatePhase4DomainRegistry(
  manifests: readonly Phase4DomainManifest[],
): Phase4ManifestValidation {
  const issues: Phase4ManifestIssue[] = [];
  const seen = new Set<Phase4DomainId>();
  manifests.forEach((manifest) => {
    if (seen.has(manifest.id)) {
      issues.push({ code: 'DUPLICATE_DOMAIN', domain: manifest.id });
    }
    seen.add(manifest.id);
    issues.push(...validatePhase4DomainManifest(manifest).issues);
  });
  return { ok: issues.length === 0, issues };
}

export function phase4ImplementationCoverage(manifests: readonly Phase4DomainManifest[]) {
  const capabilityTotal = manifests.length * phase4SurfaceCapabilities.length;
  const capabilityReady = manifests.reduce(
    (total, manifest) => total + manifest.capabilities.filter((item) => item.implementation === 'READY').length,
    0,
  );
  return {
    domainCount: manifests.length,
    capabilityTotal,
    capabilityReady,
    complete: manifests.length === phase4DomainOrder.length && capabilityReady === capabilityTotal,
  } as const;
}
