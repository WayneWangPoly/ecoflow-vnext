// SYNTHETIC_ONLY: deterministic demo data with no copied customer, order,
// address, contact, credential, or provider identifiers.

const ANCHOR_MS = Date.parse('2026-07-24T06:30:00.000Z');
const PRICE_GROUP_IDS = [
  '00000010-0000-4000-8000-000000000001',
  '00000010-0000-4000-8000-000000000002',
  '00000010-0000-4000-8000-000000000003',
  '00000010-0000-4000-8000-000000000004',
  '00000010-0000-4000-8000-000000000005'
];

function pad(value: number, size = 3) {
  return String(value).padStart(size, '0');
}

function syntheticId(namespace: number, index: number) {
  return `${pad(namespace, 8)}-0000-4000-8000-${pad(index, 12)}`;
}

function isoAt(dayOffset: number, hourOffset = 0) {
  return new Date(ANCHOR_MS + dayOffset * 86_400_000 + hourOffset * 3_600_000).toISOString();
}

function demoStore(index: number) {
  return `Demo Store ${pad((index % 12) + 1, 2)}`;
}

const recentOrders = Array.from({ length: 50 }, (_, index) => {
  const paid = index % 7 !== 0;
  const deliveryOffset = 1 + (index % 12);
  return {
    id: syntheticId(1, index + 1),
    orderNumber: `DEMO-ORDER-${pad(index + 1, 4)}`,
    status: paid ? 'Paid' : 'Pending',
    retailerName: demoStore(index),
    deliveryDate: isoAt(deliveryOffset, index % 4),
    dueAt: isoAt(deliveryOffset + 7, 2),
    total: (72.5 + index * 11.35).toFixed(2),
    totalQuantity: String(2 + (index % 14)),
    paymentStatus: paid ? 'Paid' : 'Pending',
    updatedAt: isoAt(-(index % 16), -(index % 5))
  };
});

const products = Array.from({ length: 20 }, (_, index) => {
  const number = index + 1;
  const unit = index % 5 === 4 ? 'Sleeve' : 'Carton';
  const basePrice = 18 + number * 2.75;
  return {
    id: syntheticId(2, number),
    name: `Demo Packaging Item ${pad(number, 2)}`,
    SKU: `DEMO-${unit === 'Sleeve' ? 'SLV' : 'CTN'}-${pad(number)}`,
    basePrice: basePrice.toFixed(2),
    displayPrice: `$${basePrice.toFixed(2)}`,
    unit,
    categoryNames: [`Demo Category ${(index % 4) + 1}`],
    prices: {
      [PRICE_GROUP_IDS[0]]: Number((basePrice * 0.96).toFixed(2)),
      [PRICE_GROUP_IDS[1]]: Number((basePrice * 0.91).toFixed(2))
    },
    visible: true
  };
});

const variants = Array.from({ length: 20 }, (_, index) => {
  const number = index + 1;
  const basePrice = 9 + number * 1.45;
  return {
    id: syntheticId(3, number),
    productId: products[index].id,
    name: `Demo Packaging Variant ${pad(number, 2)}`,
    SKU: `DEMO-VAR-${pad(number)}`,
    basePrice: basePrice.toFixed(2),
    displayPrice: `$${basePrice.toFixed(2)}`,
    unit: index % 3 === 0 ? 'Sleeve' : 'Carton',
    visible: true,
    deactivatedAt: null
  };
});

const detailOrderId = syntheticId(4, 1);
const detailInvoiceId = syntheticId(5, 1);

export const ordermentumSnapshot = {
  recentOrders,
  detailOrder: {
    id: detailOrderId,
    orderNumber: 'DEMO-ORDER-DETAIL-0001',
    invoiceNumber: 'DEMO-INVOICE-0001',
    invoiceId: detailInvoiceId,
    retailerName: 'Demo Store 01',
    purchaserId: syntheticId(6, 1),
    retailerId: syntheticId(7, 1),
    status: 'Paid',
    orderStatus: 'Accepted',
    paymentStatus: 'Paid',
    total: 154.8,
    totalQuantity: 6,
    deliveryDate: isoAt(2, 1),
    dueAt: isoAt(9, 2),
    updatedAt: isoAt(0),
    paymentMethodDisplay: 'Synthetic account terms',
    address: {
      formatted: '100 Demo Avenue, Example Park SA 5000',
      street1: '100 Demo Avenue',
      street2: 'Synthetic receiving entrance',
      suburb: 'Example Park',
      state: 'SA',
      postcode: '5000'
    },
    lineItems: [
      {
        id: syntheticId(8, 1),
        name: products[0].name,
        quantity: 2,
        total: (Number(products[0].basePrice) * 2).toFixed(2),
        sku: products[0].SKU,
        productName: products[0].name,
        unit: products[0].unit,
        category: products[0].categoryNames[0],
        basePrice: products[0].basePrice
      },
      {
        id: syntheticId(8, 2),
        name: products[4].name,
        quantity: 4,
        total: (Number(products[4].basePrice) * 4).toFixed(2),
        sku: products[4].SKU,
        productName: products[4].name,
        unit: products[4].unit,
        category: products[4].categoryNames[0],
        basePrice: products[4].basePrice
      }
    ]
  },
  invoiceDetail: {
    id: detailInvoiceId,
    number: 'DEMO-INVOICE-0001',
    supplierName: 'EcoFlow Packaging Demo',
    retailerName: 'Demo Store 01',
    total: '154.80',
    totalDue: '0.00',
    totalGST: '14.07',
    totalFreight: '0.00',
    dueAt: isoAt(9, 2),
    paidSupplierAt: isoAt(1),
    orderIds: [detailOrderId],
    display: {
      totalCost: '140.73',
      totalFreight: '0.00',
      subtotal: '140.73',
      totalGST: '14.07',
      total: '154.80',
      totalDue: '0.00',
      totalCharge: '154.80',
      totalFreightTax: '0.00',
      totalDiscount: '0.00',
      totalSponsoredDiscount: '0.00',
      surcharge: '0.00',
      surchargeIncGst: true,
      credit: '0.00',
      totalSupplierDiscount: '0.00',
      date: isoAt(0),
      dueAt: isoAt(9, 2),
      createdAt: isoAt(-1),
      billingStartDate: isoAt(-30),
      billingEndDate: isoAt(0),
      paymentMethod: 'Synthetic account terms'
    }
  },
  purchaserDetail: {
    id: syntheticId(6, 1),
    reference: 'DEMO-PURCHASER-001',
    name: 'Demo Purchasing Contact',
    retailerName: 'Demo Store 01',
    retailerAbn: '00 000 000 000',
    retailerEmail: 'operations@demo-store.example',
    retailerBillingEmail: 'billing@demo-store.example',
    deliveryInstructions: 'Use the clearly marked synthetic receiving entrance.',
    paymentDelay: 7,
    paymentSchedule: 'Synthetic weekly account'
  },
  productsMeta: {
    totalResults: 120,
    totalPages: 6,
    pageSize: 20,
    pageNo: 1
  },
  products,
  variantsMeta: {
    totalResults: 80,
    totalPages: 4,
    pageSize: 20,
    pageNo: 1
  },
  variants,
  priceGroups: PRICE_GROUP_IDS.map((id, index) => ({
    id,
    name: `Demo Tier ${index + 1}`,
    default: index === 0,
    retailersTotal: 4 + index * 3,
    productsTotal: 20
  })),
  stockLocations: [
    {
      id: syntheticId(9, 1),
      name: 'Demo Warehouse',
      default: true
    }
  ]
};
