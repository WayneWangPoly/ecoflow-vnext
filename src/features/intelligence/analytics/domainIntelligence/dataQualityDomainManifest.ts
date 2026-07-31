import type { Phase4DomainManifest } from './domainIntelligenceContract';
import { createPhase4Capabilities } from './domainManifestFactory';

export const dataQualityDomainManifest: Phase4DomainManifest = {
  id: 'data-quality',
  eyebrow: 'DATA QUALITY INTELLIGENCE',
  title: 'Data quality intelligence',
  summary: 'Source health, stale data, missing mappings, barcode conflicts, incomplete customer records, missing cost and unavailable metrics remain explicit operational evidence.',
  primaryPath: '/analytics',
  implementation: 'READY',
  data: 'SHADOW',
  capabilities: createPhase4Capabilities({
    domainLabel: 'Data quality',
    defaultData: 'SHADOW',
    overrides: {
      OVERVIEW: { data: 'READY', evidence: 'Existing analytics health, refresh, quality and metric-readiness contracts provide the governed overview.' },
      FILTERS: { data: 'READY', evidence: 'Severity, source, dataset, finding type, status and detection-time filters remain bounded.' },
      TREND: { data: 'BLOCKED', evidence: 'Finding-volume and stale-source trends remain null without an authorised quality-history projection.', blocker: 'No authorised data-quality time series.' },
      TABLE: { data: 'READY', evidence: 'Quality findings, refresh status and metric readiness retain distinct governed table grains.' },
      DETAIL_DRAWER: { data: 'READY', evidence: 'Finding evidence and related operational identities open read-only without mutating source records.' },
      FRESHNESS: { data: 'READY', evidence: 'Dataset source-as-of and server-read timestamps are represented only when supplied by the analytics envelope.' },
      EMPTY_DEGRADED_STATES: { data: 'READY', evidence: 'Unavailable metric, stale source, missing mapping and confirmed zero remain semantically distinct.' },
      OPERATIONAL_HANDOFF: { data: 'READY', evidence: 'Analytics, Exceptions and Reconciliation routes are published without silently resolving findings.' },
    },
  }),
  breakdowns: [
    { key: 'sync-health', label: 'Sync health and stale source', data: 'READY', description: 'Current, degraded, failed and unknown refresh states remain explicit.' },
    { key: 'missing-records', label: 'Missing invoice, mapping and cost', data: 'SHADOW', description: 'Required evidence is classified by dataset and business impact.' },
    { key: 'identity-conflicts', label: 'Barcode and identity conflicts', data: 'SHADOW', description: 'Conflicting barcode, incomplete customer and ambiguous mapping evidence.' },
    { key: 'metric-readiness', label: 'Metric unavailable and snapshot refresh', data: 'READY', description: 'Ready, Shadow, Blocked, unavailable and refresh states remain governed.' },
  ],
  trends: [
    { key: 'quality-findings', label: 'Quality finding volume', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
    { key: 'stale-sources', label: 'Stale source trend', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
    { key: 'refresh-failures', label: 'Snapshot refresh failure trend', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
  ],
  tables: [
    { key: 'quality-findings', label: 'Data quality findings', grain: 'one governed quality finding', columns: ['Finding', 'severity', 'source', 'dataset', 'entity', 'detected', 'status', 'impact'], data: 'READY' },
    { key: 'refresh-status', label: 'Dataset refresh status', grain: 'one governed dataset refresh', columns: ['Dataset', 'state', 'source as of', 'server read', 'rows', 'issue', 'owner'], data: 'READY' },
    { key: 'metric-readiness', label: 'Metric readiness', grain: 'one governed metric identity', columns: ['Metric', 'state', 'projection', 'quality', 'freshness', 'blocker', 'evidence'], data: 'READY' },
  ],
  handoffs: [
    { key: 'analytics', label: 'Analytics workspace', pathTemplate: '/analytics', workspace: 'analytics' },
    { key: 'exceptions', label: 'Exceptions workspace', pathTemplate: '/exceptions', workspace: 'exceptions' },
    { key: 'reconciliation', label: 'Reconciliation workspace', pathTemplate: '/reconciliation', workspace: 'reconciliation' },
  ],
  timeline: [
    { key: 'health-contract', label: 'Analytics health and quality contracts', state: 'READY', evidence: 'Health, refresh, quality and metric readiness distinguish unknown, stale, partial and failed states.' },
    { key: 'no-fake-zero', label: 'No silent zero contract', state: 'READY', evidence: 'Null, invalid, unavailable and not-comparable evidence never becomes numeric zero.' },
    { key: 'domain-review', label: 'Data quality domain review', state: 'READY', evidence: 'All ten Phase 4 surface capabilities are published.' },
  ],
  freshness: { state: 'SHADOW', sourceAsOfAt: null, serverReadAt: null, message: 'Per-dataset timestamps are shown only by governed analytics envelopes; the manifest itself does not claim currency.' },
};
