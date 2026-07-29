import test from 'node:test';
import assert from 'node:assert/strict';
import {
  intelligenceDensityModes,
  intelligenceDesignTokenContract,
  intelligenceStatusTones,
} from '../src/features/intelligence/designSystem/designTokenContract.ts';

test('design token groups expose unique CSS custom properties', () => {
  const tokens = Object.values(intelligenceDesignTokenContract).flat();
  assert.equal(new Set(tokens).size, tokens.length);
  assert.ok(tokens.every((token) => token.startsWith('--ef-')));
});

test('status tones remain semantic and bounded', () => {
  assert.deepEqual(intelligenceStatusTones, ['success', 'warning', 'danger', 'information', 'neutral']);
});

test('density modes remain bounded', () => {
  assert.deepEqual(intelligenceDensityModes, ['compact', 'standard', 'comfortable']);
});
