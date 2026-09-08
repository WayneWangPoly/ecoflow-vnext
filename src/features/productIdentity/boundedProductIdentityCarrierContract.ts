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

export type BoundedSubmitDraft = {
  batchId: string;
  expectedRevision: string;
  commandId: string;
  note: string;
};

export type BoundedSubmitInput = {
  batchId: string;
  expectedRevision: number;
  commandId: string;
  note: string;
};

type BoundedSubmitPreflight = {
  batchId: string;
  batchStatus: string;
  revision: number;
  canSubmit: boolean;
} | null;

type BoundedSubmitAcknowledgement = {
  batchId: string;
  batchStatus: string;
  revision: number;
  commandStatus: string;
};

export type BoundedPublishDraft = {
  batchId: string;
  expectedRevision: string;
  commandId: string;
  note: string;
};

export type BoundedPublishInput = {
  batchId: string;
  expectedRevision: number;
  commandId: string;
  note: string;
};

type BoundedPublishPreflight = {
  batchId: string;
  batchStatus: string;
  revision: number;
  canPublish: boolean;
} | null;

type BoundedPublishAcknowledgement = {
  batchId: string;
  batchStatus: string;
  revision: number;
  commandStatus: string;
  publishedFamilies: number;
  publishedPhysicalSkus: number;
  publishedBarcodes: number;
  publishedLinks: number;
  publishedAt: string | null;
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

export const BPB8_P2_SUBMIT_DEFAULTS = {
  batchId: '448f401e-0701-4e9f-8426-5dfed67b9f78',
  expectedRevision: '1',
  commandId: '6df22bb2-506e-4be1-a752-c1e2323f431d',
  note: '#338 BPB8 P2 production submit-only canary; P1 DRAFT payload independently verified; no publish or inventory authority granted.',
} as const satisfies BoundedSubmitDraft;

export const BPB8_P3_PUBLISH_DEFAULTS = {
  batchId: '448f401e-0701-4e9f-8426-5dfed67b9f78',
  expectedRevision: '2',
  commandId: '973b7007-4fd5-44f6-bd43-f64aa848e299',
  note: '#338 BPB8 P3 production publish canary; P1 DRAFT and P2 SUBMIT independently verified; no inventory authority granted.',
} as const satisfies BoundedPublishDraft;

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

export function buildBoundedSubmitInput(draft: BoundedSubmitDraft): BoundedSubmitInput {
  const batchId = requiredUuid(draft.batchId, 'Batch ID');
  const commandId = requiredUuid(draft.commandId, 'SUBMIT command ID');
  const note = requiredText(draft.note, 'Submit note');
  const expectedRevision = Number(draft.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('Expected revision must be a safe non-negative whole number.');
  }
  if (expectedRevision !== 1) {
    throw new Error('This BPB8 P2 carrier is fenced to expected revision 1.');
  }
  if (batchId !== BPB8_P2_SUBMIT_DEFAULTS.batchId) {
    throw new Error('This BPB8 P2 carrier is fenced to the BPB8 P1 batch ID.');
  }
  if (commandId !== BPB8_P2_SUBMIT_DEFAULTS.commandId) {
    throw new Error('This BPB8 P2 carrier requires the frozen P2 command ID.');
  }
  if (note !== BPB8_P2_SUBMIT_DEFAULTS.note) {
    throw new Error('This BPB8 P2 carrier requires the frozen P2 submit note.');
  }

  return {
    batchId,
    expectedRevision,
    commandId,
    note,
  };
}

export function assertBoundedSubmitPreflight(
  currentBatch: BoundedSubmitPreflight,
  input: BoundedSubmitInput,
) {
  if (!currentBatch) {
    throw new Error('Pre-submit read returned no current batch; SUBMIT was not called.');
  }
  if (currentBatch.batchId !== input.batchId) {
    throw new Error('Pre-submit batch ID mismatch; SUBMIT was not called.');
  }
  if (currentBatch.batchStatus !== 'DRAFT') {
    throw new Error('Pre-submit batch must be DRAFT; SUBMIT was not called.');
  }
  if (currentBatch.revision !== input.expectedRevision) {
    throw new Error('Pre-submit revision mismatch; SUBMIT was not called.');
  }
  if (!currentBatch.canSubmit) {
    throw new Error('Pre-submit authority returned canSubmit=false; SUBMIT was not called.');
  }
}

export function assertBoundedSubmitAcknowledgement(
  result: BoundedSubmitAcknowledgement,
  input: BoundedSubmitInput,
) {
  const expectedResultRevision = input.expectedRevision + 1;
  if (
    result.batchId !== input.batchId
    || result.batchStatus !== 'SUBMITTED'
    || result.revision !== expectedResultRevision
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
  ) {
    throw new Error(
      `Bounded SUBMIT returned an unexpected acknowledgement: ${result.batchId}/${result.batchStatus}/rev ${result.revision}/${result.commandStatus}.`,
    );
  }
}

export function buildBoundedPublishInput(draft: BoundedPublishDraft): BoundedPublishInput {
  const batchId = requiredUuid(draft.batchId, 'Batch ID');
  const commandId = requiredUuid(draft.commandId, 'PUBLISH command ID');
  const note = requiredText(draft.note, 'Publish note');
  const expectedRevision = Number(draft.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('Expected revision must be a safe non-negative whole number.');
  }
  if (expectedRevision !== 2) {
    throw new Error('This BPB8 P3 carrier is fenced to expected revision 2.');
  }
  if (batchId !== BPB8_P3_PUBLISH_DEFAULTS.batchId) {
    throw new Error('This BPB8 P3 carrier is fenced to the BPB8 batch ID.');
  }
  if (commandId !== BPB8_P3_PUBLISH_DEFAULTS.commandId) {
    throw new Error('This BPB8 P3 carrier requires the frozen P3 command ID.');
  }
  if (note !== BPB8_P3_PUBLISH_DEFAULTS.note) {
    throw new Error('This BPB8 P3 carrier requires the frozen P3 publish note.');
  }

  return { batchId, expectedRevision, commandId, note };
}

export function assertBoundedPublishPreflight(
  currentBatch: BoundedPublishPreflight,
  input: BoundedPublishInput,
) {
  if (!currentBatch) {
    throw new Error('Pre-publish read returned no current batch; PUBLISH was not called.');
  }
  if (currentBatch.batchId !== input.batchId) {
    throw new Error('Pre-publish batch ID mismatch; PUBLISH was not called.');
  }
  if (currentBatch.batchStatus !== 'SUBMITTED') {
    throw new Error('Pre-publish batch must be SUBMITTED; PUBLISH was not called.');
  }
  if (currentBatch.revision !== input.expectedRevision) {
    throw new Error('Pre-publish revision mismatch; PUBLISH was not called.');
  }
  if (!currentBatch.canPublish) {
    throw new Error('Pre-publish authority returned canPublish=false; PUBLISH was not called.');
  }
}

export function assertBoundedPublishAcknowledgement(
  result: BoundedPublishAcknowledgement,
  input: BoundedPublishInput,
) {
  const publishedAtPresent = typeof result.publishedAt === 'string' && result.publishedAt.trim().length > 0;
  if (
    result.batchId !== input.batchId
    || result.batchStatus !== 'PUBLISHED'
    || result.revision !== input.expectedRevision + 1
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
    || result.publishedFamilies !== 1
    || result.publishedPhysicalSkus !== 1
    || result.publishedBarcodes !== 1
    || result.publishedLinks !== 1
    || !publishedAtPresent
  ) {
    throw new Error(
      `Bounded PUBLISH returned an unexpected acknowledgement: ${result.batchId}/${result.batchStatus}/rev ${result.revision}/${result.commandStatus}; published ${result.publishedFamilies}/${result.publishedPhysicalSkus}/${result.publishedBarcodes}/${result.publishedLinks}.`,
    );
  }
}
