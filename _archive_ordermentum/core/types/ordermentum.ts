export interface OrdermentumOrderPayload {
  id: string;
  orderNumber: string;
  customer?: {
    id?: string;
    name?: string;
  };
  site?: {
    id?: string;
    name?: string;
    addressLine1?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
  };
  invoice?: {
    id?: string;
    number?: string;
  };
  deliveryDate?: string;
  lines: OrdermentumOrderLinePayload[];
  raw?: unknown;
}

export interface OrdermentumOrderLinePayload {
  id: string;
  productId?: string;
  productCode?: string;
  productName: string;
  barcode?: string;
  quantity: number;
  unit?: string;
  raw?: unknown;
}
