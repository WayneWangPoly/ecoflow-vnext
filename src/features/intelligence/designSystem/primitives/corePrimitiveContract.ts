export const controlButtonVariants = ['primary', 'secondary', 'quiet', 'danger'] as const;
export type ControlButtonVariant = (typeof controlButtonVariants)[number];

export const controlButtonSizes = ['compact', 'standard', 'touch'] as const;
export type ControlButtonSize = (typeof controlButtonSizes)[number];

export const controlFieldDensities = ['compact', 'standard', 'comfortable'] as const;
export type ControlFieldDensity = (typeof controlFieldDensities)[number];

export const controlStatusTones = ['success', 'warning', 'danger', 'information', 'neutral'] as const;
export type ControlStatusTone = (typeof controlStatusTones)[number];

export const controlPanelTones = ['default', 'raised', 'dark'] as const;
export type ControlPanelTone = (typeof controlPanelTones)[number];

export const controlTabVariants = ['rail', 'segmented'] as const;
export type ControlTabVariant = (typeof controlTabVariants)[number];

export const controlTooltipPlacements = ['top', 'right', 'bottom', 'left'] as const;
export type ControlTooltipPlacement = (typeof controlTooltipPlacements)[number];

export const controlSkeletonShapes = ['text', 'block', 'circle'] as const;
export type ControlSkeletonShape = (typeof controlSkeletonShapes)[number];

export function controlClassName(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function primitiveModifier(base: string, value: string) {
  return `${base}--${value}`;
}
