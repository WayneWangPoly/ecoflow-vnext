import type { Phase4DomainManifest } from './domainIntelligenceContract';
import { createPhase4Capabilities } from './domainManifestFactory';

export const deliveryDomainManifest: Phase4DomainManifest = {
  id: 'delivery',
  eyebrow: 'DELIVERY INTELLIGENCE',
  title: 'Delivery intelligence',
  summary: 'Run, stop, driver, POD, failed-delivery and return evidence remains ordered by operational time and canonical route identity.',
  primaryPath: '/delivery',
  implementation: 'READY',
  data: 'SHADOW',
  capabilities: createPhase4Capabilities({
    domainLabel: 'Delivery',
    defaultData: 'SHADOW',
    overrides: {
      FILTERS: { data: 'READY', evidence: 'Run, status, driver, late-stop, POD and failure filters are bounded by governed delivery identities.' },
      TREND: { data: 'BLOCKED', evidence: 'Planned-versus-actual and time-per-stop trends remain null until governed historical observations are authorised.', blocker: 'No authorised delivery performance time series.' },
      DETAIL_DRAWER: { data: 'READY', evidence: 'Canonical delivery-run drawer identity supports read-only run and stop handoff.' },
      FRESHNESS: { data: 'UNAVAILABLE', evidence: 'Delivery aggregate freshness is not inferred from device or browser time.' },
      EMPTY_DEGRADED_STATES: { data: 'READY', evidence: 'Missing POD, no observation, failed delivery and successful zero-stop results remain distinct.' },
      OPERATIONAL_HANDOFF: { data: 'READY', evidence: 'Delivery run, Order and Returns routes are published without route mutation.' },
    },
  }),
  breakdowns: [
    { key: 'run-status', label: 'Run status and sequence', data: 'SHADOW', description: 'Run lifecycle, stop sequence and current completion evidence.' },
    { key: 'pod-failure', label: 'POD and failed delivery', data: 'SHADOW', description: 'Captured evidence, missing proof and failed-stop reasons remain separate.' },
    { key: 'driver', label: 'Driver performance context', data: 'SHADOW', description: 'Driver assignment and observed stop timing without ranking unsupported values.' },
    { key: 'returns', label: 'Delivery-linked returns', data: 'SHADOW', description: 'Return identity remains linked to the originating run, stop and Order.' },
  ],
  trends: [
    { key: 'planned-actual', label: 'Planned vs actual duration', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
    { key: 'time-per-stop', label: 'Time per stop', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
    { key: 'late-stops', label: 'Late stop trend', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
  ],
  tables: [
    { key: 'runs', label: 'Delivery runs', grain: 'one Delivery Run', columns: ['Run', 'driver', 'status', 'planned', 'actual', 'stops', 'late', 'POD', 'failures'], data: 'SHADOW' },
    { key: 'stops', label: 'Delivery stops', grain: 'one Run Stop', columns: ['Run', 'sequence', 'Order', 'Store', 'planned', 'observed', 'POD', 'failure', 'return'], data: 'SHADOW' },
  ],
  handoffs: [
    { key: 'delivery', label: 'Delivery workspace', pathTemplate: '/delivery', workspace: 'delivery' },
    { key: 'run', label: 'Delivery run drawer', pathTemplate: '/delivery/runs/:runCode', workspace: 'delivery' },
    { key: 'order', label: 'Order drawer', pathTemplate: '/orders/:orderId', workspace: 'orders' },
    { key: 'returns', label: 'Returns workspace', pathTemplate: '/returns', workspace: 'returns' },
  ],
  timeline: [
    { key: 'semantic-facts', label: 'Delivery and stop facts', state: 'READY', evidence: 'Runs, stops, POD and observed timings preserve operational timestamps.' },
    { key: 'route-contract', label: 'Delivery run route contract', state: 'READY', evidence: 'Canonical workspace and run identity routes are governed.' },
    { key: 'domain-review', label: 'Delivery domain review', state: 'READY', evidence: 'All ten Phase 4 surface capabilities are published.' },
  ],
  freshness: { state: 'UNAVAILABLE', sourceAsOfAt: null, serverReadAt: null, message: 'Delivery aggregate freshness waits for an authorised domain analytics envelope.' },
};
