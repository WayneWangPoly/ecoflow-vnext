export type DataSystem = 'ORDERMENTUM' | 'ECOFLOW';
export type OwnershipMode = 'SOURCE_MIRROR' | 'OPERATIONAL_RECORD';

export type DataOwnershipDomain = {
  key: string;
  label: string;
  system: DataSystem;
  mode: OwnershipMode;
  examples: string;
  changeRule: string;
  deletionRule: string;
};

export const ORDERMENTUM_SOURCE_DOMAINS: DataOwnershipDomain[] = [
  {
    key: 'stores',
    label: 'Customers & stores',
    system: 'ORDERMENTUM',
    mode: 'SOURCE_MIRROR',
    examples: 'Names, addresses, phones, delivery instructions, price groups and payment terms',
    changeRule: 'Create or correct in Ordermentum, then sync the complete mirror.',
    deletionRule: 'Retain the EcoFlow history and mark the source record missing or inactive.',
  },
  {
    key: 'catalog',
    label: 'Products, SKUs & prices',
    system: 'ORDERMENTUM',
    mode: 'SOURCE_MIRROR',
    examples: 'Products, variants, item codes, names, source barcodes, price groups and selling prices',
    changeRule: 'Maintain the commercial catalogue and every selling price in Ordermentum only.',
    deletionRule: 'Never erase historical order lines; mark the source SKU inactive or missing.',
  },
  {
    key: 'orders',
    label: 'Orders & order lines',
    system: 'ORDERMENTUM',
    mode: 'SOURCE_MIRROR',
    examples: 'Ordered items, quantities, requested delivery date, order value and cancellation',
    changeRule: 'Amend or cancel the commercial order in Ordermentum. EcoFlow re-mirrors the result.',
    deletionRule: 'Keep the audit copy and remove it from release eligibility.',
  },
  {
    key: 'finance',
    label: 'Invoices & payments',
    system: 'ORDERMENTUM',
    mode: 'SOURCE_MIRROR',
    examples: 'Invoice status, payment status, payment method, GST, freight, surcharge and amount due',
    changeRule: 'Record payment and invoice changes in Ordermentum. EcoFlow never allocates a substitute payment.',
    deletionRule: 'Retain statements and audit history while flagging the missing source invoice.',
  },
];

export const ECOFLOW_OPERATIONAL_DOMAINS: DataOwnershipDomain[] = [
  {
    key: 'warehouse',
    label: 'Warehouse execution',
    system: 'ECOFLOW',
    mode: 'OPERATIONAL_RECORD',
    examples: 'Receiving, stock ledger, rack locations, local barcode verification, picking, packing and staging',
    changeRule: 'Record physical work in EcoFlow through controlled operational transactions.',
    deletionRule: 'Reverse or correct with an auditable movement; never rewrite source commerce.',
  },
  {
    key: 'delivery',
    label: 'Delivery execution',
    system: 'ECOFLOW',
    mode: 'OPERATIONAL_RECORD',
    examples: 'Run release, route order, driver progress, POD, failed delivery and returns',
    changeRule: 'Operate and audit delivery in EcoFlow after an eligible source order is released.',
    deletionRule: 'Preserve completed runs and POD as immutable operational history.',
  },
  {
    key: 'office',
    label: 'Office workflow',
    system: 'ECOFLOW',
    mode: 'OPERATIONAL_RECORD',
    examples: 'Internal orders, release holds, collection notes, statement documents and communication preferences',
    changeRule: 'Use EcoFlow for workflow decisions and documents, not to override Ordermentum facts.',
    deletionRule: 'Close or supersede workflow records while retaining the audit trail.',
  },
  {
    key: 'security',
    label: 'Security & audit',
    system: 'ECOFLOW',
    mode: 'OPERATIONAL_RECORD',
    examples: 'Users, roles, approvals, integration jobs, exceptions and activity logs',
    changeRule: 'Manage in EcoFlow under role-based controls.',
    deletionRule: 'Deactivate access and retain security events.',
  },
];

export const DATA_OWNERSHIP_DOMAINS = [
  ...ORDERMENTUM_SOURCE_DOMAINS,
  ...ECOFLOW_OPERATIONAL_DOMAINS,
];

export function isOrdermentumSourceDomain(key: string) {
  return ORDERMENTUM_SOURCE_DOMAINS.some((domain) => domain.key === key);
}

export const DATA_FLOW_STATEMENT = 'Ordermentum commercial source → verified EcoFlow mirror → EcoFlow warehouse and delivery execution';
