import type { IntelligenceOverlayState, OverlayEntityRef } from '../navigation/overlayState';

export const overlayDrawerWidths = ['standard', 'wide'] as const;
export type OverlayDrawerWidth = (typeof overlayDrawerWidths)[number];

export type OverlayRecordField = {
  label: string;
  value: string;
};

export type OverlayRecordInput = {
  entity: OverlayEntityRef;
  eyebrow: string;
  title: string;
  subtitle?: string;
  fields: readonly OverlayRecordField[];
  width?: OverlayDrawerWidth;
};

export type OverlayLayerKind = 'primary' | 'secondary' | 'commit';

const MAX_TITLE_LENGTH = 160;
const MAX_SUBTITLE_LENGTH = 240;
const MAX_FIELD_LABEL_LENGTH = 80;
const MAX_FIELD_VALUE_LENGTH = 800;
const MAX_FIELDS = 40;

function clean(value: string, maximum: number): string {
  return value.trim().slice(0, maximum);
}

export function overlayEntityKey(entity: OverlayEntityRef): string {
  return `${entity.kind}:${entity.id.trim()}`;
}

export function normaliseOverlayRecord(input: OverlayRecordInput): OverlayRecordInput {
  return {
    entity: {
      ...input.entity,
      id: clean(input.entity.id, MAX_TITLE_LENGTH),
      tab: input.entity.tab ? clean(input.entity.tab, MAX_FIELD_LABEL_LENGTH) || undefined : undefined,
    },
    eyebrow: clean(input.eyebrow, MAX_FIELD_LABEL_LENGTH),
    title: clean(input.title, MAX_TITLE_LENGTH),
    subtitle: input.subtitle ? clean(input.subtitle, MAX_SUBTITLE_LENGTH) || undefined : undefined,
    fields: input.fields.slice(0, MAX_FIELDS).map((field) => ({
      label: clean(field.label, MAX_FIELD_LABEL_LENGTH),
      value: clean(field.value, MAX_FIELD_VALUE_LENGTH),
    })),
    width: input.width ?? 'standard',
  };
}

export function overlayLayerSequence(state: IntelligenceOverlayState): readonly OverlayLayerKind[] {
  const layers: OverlayLayerKind[] = [];
  if (state.primary) layers.push('primary');
  if (state.secondary) layers.push('secondary');
  if (state.commit) layers.push('commit');
  return layers;
}

export function topOverlayLayer(state: IntelligenceOverlayState): OverlayLayerKind | null {
  if (state.commit) return 'commit';
  if (state.secondary) return 'secondary';
  if (state.primary) return 'primary';
  return null;
}
