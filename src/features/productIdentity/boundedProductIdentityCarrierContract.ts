export type BoundedStartDraft = {
  batchName: string;
  commercialSkuIdsText: string;
  commandId: string;
};

export type BoundedReconcileDraft = {
  surveyObservationId: string;
  commandId: string;
  physicalSkuCode: string;
  physicalName: string;
  brand: string;
  supplierName: string;
  familyCode: string;
  familyName: string;
  packageLevel: 'CARTON' | 'SLEEVE' | 'INNER' | 'EACH' | 'PALLET';
  unitsInBaseUnit: string;
  substitutionPolicy: 'ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED';
  isPreferred: boolean;
  note: string;
};

export const BPB8_DRAFT_CANARY_DEFAULTS = {
  start: {
    batchName: '#338 BPB8 Physical Identity production canary',
    commercialSkuIdsText: 'ec67ca0a-67b5-437f-96a8-81e6268faa44',
    commandId: 'bb388464-bc36-4546-a875-16ec0e890e66',
  },
  reconcile: {
    surveyObservationId: '5a5a63e4-2b52-43e0-b96b-6129415585ee',
    commandId: '2514d56b-4b60-4db1-acba-4ea0ec88d568',
    physicalSkuCode: 'BPB8',
    physicalName: '8oz Kraft Soup Bowl 250ml',
    brand: '',
    supplierName: '',
    familyCode: 'BPB8',
    familyName: '8oz Kraft Soup Bowl 250ml',
    packageLevel: 'CARTON',
    unitsInBaseUnit: '1',
    substitutionPolicy: 'PROHIBITED',
    isPreferred: true,
    note: '#338 BPB8 production Physical Identity canary; Owner/Admin confirmed payload; carton operational base unit = 1; no inventory authority granted.',
  },
} as const satisfies { start: BoundedStartDraft; reconcile: BoundedReconcileDraft };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requiredUuid(value: string, label: string) {
  const normalized = requiredText(value, label);
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${label} must be a UUID.`);
  return normalized;
}

export function buildBoundedStartInput(draft: BoundedStartDraft) {
  const commercialSkuIds = draft.commercialSkuIdsText
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (commercialSkuIds.length !== 1) {
    throw new Error('This carrier is fenced to exactly one explicit Commercial SKU UUID.');
  }
  const commercialSkuId = requiredUuid(commercialSkuIds[0], 'Commercial SKU UUID');

  return {
    batchName: requiredText(draft.batchName, 'Batch name'),
    commercialSkuIds: [commercialSkuId],
    commandId: requiredUuid(draft.commandId, 'START command ID'),
  };
}

export function buildBoundedReconcileInput(draft: BoundedReconcileDraft, batchId: string) {
  const unitsInBaseUnit = Number(draft.unitsInBaseUnit);
  if (!Number.isSafeInteger(unitsInBaseUnit) || unitsInBaseUnit <= 0) {
    throw new Error('Units in base unit must be an explicitly confirmed positive whole number.');
  }

  return {
    surveyObservationId: requiredUuid(draft.surveyObservationId, 'Survey observation ID'),
    batchId: requiredUuid(batchId, 'START batch ID'),
    commandId: requiredUuid(draft.commandId, 'RECONCILE command ID'),
    physicalSkuCode: requiredText(draft.physicalSkuCode, 'Physical SKU code'),
    physicalName: requiredText(draft.physicalName, 'Physical name'),
    brand: draft.brand.trim() || undefined,
    supplierName: draft.supplierName.trim() || undefined,
    familyCode: requiredText(draft.familyCode, 'Family code'),
    familyName: requiredText(draft.familyName, 'Family name'),
    packageLevel: draft.packageLevel,
    unitsInBaseUnit,
    substitutionPolicy: draft.substitutionPolicy,
    isPreferred: draft.isPreferred,
    note: draft.note.trim() || undefined,
  };
}
