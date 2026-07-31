import { inventoryDomainManifest } from './inventoryDomainManifest';
import { ordersDomainManifest } from './ordersDomainManifest';
import type { Phase4DomainManifest } from './domainIntelligenceContract';

export const phase4DomainManifests: readonly Phase4DomainManifest[] = [
  inventoryDomainManifest,
  ordersDomainManifest,
];
