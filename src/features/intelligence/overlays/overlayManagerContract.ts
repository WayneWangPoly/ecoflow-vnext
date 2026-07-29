import type { IntelligenceOverlayState, OverlayEntityRef } from '../navigation/overlayState';

export const overlayDrawerWidths = ['standard', 'wide'] as const;
export type OverlayDrawerWidth = (typeof overlayDrawerWidths)[number];

export type OverlayRecordField = {
  label: string;
  value: string;
};

export type OverlayRelatedRecordInput = {
  label: string;
  entity: OverlayEntityRef;
  eyebrow: string;
  title: string;
  subtitle?: string;
  fields: readonly OverlayRecordField[];
  width?: OverlayDrawerWidth;
};

export type OverlayRecordInput = {
  entity: OverlayEntityRef;
  eyebrow: string;
  title: string;
  subtitle?: string;
  fields: readonly OverlayRecordField[];
  relatedRecords?: readonly OverlayRelatedRecordInput[];
  width?: OverlayDrawerWidth;
};

export type OverlayLayerKind = 'primary' | 'secondary' | 'commit';

const MAX_TITLE_LENGTH = 160;
const MAX_SUBTITLE_LENGTH = 240;
const MAX_FIELD_LABEL_LENGTH = 80;
const MAX_FIELD_VALUE_LENGTH = 800;
const MAX_FIELDS = 40;
const MAX_RELATED_RECORDS = 6;

function clean(value: string, maximum: number): string {
  return value.trim().slice(0, maximum);
}

function normaliseEntity(entity: OverlayEntityRef): OverlayEntityRef {
  return {
    ...entity,
    id: clean(entity.id, MAX_TITLE_LENGTH),
    tab: entity.tab ? clean(entity.tab, MAX_FIELD_LABEL_LENGTH) || undefined : undefined,
  };
}

function normaliseFields(fields: readonly OverlayRecordField[]): readonly OverlayRecordField[] {
  return fields.slice(0, MAX_FIELDS).map((field) => ({
    label: clean(field.label, MAX_FIELD_LABEL_LENGTH),
    value: clean(field.value, MAX_FIELD_VALUE_LENGTH),
  }));
}

export function overlayEntityKey(entity: OverlayEntityRef): string {
  return `${entity.kind}:${entity.id.trim()}`;
}

export function normaliseRelatedOverlayRecord(input: OverlayRelatedRecordInput): OverlayRelatedRecordInput {
  return {
    label: clean(input.label, MAX_FIELD_LABEL_LENGTH),
    entity: normaliseEntity(input.entity),
    eyebrow: clean(input.eyebrow, MAX_FIELD_LABEL_LENGTH),
    title: clean(input.title, MAX_TITLE_LENGTH),
    subtitle: input.subtitle ? clean(input.subtitle, MAX_SUBTITLE_LENGTH) || undefined : undefined,
    fields: normaliseFields(input.fields),
    width: input.width ?? 'standard',
  };
}

export function relatedOverlayRecord(input: OverlayRelatedRecordInput): OverlayRecordInput {
  const related = normaliseRelatedOverlayRecord(input);
  return {
    entity: related.entity,
    eyebrow: related.eyebrow,
    title: related.title,
    subtitle: related.subtitle,
    fields: related.fields,
    width: related.width,
  };
}

export function normaliseOverlayRecord(input: OverlayRecordInput): OverlayRecordInput {
  return {
    entity: normaliseEntity(input.entity),
    eyebrow: clean(input.eyebrow, MAX_FIELD_LABEL_LENGTH),
    title: clean(input.title, MAX_TITLE_LENGTH),
    subtitle: input.subtitle ? clean(input.subtitle, MAX_SUBTITLE_LENGTH) || undefined : undefined,
    fields: normaliseFields(input.fields),
    relatedRecords: input.relatedRecords
      ?.slice(0, MAX_RELATED_RECORDS)
      .map(normaliseRelatedOverlayRecord)
      .filter((related) => related.entity.id && related.title && related.label),
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
