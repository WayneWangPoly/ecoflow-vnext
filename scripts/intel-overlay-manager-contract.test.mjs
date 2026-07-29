import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_INTELLIGENCE_OVERLAY_STATE,
  reduceIntelligenceOverlay,
} from '../src/features/intelligence/navigation/overlayState.ts';
import {
  normaliseOverlayRecord,
  overlayEntityKey,
  overlayLayerSequence,
  topOverlayLayer,
} from '../src/features/intelligence/overlays/overlayManagerContract.ts';

test('overlay records are trimmed, bounded and keep explicit business copy', () => {
  const record = normaliseOverlayRecord({
    entity: { kind: 'order', id: '  order-42  ', tab: ' summary ' },
    eyebrow: ' Order ',
    title: ' ORD-42 ',
    subtitle: ' Store 42 · Adelaide ',
    width: 'wide',
    fields: Array.from({ length: 45 }, (_, index) => ({
      label: ` Field ${index} `,
      value: ` Value ${index} `,
    })),
  });

  assert.equal(overlayEntityKey(record.entity), 'order:order-42');
  assert.equal(record.entity.tab, 'summary');
  assert.equal(record.eyebrow, 'Order');
  assert.equal(record.title, 'ORD-42');
  assert.equal(record.subtitle, 'Store 42 · Adelaide');
  assert.equal(record.width, 'wide');
  assert.equal(record.fields.length, 40);
  assert.deepEqual(record.fields[0], { label: 'Field 0', value: 'Value 0' });
});

test('overlay runtime remains one primary, one replaceable secondary and one commit', () => {
  let state = reduceIntelligenceOverlay(EMPTY_INTELLIGENCE_OVERLAY_STATE, {
    type: 'OPEN_PRIMARY',
    entity: { kind: 'order', id: 'order-1' },
  });
  state = reduceIntelligenceOverlay(state, {
    type: 'OPEN_RELATED',
    entity: { kind: 'store', id: 'store-1' },
  });
  state = reduceIntelligenceOverlay(state, {
    type: 'OPEN_RELATED',
    entity: { kind: 'customer', id: 'customer-1' },
  });
  state = reduceIntelligenceOverlay(state, {
    type: 'OPEN_COMMIT',
    modal: { actionKey: 'release-order', title: 'Release order', reasonRequired: true },
  });

  assert.deepEqual(overlayLayerSequence(state), ['primary', 'secondary', 'commit']);
  assert.equal(state.secondary?.entity.id, 'customer-1');
  assert.equal(topOverlayLayer(state), 'commit');

  state = reduceIntelligenceOverlay(state, { type: 'CLOSE_TOP' });
  assert.equal(topOverlayLayer(state), 'secondary');
  state = reduceIntelligenceOverlay(state, { type: 'CLOSE_TOP' });
  assert.equal(topOverlayLayer(state), 'primary');
  state = reduceIntelligenceOverlay(state, { type: 'CLOSE_TOP' });
  assert.equal(topOverlayLayer(state), null);
});

test('opening related content without a primary promotes it to the primary drawer', () => {
  const state = reduceIntelligenceOverlay(EMPTY_INTELLIGENCE_OVERLAY_STATE, {
    type: 'OPEN_RELATED',
    entity: { kind: 'exception', id: 'queue-finance' },
  });

  assert.equal(state.primary?.entity.kind, 'exception');
  assert.equal(state.primary?.entity.id, 'queue-finance');
  assert.equal(state.secondary, null);
  assert.deepEqual(overlayLayerSequence(state), ['primary']);
});
