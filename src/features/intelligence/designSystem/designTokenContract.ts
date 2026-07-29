export const intelligenceDesignTokenContract = {
  spacing: [
    '--ef-space-0',
    '--ef-space-1',
    '--ef-space-2',
    '--ef-space-3',
    '--ef-space-4',
    '--ef-space-5',
    '--ef-space-6',
    '--ef-space-8',
    '--ef-space-10',
    '--ef-space-12',
  ],
  radius: [
    '--ef-radius-1',
    '--ef-radius-2',
    '--ef-radius-3',
    '--ef-radius-4',
    '--ef-radius-round',
  ],
  elevation: [
    '--ef-elevation-1',
    '--ef-elevation-2',
    '--ef-elevation-overlay',
  ],
  surface: [
    '--ef-surface-canvas',
    '--ef-surface-panel',
    '--ef-surface-subtle',
    '--ef-border-default',
    '--ef-border-emphasis',
    '--ef-text-primary',
    '--ef-text-secondary',
    '--ef-text-muted',
  ],
  status: [
    '--ef-status-success-foreground',
    '--ef-status-success-background',
    '--ef-status-warning-foreground',
    '--ef-status-warning-background',
    '--ef-status-danger-foreground',
    '--ef-status-danger-background',
    '--ef-status-information-foreground',
    '--ef-status-information-background',
    '--ef-status-neutral-foreground',
    '--ef-status-neutral-background',
  ],
  typography: [
    '--ef-type-xs',
    '--ef-type-sm',
    '--ef-type-md',
    '--ef-type-lg',
    '--ef-type-xl',
    '--ef-type-2xl',
    '--ef-leading-tight',
    '--ef-leading-standard',
    '--ef-leading-relaxed',
    '--ef-weight-regular',
    '--ef-weight-medium',
    '--ef-weight-semibold',
    '--ef-weight-bold',
  ],
  motion: [
    '--ef-motion-instant',
    '--ef-motion-fast',
    '--ef-motion-standard',
    '--ef-motion-slow',
  ],
  focus: [
    '--ef-focus-ring-width',
    '--ef-focus-ring-offset',
    '--ef-focus-ring-color',
  ],
  density: [
    '--ef-density-compact-row',
    '--ef-density-standard-row',
    '--ef-density-comfortable-row',
    '--ef-touch-target-min',
  ],
} as const;

export const intelligenceDensityModes = ['compact', 'standard', 'comfortable'] as const;
export type IntelligenceDensityMode = (typeof intelligenceDensityModes)[number];

export const intelligenceStatusTones = ['success', 'warning', 'danger', 'information', 'neutral'] as const;
export type IntelligenceStatusTone = (typeof intelligenceStatusTones)[number];
