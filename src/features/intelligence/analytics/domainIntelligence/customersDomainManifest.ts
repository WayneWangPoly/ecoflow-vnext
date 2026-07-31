import type { Phase4DomainManifest } from './domainIntelligenceContract';
import { createPhase4Capabilities } from './domainManifestFactory';

export const customersDomainManifest: Phase4DomainManifest = {
  id: 'customers',
  eyebrow: 'CUSTOMER & COMMERCIAL INTELLIGENCE',
  title: 'Customer and commercial intelligence',
  summary: 'Customer, Store, pricing, product mix, payment exposure and affected Orders remain linked without collapsing distinct identities.',
  primaryPath: '/customers',
  implementation: 'READY',
  data: 'SHADOW',
  capabilities: createPhase4Capabilities({
    domainLabel: 'Customer and commercial',
    defaultData: 'SHADOW',
    overrides: {
      FILTERS: { data: 'READY', evidence: 'Customer, Store, tier, exposure and activity filters are bounded by governed identities.' },
      TREND: { data: 'BLOCKED', evidence: 'Revenue, margin and order-frequency history remain null until a governed commercial projection is authorised.', blocker: 'No authorised customer time-series projection.' },
      DETAIL_DRAWER: { data: 'READY', evidence: 'Canonical Customer and Store drawer identities are available for read-only handoff.' },
      FRESHNESS: { data: 'UNAVAILABLE', evidence: 'Commercial aggregate freshness remains explicit and unavailable without source/server timestamps.' },
      EMPTY_DEGRADED_STATES: { data: 'READY', evidence: 'Missing cost, incomplete customer and unavailable margin never become successful zero values.' },
      OPERATIONAL_HANDOFF: { data: 'READY', evidence: 'Customer, Store and affected Order canonical routes are published read-only.' },
    },
  }),
  breakdowns: [
    { key: 'product-mix', label: 'Product mix', data: 'SHADOW', description: 'Commercial SKU demand by customer and store.' },
    { key: 'pricing-tier', label: 'Pricing tier', data: 'SHADOW', description: 'Assigned tier, missing tier and effective commercial context.' },
    { key: 'substitution', label: 'Substitution exposure', data: 'SHADOW', description: 'Affected Orders and Physical SKU fulfilment remain traceable.' },
    { key: 'concentration', label: 'Customer concentration risk', data: 'BLOCKED', description: 'Concentration requires governed revenue and margin aggregates.' },
  ],
  trends: [
    { key: 'revenue', label: 'Revenue trend', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
    { key: 'margin', label: 'Margin trend', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
    { key: 'frequency', label: 'Order frequency', data: 'BLOCKED', value: null, formattedValue: null, sourceAsOfAt: null },
  ],
  tables: [
    { key: 'customers', label: 'Customer commercial profile', grain: 'one Customer', columns: ['Customer', 'stores', 'pricing tier', 'orders', 'revenue', 'margin', 'payment exposure', 'risk'], data: 'SHADOW' },
    { key: 'stores', label: 'Store operating profile', grain: 'one Store', columns: ['Store', 'Customer', 'suburb', 'tier', 'delivery', 'substitutions', 'affected Orders'], data: 'SHADOW' },
  ],
  handoffs: [
    { key: 'customers', label: 'Customers workspace', pathTemplate: '/customers', workspace: 'customers' },
    { key: 'customer', label: 'Customer drawer', pathTemplate: '/customers/:customerId', workspace: 'customers' },
    { key: 'store', label: 'Store drawer', pathTemplate: '/stores/:storeId', workspace: 'stores' },
    { key: 'order', label: 'Affected Order drawer', pathTemplate: '/orders/:orderId', workspace: 'orders' },
  ],
  timeline: [
    { key: 'semantic-facts', label: 'Customer and commercial facts', state: 'READY', evidence: 'Customer, Store, pricing and payment facts preserve source identities.' },
    { key: 'identity-routes', label: 'Customer and Store route contracts', state: 'READY', evidence: 'Canonical primary and related drawer routes are governed.' },
    { key: 'domain-review', label: 'Customer domain review', state: 'READY', evidence: 'All ten Phase 4 surface capabilities are published.' },
  ],
  freshness: { state: 'UNAVAILABLE', sourceAsOfAt: null, serverReadAt: null, message: 'Commercial aggregate freshness waits for an authorised domain analytics envelope.' },
};
