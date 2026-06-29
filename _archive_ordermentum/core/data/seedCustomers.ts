import type { Address, Customer, CustomerSite } from '@/core/types/database';
import { SEED_NOW } from './seedTime';

export const seedAddresses: Address[] = [
  {
    id: 'addr-ordermentum-test-site',
    line1: 'Ordermentum test delivery address',
    suburb: 'Adelaide',
    state: 'SA',
    postcode: '5000',
    country: 'AU',
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedCustomers: Customer[] = [
  {
    id: 'cust-ordermentum-test',
    code: 'ORDERMENTUM-TEST-CUSTOMER',
    name: 'Ordermentum Test Customer',
    invoiceName: 'Ordermentum Test Customer',
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];

export const seedCustomerSites: CustomerSite[] = [
  {
    id: 'site-ordermentum-test',
    customerId: 'cust-ordermentum-test',
    code: 'ORDERMENTUM-TEST-SITE',
    name: 'Ordermentum Test Site',
    addressId: 'addr-ordermentum-test-site',
    contactName: 'Manager',
    phone: '',
    deliveryNote: 'Driver note placeholder. Replace after real customer/site import rules are confirmed.',
    isActive: true,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW
  }
];
