export type OrdermentumNumber = number | string;

export type OrdermentumSnapshot = {
  recentOrders: ReadonlyArray<{
    id: string;
    orderNumber: string;
    status: string;
    retailerName: string;
    deliveryDate: string;
    dueAt: string;
    total: OrdermentumNumber;
    totalQuantity: OrdermentumNumber;
    paymentStatus: string;
    updatedAt: string;
  }>;
  detailOrder: {
    id: string;
    orderNumber: string;
    invoiceNumber: string;
    invoiceId: string;
    retailerName: string;
    purchaserId: string;
    retailerId: string;
    status: string;
    orderStatus: string;
    paymentStatus: string;
    total: OrdermentumNumber;
    totalQuantity: OrdermentumNumber;
    deliveryDate: string;
    dueAt: string;
    updatedAt: string;
    paymentMethodDisplay: string;
    address: {
      formatted: string;
      street1: string;
      street2: string;
      suburb: string;
      state: string;
      postcode: string;
    };
    lineItems: ReadonlyArray<{
      id: string;
      name: string;
      quantity: OrdermentumNumber;
      total: OrdermentumNumber;
      sku: string;
      productName: string;
      unit: string;
      category: string;
      basePrice: OrdermentumNumber;
    }>;
  };
  invoiceDetail: {
    id: string;
    number: string;
    supplierName: string;
    retailerName: string;
    total: OrdermentumNumber;
    totalDue: OrdermentumNumber;
    totalGST: OrdermentumNumber;
    totalFreight: OrdermentumNumber;
    dueAt: string;
    paidSupplierAt: string;
    orderIds: ReadonlyArray<string>;
    display: {
      totalCost: OrdermentumNumber;
      totalFreight: OrdermentumNumber;
      subtotal: OrdermentumNumber;
      totalGST: OrdermentumNumber;
      total: OrdermentumNumber;
      totalDue: OrdermentumNumber;
      totalCharge: OrdermentumNumber;
      totalFreightTax: OrdermentumNumber;
      totalDiscount: OrdermentumNumber;
      totalSponsoredDiscount: OrdermentumNumber;
      surcharge: OrdermentumNumber;
      surchargeIncGst: boolean;
      credit: OrdermentumNumber;
      totalSupplierDiscount: OrdermentumNumber;
      date: string;
      dueAt: string;
      createdAt: string;
      billingStartDate: string;
      billingEndDate: string;
      paymentMethod: string;
    };
  };
  purchaserDetail: {
    id: string;
    reference: string;
    name: string;
    retailerName: string;
    retailerAbn: string;
    retailerEmail: string;
    retailerBillingEmail: string;
    deliveryInstructions: string;
    paymentDelay: OrdermentumNumber;
    paymentSchedule: string;
  };
  productsMeta: {
    totalResults: OrdermentumNumber;
    totalPages: OrdermentumNumber;
    pageSize: OrdermentumNumber;
    pageNo: OrdermentumNumber;
  };
  products: ReadonlyArray<{
    id: string;
    name: string;
    SKU: string;
    basePrice: OrdermentumNumber;
    displayPrice: string;
    unit: string;
    categoryNames: ReadonlyArray<string>;
    prices: Readonly<Record<string, OrdermentumNumber>>;
    visible: boolean;
  }>;
  variantsMeta: {
    totalResults: OrdermentumNumber;
    totalPages: OrdermentumNumber;
    pageSize: OrdermentumNumber;
    pageNo: OrdermentumNumber;
  };
  variants: ReadonlyArray<{
    id: string;
    productId: string;
    name: string;
    SKU: string;
    basePrice: OrdermentumNumber;
    displayPrice: string;
    unit: string;
    visible: boolean;
    deactivatedAt: string | null;
  }>;
  priceGroups: ReadonlyArray<{
    id: string;
    name: string;
    default: boolean;
    retailersTotal: OrdermentumNumber;
    productsTotal: OrdermentumNumber;
  }>;
  stockLocations: ReadonlyArray<{
    id: string;
    name: string;
    default: boolean;
  }>;
};
