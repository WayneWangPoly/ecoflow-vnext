import { inventoryDomainManifest } from './inventoryDomainManifest';
import { ordersDomainManifest } from './ordersDomainManifest';
import { customersDomainManifest } from './customersDomainManifest';
import { deliveryDomainManifest } from './deliveryDomainManifest';
import { returnsDomainManifest } from './returnsDomainManifest';
import type { Phase4DomainManifest } from './domainIntelligenceContract';

export const phase4DomainManifests: readonly Phase4DomainManifest[] = [
  inventoryDomainManifest,
  ordersDomainManifest,
  customersDomainManifest,
  deliveryDomainManifest,
  returnsDomainManifest,
];
