import { mockRepository } from '@/core/repositories/mockRepository';

export function skuName(skuId: string) {
  const sku = mockRepository.skus.find((candidate) => candidate.id === skuId);
  return sku ? `${sku.skuCode} · ${sku.displayName}` : skuId;
}

export function locationCode(locationId: string) {
  return mockRepository.locations.find((location) => location.id === locationId)?.locationCode ?? locationId;
}

export function siteName(siteId: string) {
  return mockRepository.customerSites.find((site) => site.id === siteId)?.name ?? siteId;
}

export function customerName(customerId: string) {
  return mockRepository.customers.find((customer) => customer.id === customerId)?.name ?? customerId;
}
