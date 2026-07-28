import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ordermentumSnapshot as snapshot } from '../src/data/ordermentumSnapshot.ts';

const source = fs.readFileSync('src/data/ordermentumSnapshot.ts', 'utf8');

assert.match(source, /SYNTHETIC_ONLY/, 'The fixture must declare its synthetic-only boundary.');
assert.doesNotMatch(source, /generated from the real|real Ordermentum sample/i, 'Real-provider generation markers are forbidden.');

assert.equal(snapshot.recentOrders.length, 50, 'Demo order volume changed unexpectedly.');
assert.equal(snapshot.products.length, 20, 'Demo product volume changed unexpectedly.');
assert.equal(snapshot.variants.length, 20, 'Demo variant volume changed unexpectedly.');
assert.equal(snapshot.priceGroups.length, 5, 'Demo price group volume changed unexpectedly.');
assert.equal(snapshot.stockLocations.length, 1, 'Demo stock-location volume changed unexpectedly.');
assert.equal(snapshot.detailOrder.lineItems.length, 2, 'Demo detail order shape changed unexpectedly.');

assert.ok(
  snapshot.recentOrders.every((order) =>
    /^DEMO-ORDER-\d{4}$/.test(order.orderNumber)
    && /^Demo Store \d{2}$/.test(order.retailerName)
  ),
  'Every order identity must be visibly synthetic.'
);
assert.ok(
  snapshot.products.every((product) =>
    product.SKU.startsWith('DEMO-')
    && product.name.startsWith('Demo Packaging Item ')
  ),
  'Every product identity must be visibly synthetic.'
);
assert.ok(
  snapshot.variants.every((variant) =>
    variant.SKU.startsWith('DEMO-')
    && variant.name.startsWith('Demo Packaging Variant ')
  ),
  'Every variant identity must be visibly synthetic.'
);
assert.match(snapshot.detailOrder.orderNumber, /^DEMO-ORDER-/);
assert.match(snapshot.detailOrder.invoiceNumber, /^DEMO-INVOICE-/);
assert.match(snapshot.detailOrder.retailerName, /^Demo Store /);
assert.match(snapshot.detailOrder.address.street1, /Demo/);
assert.match(snapshot.detailOrder.address.suburb, /Example/);
assert.match(snapshot.purchaserDetail.reference, /^DEMO-/);
assert.match(snapshot.purchaserDetail.name, /^Demo /);
assert.equal(snapshot.purchaserDetail.retailerAbn, '00 000 000 000');

const strings = [];
const visit = (value) => {
  if (typeof value === 'string') {
    strings.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(visit);
    return;
  }
  if (value && typeof value === 'object') Object.values(value).forEach(visit);
};
visit(snapshot);

const emails = strings.filter((value) => /^[^\s@]+@[^\s@]+$/.test(value));
assert.ok(emails.length >= 2, 'The synthetic fixture should exercise contact fields.');
assert.ok(
  emails.every((email) => email.endsWith('.example')),
  'Committed fixture emails must use the reserved .example domain.'
);
assert.ok(
  strings.filter((value) => value.includes('@')).every((value) => value.endsWith('.example')),
  'No non-example contact address may be committed in the fixture.'
);

console.log('Synthetic Ordermentum snapshot audit passed.');
