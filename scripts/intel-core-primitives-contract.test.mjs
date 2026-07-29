import test from 'node:test';
import assert from 'node:assert/strict';
import {
  controlButtonSizes,
  controlButtonVariants,
  controlClassName,
  controlFieldDensities,
  controlPanelTones,
  controlSkeletonShapes,
  controlStatusTones,
  controlTabVariants,
  controlTooltipPlacements,
  primitiveModifier,
} from '../src/features/intelligence/designSystem/primitives/corePrimitiveContract.ts';

const boundedGroups = {
  controlButtonSizes,
  controlButtonVariants,
  controlFieldDensities,
  controlPanelTones,
  controlSkeletonShapes,
  controlStatusTones,
  controlTabVariants,
  controlTooltipPlacements,
};

test('core primitive variants remain unique and bounded', () => {
  for (const values of Object.values(boundedGroups)) {
    assert.equal(new Set(values).size, values.length);
    assert.ok(values.every((value) => typeof value === 'string' && value.length > 0));
  }
});

test('semantic status tones match the design token contract', () => {
  assert.deepEqual(controlStatusTones, ['success', 'warning', 'danger', 'information', 'neutral']);
});

test('class composition omits false and empty modifiers', () => {
  assert.equal(controlClassName('base', false, undefined, null, 'active'), 'base active');
  assert.equal(primitiveModifier('ef-control-button', 'primary'), 'ef-control-button--primary');
});
