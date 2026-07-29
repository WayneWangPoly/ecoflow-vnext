import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseOverlayRecord,
  normaliseRelatedOverlayRecord,
  relatedOverlayRecord,
} from '../src/features/intelligence/overlays/overlayManagerContract.ts';

test('primary records retain at most six explicit related entities', () => {
  const record = normaliseOverlayRecord({
    entity: { kind: 'order', id: 'order-1' },
    eyebrow: 'Order',
    title: 'ORD-1',
    fields: [],
    relatedRecords: Array.from({ length: 8 }, (_, index) => ({
      label: ' Store ',
      entity: { kind: 'store', id: ` store-${index} ` },
      eyebrow: ' Store ',
      title: ` Store ${index} `,
      subtitle: ' Adelaide ',
      fields: [{ label: ' Account ', value: ` A-${index} ` }],
    })),
  });

  assert.equal(record.relatedRecords?.length, 6);
  assert.deepEqual(record.relatedRecords?.[0], {
    label: 'Store',
    entity: { kind: 'store', id: 'store-0', tab: undefined },
    eyebrow: 'Store',
    title: 'Store 0',
    subtitle: 'Adelaide',
    fields: [{ label: 'Account', value: 'A-0' }],
    width: 'standard',
  });
});

test('related records convert into a standalone secondary inspector record', () => {
  const related = normaliseRelatedOverlayRecord({
    label: 'Store',
    entity: { kind: 'store', id: 'store-42' },
    eyebrow: 'Store',
    title: 'Central Market',
    subtitle: 'Adelaide',
    width: 'wide',
    fields: [
      { label: 'Account', value: 'AC-42' },
      { label: 'Price tier', value: 'Tier 2' },
    ],
  });
  const inspector = relatedOverlayRecord(related);

  assert.deepEqual(inspector, {
    entity: { kind: 'store', id: 'store-42', tab: undefined },
    eyebrow: 'Store',
    title: 'Central Market',
    subtitle: 'Adelaide',
    fields: [
      { label: 'Account', value: 'AC-42' },
      { label: 'Price tier', value: 'Tier 2' },
    ],
    width: 'wide',
  });
  assert.equal(inspector.relatedRecords, undefined);
});

test('empty related identities and labels are removed from a primary record', () => {
  const record = normaliseOverlayRecord({
    entity: { kind: 'order', id: 'order-1' },
    eyebrow: 'Order',
    title: 'ORD-1',
    fields: [],
    relatedRecords: [
      { label: '', entity: { kind: 'store', id: 'store-1' }, eyebrow: 'Store', title: 'One', fields: [] },
      { label: 'Store', entity: { kind: 'store', id: '' }, eyebrow: 'Store', title: 'Two', fields: [] },
      { label: 'Store', entity: { kind: 'store', id: 'store-3' }, eyebrow: 'Store', title: '', fields: [] },
    ],
  });

  assert.deepEqual(record.relatedRecords, []);
});
