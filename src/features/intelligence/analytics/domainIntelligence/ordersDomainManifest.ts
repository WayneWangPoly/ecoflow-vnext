import type { Phase4DomainManifest } from './domainIntelligenceContract';
import { createPhase4Capabilities } from './domainManifestFactory';

export const ordersDomainManifest: Phase4DomainManifest = {
  id: 'orders',
  eyebrow: 'ORDERS & FULFILMENT INTELLIGENCE',
  title: 'Orders and fulfilment intelligence',
  summary: 'Order pipeline, release evidence, fulfilment, substitution and payment state remain traceable from Order to Order Line.',
  primaryPath: '/orders',
  implementation: 'READY',
  data: 'SHADOW',
  capabilities: createPhase4Capabilities({
    domainLabel: 'Orders and fulfilment',
    defaultData: 'SHADOW',
    overrides: {
      FILTERS: { data: 'READY', evidence: 'Order query contracts provide bounded search, typed filters, stable sorting and pagination.' },
      TREND: { data: 'BLOCKED', evidence: 'Fill-rate and partial-fulfilment trend slots preserve null until a governed historical projection is authorised.', blocker: 'No authorised fulfilment time-series projection.' },
      TABLE: { evidence: 'Order and Order Line grains retain Commercial SKU, Physical SKU, ordered, fulfilled, substituted and release evidence separately.' },
      DETAIL_DRAWER: { data: 'READY', evidence: 'Canonical Order drawer identity and read-only operational fields are already governed.' },
      FRESHNESS: { data: 'UNAVAILABLE', evidence: 'Source and server timestamps remain unavailable rather than inferred from browser load time.' },
      EMPTY_DEGRADED_STATES: { data: 'READY', evidence: 'Blocked release, unavailable projection, partial evidence and successful empty results remain distinct.' },
      OPERATIONAL_HANDOFF: { data: 'READY', evidence: 'Order, Commercial SKU and Physical SKU canonical routes are published without issuing release commands.' },
    },
  }),
  breakdowns: [
    { key: 'pipeline', label: 'Order pipeline', data: 'SHADOW', description: 'Imported, release, picking, packed, staged, delivery and completion states.' },
    { key: 'release-blockers', label: 'Release blockers', data: 'SHADOW', description: 'Payment, mapping, data and stock blockers remain explicit.' },
    { key: 'sku-fulfilment', label: 'Commercial vs Physical SKU', data: 'SHADOW', description: 'Demand identity and fulfilled physical identity remain separate.' },
    { key: 'substitution', label: 'Substitution and partial fulfilment', data: 'SHADOW', description: 'Substitution and unfulfilled quantity evidence is preserved per line.' },
  ],
  trends: [
    { key: 'fill-rate', label: 'Fill rate', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
    { key: 'partial-fulfilment', label: 'Partial fulfilment rate', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
    { key: 'release-blockers', label: 'Release blocker trend', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
  ],
  tables: [
    { key: 'orders', label: 'Order pipeline', grain: 'one Order', columns: ['Order', 'customer', 'store', 'status', 'payment', 'release blockers', 'fulfilment', 'freshness'], data: 'SHADOW' },
    { key: 'order-lines', label: 'Order line fulfilment', grain: 'one Order Line', columns: ['Order', 'Commercial SKU', 'Physical SKU', 'ordered', 'fulfilled', 'substituted', 'exception'], data: 'SHADOW' },
  ],
  handoffs: [
    { key: 'orders', label: 'Orders workspace', pathTemplate: '/orders', workspace: 'orders' },
    { key: 'order', label: 'Order drawer', pathTemplate: '/orders/:orderId', workspace: 'orders' },
    { key: 'commercial-sku', label: 'Commercial SKU drawer', pathTemplate: '/inventory/commercial/:skuId', workspace: 'inventory' },
    { key: 'physical-sku', label: 'Physical SKU drawer', pathTemplate: '/inventory/physical/:itemId', workspace: 'inventory' },
  ],
  timeline: [
    { key: 'semantic-facts', label: 'Order and fulfilment facts', state: 'READY', evidence: 'Order, Order Line and fulfilment facts preserve source identity and lifecycle timestamps.' },
    { key: 'query-surface', label: 'Orders query surface', state: 'READY', evidence: 'Typed search, filters, stable sort, pagination and read-only drawer are governed.' },
    { key: 'domain-review', label: 'Orders domain review', state: 'READY', evidence: 'All ten Phase 4 surface capabilities are published.' },
  ],
  freshness: { state: 'UNAVAILABLE', sourceAsOfAt: null, serverReadAt: null, message: 'Orders aggregate freshness waits for an authorised domain analytics envelope.' },
};
