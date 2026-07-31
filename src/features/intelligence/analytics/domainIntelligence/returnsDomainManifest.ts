import type { Phase4DomainManifest } from './domainIntelligenceContract';
import { createPhase4Capabilities } from './domainManifestFactory';

export const returnsDomainManifest: Phase4DomainManifest = {
  id: 'returns',
  eyebrow: 'RETURNS INTELLIGENCE',
  title: 'Returns intelligence',
  summary: 'Return reason, inspection, disposition, customer, driver, processing age and financial evidence remain traceable to the originating Order and delivery.',
  primaryPath: '/returns',
  implementation: 'READY',
  data: 'SHADOW',
  capabilities: createPhase4Capabilities({
    domainLabel: 'Returns',
    defaultData: 'SHADOW',
    overrides: {
      FILTERS: { data: 'READY', evidence: 'Reason, item, inspection, disposition, customer, driver and age filters are bounded by return identity.' },
      TREND: { data: 'BLOCKED', evidence: 'Processing-age, financial-impact and recurring-pattern trends remain null until governed history is authorised.', blocker: 'No authorised returns performance time series.' },
      TABLE: { evidence: 'Return and inspection event grains preserve reason, item, quantity, condition and disposition separately.' },
      DETAIL_DRAWER: { data: 'READY', evidence: 'Return evidence opens as a bounded read-only detail plane with originating Order and run handoffs.' },
      FRESHNESS: { data: 'UNAVAILABLE', evidence: 'Returns aggregate freshness is never inferred from UI render time.' },
      EMPTY_DEGRADED_STATES: { data: 'READY', evidence: 'No return, incomplete inspection, missing cost and unavailable impact remain distinct.' },
      OPERATIONAL_HANDOFF: { data: 'READY', evidence: 'Returns, Order, Customer and Delivery canonical routes are published without disposition writes.' },
    },
  }),
  breakdowns: [
    { key: 'reason', label: 'Return reason', data: 'SHADOW', description: 'Reason code and free-text evidence remain separate.' },
    { key: 'inspection', label: 'Inspection and condition', data: 'SHADOW', description: 'Received, inspected, condition and evidence timestamps.' },
    { key: 'disposition', label: 'Resale / scrap disposition', data: 'SHADOW', description: 'Disposition state without inventing financial value.' },
    { key: 'responsibility', label: 'Customer and driver context', data: 'SHADOW', description: 'Originating Customer, Store, driver, run and Order.' },
  ],
  trends: [
    { key: 'processing-age', label: 'Processing age', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
    { key: 'financial-impact', label: 'Financial impact', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
    { key: 'recurring-pattern', label: 'Recurring pattern', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
  ],
  tables: [
    { key: 'returns', label: 'Returns register', grain: 'one Return', columns: ['Return', 'Order', 'Customer', 'driver', 'reason', 'age', 'inspection', 'disposition', 'impact'], data: 'SHADOW' },
    { key: 'inspection-events', label: 'Inspection events', grain: 'one Return inspection event', columns: ['Return', 'item', 'quantity', 'condition', 'evidence', 'actor', 'timestamp', 'disposition'], data: 'SHADOW' },
  ],
  handoffs: [
    { key: 'returns', label: 'Returns workspace', pathTemplate: '/returns', workspace: 'returns' },
    { key: 'order', label: 'Originating Order drawer', pathTemplate: '/orders/:orderId', workspace: 'orders' },
    { key: 'customer', label: 'Customer drawer', pathTemplate: '/customers/:customerId', workspace: 'customers' },
    { key: 'delivery-run', label: 'Delivery run drawer', pathTemplate: '/delivery/runs/:runCode', workspace: 'delivery' },
  ],
  timeline: [
    { key: 'semantic-facts', label: 'Return and inspection facts', state: 'READY', evidence: 'Return, inspection and disposition facts preserve event time and source identity.' },
    { key: 'route-contract', label: 'Returns route contract', state: 'READY', evidence: 'Returns workspace and related operational handoffs are governed.' },
    { key: 'domain-review', label: 'Returns domain review', state: 'READY', evidence: 'All ten Phase 4 surface capabilities are published.' },
  ],
  freshness: { state: 'UNAVAILABLE', sourceAsOfAt: null, serverReadAt: null, message: 'Returns aggregate freshness waits for an authorised domain analytics envelope.' },
};
