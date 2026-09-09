export type Batch2Target = 'FL115PLABOX' | 'SB24/32/40LBOX';

export type Batch2StartDraft = {
  batchName: string;
  commercialSkuIdsText: string;
  commandId: string;
};

export type Batch2ReconcileDraft = {
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

export type Batch2LifecycleDraft = {
  expectedRevision: string;
  commandId: string;
  note: string;
};

export type Batch2LifecycleInput = {
  batchId: string;
  expectedRevision: number;
  commandId: string;
  note: string;
};

type StartInput = {
  batchName: string;
  commercialSkuIds: string[];
  commandId: string;
};

type StartAcknowledgement = {
  batchId: string;
  batchName: string;
  batchStatus: string;
  revision: number;
  commandStatus: string;
  scopedSkuCount: number;
};

type ReconcileInput = {
  surveyObservationId: string;
  batchId: string;
  commandId: string;
  physicalSkuCode: string;
  physicalName: string;
  brand?: string;
  supplierName?: string;
  familyCode: string;
  familyName: string;
  packageLevel: 'CARTON' | 'SLEEVE' | 'INNER' | 'EACH' | 'PALLET';
  unitsInBaseUnit: number;
  substitutionPolicy: 'ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED';
  isPreferred: boolean;
  note?: string;
};

type ReconcileAcknowledgement = {
  reconciliationStatus: string;
  commercialSkuId: string;
  barcode: string;
  commandStatus: string;
};

type CurrentBatch = {
  batchId: string;
  batchStatus: string;
  revision: number;
  openTasks?: number;
  draftReadyTasks?: number;
  conflictTasks?: number;
  canSubmit?: boolean;
  canPublish?: boolean;
} | null;

type LifecycleAcknowledgement = {
  batchId: string;
  batchStatus: string;
  revision: number;
  commandStatus: string;
};

type PublishAcknowledgement = LifecycleAcknowledgement & {
  publishedFamilies: number;
  publishedPhysicalSkus: number;
  publishedBarcodes: number;
  publishedLinks: number;
  publishedAt: string | null;
};

export const BATCH2_PRODUCT_IDENTITY_DEFAULTS = {
  start: {
    batchName: '#338 Physical Identity Batch 2 low-complexity production canary',
    commercialSkuIdsText: '16be45a8-a98d-4b15-af2e-1846817e8d98\n7cb8c724-35cb-4132-9437-db4c15e13fde',
    commandId: 'b34fa49b-f374-4237-8479-d9af37890de8',
  },
  reconciliations: {
    FL115PLABOX: {
      surveyObservationId: 'f1b087f0-d964-45cf-acb1-6818ab2b418f',
      commandId: '2353d72f-fd48-434e-a4c0-47f8d0d146ee',
      physicalSkuCode: 'FL115PLABOX',
      physicalName: 'PLA Flat Lid 12/16/24oz Soup Bowl',
      brand: '',
      supplierName: '',
      familyCode: 'FL115PLABOX',
      familyName: 'PLA Flat Lid 12/16/24oz Soup Bowl',
      packageLevel: 'CARTON',
      unitsInBaseUnit: '1',
      substitutionPolicy: 'PROHIBITED',
      isPreferred: true,
      note: '#338 Batch 2 FL115PLABOX Physical Identity; Owner/Admin confirmed CARTON × 1; no separate sleeve barcode; no inventory authority granted.',
    },
    'SB24/32/40LBOX': {
      surveyObservationId: '617ad6e4-0860-4189-88e1-781c2d15d6cf',
      commandId: '9d94e547-b6da-4dc4-8829-5046258838da',
      physicalSkuCode: 'SB24/32/40LBOX',
      physicalName: 'RPET Lid Fits 24–40oz Sugarcane Food Bowl',
      brand: '',
      supplierName: '',
      familyCode: 'SB24/32/40LBOX',
      familyName: 'RPET Lid Fits 24–40oz Sugarcane Food Bowl',
      packageLevel: 'CARTON',
      unitsInBaseUnit: '1',
      substitutionPolicy: 'PROHIBITED',
      isPreferred: true,
      note: '#338 Batch 2 SB24/32/40LBOX Physical Identity; Owner/Admin confirmed CARTON × 1; no separate sleeve barcode; no inventory authority granted.',
    },
  },
  acknowledgements: {
    FL115PLABOX: {
      commercialSkuId: '16be45a8-a98d-4b15-af2e-1846817e8d98',
      barcode: '19348045010188',
    },
    'SB24/32/40LBOX': {
      commercialSkuId: '7cb8c724-35cb-4132-9437-db4c15e13fde',
      barcode: '19348045022914',
    },
  },
  submit: {
    expectedRevision: '2',
    commandId: 'bc5538d2-73e0-4aaf-987f-4b53fd8aa75d',
    note: '#338 Batch 2 production submit; two DRAFT Physical Identity payloads independently verified; no inventory authority granted.',
  },
  publish: {
    expectedRevision: '3',
    commandId: '82041faf-fdfa-4d2f-882c-d2c1c33ecd7a',
    note: '#338 Batch 2 production publish; two DRAFT payloads and SUBMIT independently verified; no inventory authority granted.',
  },
} as const satisfies {
  start: Batch2StartDraft;
  reconciliations: Record<Batch2Target, Batch2ReconcileDraft>;
  acknowledgements: Record<Batch2Target, { commercialSkuId: string; barcode: string }>;
  submit: Batch2LifecycleDraft;
  publish: Batch2LifecycleDraft;
};

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

function exactField(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(message);
}

export function buildBatch2StartInput(draft: Batch2StartDraft): StartInput {
  const commercialSkuIds = draft.commercialSkuIdsText
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => requiredUuid(value, 'Commercial SKU UUID'));
  const expectedIds = BATCH2_PRODUCT_IDENTITY_DEFAULTS.start.commercialSkuIdsText.split('\n');
  if (commercialSkuIds.length !== 2 || commercialSkuIds.some((value, index) => value !== expectedIds[index])) {
    throw new Error('Batch 2 requires the frozen ordered two-SKU scope.');
  }
  const batchName = requiredText(draft.batchName, 'Batch name');
  const commandId = requiredUuid(draft.commandId, 'START command ID');
  exactField(batchName, BATCH2_PRODUCT_IDENTITY_DEFAULTS.start.batchName, 'Batch 2 requires the frozen batch name.');
  exactField(commandId, BATCH2_PRODUCT_IDENTITY_DEFAULTS.start.commandId, 'Batch 2 requires the frozen START command ID.');
  return { batchName, commercialSkuIds, commandId };
}

export function assertBatch2StartAcknowledgement(result: StartAcknowledgement, input: StartInput) {
  if (
    result.batchName !== input.batchName
    || result.batchStatus !== 'DRAFT'
    || result.revision !== 0
    || result.scopedSkuCount !== 2
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
  ) {
    throw new Error(`Batch 2 START returned an unexpected acknowledgement: ${result.batchStatus}/rev ${result.revision}/${result.commandStatus}/scope ${result.scopedSkuCount}.`);
  }
  requiredUuid(result.batchId, 'START batch ID');
}

export function buildBatch2ReconcileInput(
  target: Batch2Target,
  draft: Batch2ReconcileDraft,
  batchId: string,
): ReconcileInput {
  const expected = BATCH2_PRODUCT_IDENTITY_DEFAULTS.reconciliations[target];
  const unitsInBaseUnit = Number(draft.unitsInBaseUnit);
  if (draft.packageLevel !== 'CARTON' || unitsInBaseUnit !== 1) {
    throw new Error(`Batch 2 ${target} is fenced to CARTON x 1.`);
  }
  const input = {
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
    note: requiredText(draft.note, 'Reconciliation note'),
  } satisfies ReconcileInput;
  const comparable = {
    surveyObservationId: input.surveyObservationId,
    commandId: input.commandId,
    physicalSkuCode: input.physicalSkuCode,
    physicalName: input.physicalName,
    brand: input.brand,
    supplierName: input.supplierName,
    familyCode: input.familyCode,
    familyName: input.familyName,
    packageLevel: input.packageLevel,
    unitsInBaseUnit: String(input.unitsInBaseUnit),
    substitutionPolicy: input.substitutionPolicy,
    isPreferred: input.isPreferred,
    note: input.note,
  };
  const expectedComparable = {
    ...expected,
    brand: undefined,
    supplierName: undefined,
  };
  for (const key of Object.keys(expectedComparable) as Array<keyof typeof expectedComparable>) {
    if (comparable[key] !== expectedComparable[key]) {
      throw new Error(`Batch 2 ${target} requires the frozen reconciliation payload.`);
    }
  }
  return input;
}

export function assertBatch2ReconcileAcknowledgement(
  target: Batch2Target,
  result: ReconcileAcknowledgement,
  input: ReconcileInput,
) {
  const expected = BATCH2_PRODUCT_IDENTITY_DEFAULTS.acknowledgements[target];
  if (
    result.reconciliationStatus !== 'DRAFTED'
    || result.commercialSkuId !== expected.commercialSkuId
    || result.barcode !== expected.barcode
    || result.barcode !== (target === 'FL115PLABOX' ? '19348045010188' : '19348045022914')
    || input.surveyObservationId !== BATCH2_PRODUCT_IDENTITY_DEFAULTS.reconciliations[target].surveyObservationId
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
  ) {
    throw new Error(`Batch 2 ${target} returned an unexpected acknowledgement.`);
  }
}

export function assertBatch2DraftProgress(input: {
  currentBatch: CurrentBatch;
  startResult: StartAcknowledgement;
  reconciliationResults: Partial<Record<Batch2Target, ReconcileAcknowledgement>>;
  expectedRevision: 1 | 2;
}) {
  const startInput = buildBatch2StartInput(BATCH2_PRODUCT_IDENTITY_DEFAULTS.start);
  assertBatch2StartAcknowledgement(input.startResult, startInput);
  if (!input.currentBatch) throw new Error('Batch 2 current-batch read returned no batch.');
  if (input.currentBatch.batchId !== input.startResult.batchId) throw new Error('Batch 2 current-batch read returned a different batch.');
  if (input.currentBatch.batchStatus !== 'DRAFT') throw new Error('Batch 2 current batch must remain DRAFT.');
  if (input.currentBatch.revision !== input.expectedRevision) throw new Error(`Batch 2 current batch must be revision ${input.expectedRevision}.`);
  const expectedOpenTasks = input.expectedRevision === 1 ? 1 : 0;
  if (
    input.currentBatch.openTasks !== expectedOpenTasks
    || input.currentBatch.draftReadyTasks !== input.expectedRevision
    || input.currentBatch.conflictTasks !== 0
  ) {
    throw new Error(`Batch 2 DRAFT task state does not prove ${input.expectedRevision} exact reconciliation(s).`);
  }

  const flResult = input.reconciliationResults.FL115PLABOX;
  if (!flResult) throw new Error('Batch 2 FL115PLABOX exact reconciliation is required.');
  const flInput = buildBatch2ReconcileInput('FL115PLABOX', BATCH2_PRODUCT_IDENTITY_DEFAULTS.reconciliations.FL115PLABOX, input.startResult.batchId);
  assertBatch2ReconcileAcknowledgement('FL115PLABOX', flResult, flInput);
  if (input.expectedRevision === 2) {
    const sbResult = input.reconciliationResults['SB24/32/40LBOX'];
    if (!sbResult) throw new Error('Batch 2 requires both exact reconciliations before SUBMIT.');
    const sbInput = buildBatch2ReconcileInput('SB24/32/40LBOX', BATCH2_PRODUCT_IDENTITY_DEFAULTS.reconciliations['SB24/32/40LBOX'], input.startResult.batchId);
    assertBatch2ReconcileAcknowledgement('SB24/32/40LBOX', sbResult, sbInput);
  }
}

function buildLifecycleInput(
  draft: Batch2LifecycleDraft,
  batchId: string,
  kind: 'SUBMIT' | 'PUBLISH',
): Batch2LifecycleInput {
  const expected = kind === 'SUBMIT' ? BATCH2_PRODUCT_IDENTITY_DEFAULTS.submit : BATCH2_PRODUCT_IDENTITY_DEFAULTS.publish;
  const expectedRevision = Number(draft.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('Expected revision must be a safe non-negative whole number.');
  }
  const commandId = requiredUuid(draft.commandId, `${kind} command ID`);
  const note = requiredText(draft.note, `${kind} note`);
  exactField(expectedRevision, Number(expected.expectedRevision), `Batch 2 ${kind} requires expected revision ${expected.expectedRevision}.`);
  exactField(commandId, expected.commandId, `Batch 2 requires the frozen ${kind} command ID.`);
  exactField(note, expected.note, `Batch 2 requires the frozen ${kind} note.`);
  return { batchId: requiredUuid(batchId, 'START batch ID'), expectedRevision, commandId, note };
}

export function buildBatch2SubmitInput(draft: Batch2LifecycleDraft, batchId: string) {
  return buildLifecycleInput(draft, batchId, 'SUBMIT');
}

export function buildBatch2PublishInput(draft: Batch2LifecycleDraft, batchId: string) {
  return buildLifecycleInput(draft, batchId, 'PUBLISH');
}

export function assertBatch2SubmitPreflight(currentBatch: CurrentBatch, input: Batch2LifecycleInput) {
  if (!currentBatch) throw new Error('Pre-submit read returned no current batch; SUBMIT was not called.');
  if (currentBatch.batchId !== input.batchId) throw new Error('Pre-submit batch ID mismatch; SUBMIT was not called.');
  if (currentBatch.batchStatus !== 'DRAFT') throw new Error('Pre-submit batch must be DRAFT; SUBMIT was not called.');
  if (currentBatch.revision !== input.expectedRevision) throw new Error('Pre-submit revision mismatch; SUBMIT was not called.');
  if (!currentBatch.canSubmit) throw new Error('Pre-submit authority returned canSubmit=false; SUBMIT was not called.');
}

export function assertBatch2SubmitAcknowledgement(result: LifecycleAcknowledgement, input: Batch2LifecycleInput) {
  if (
    result.batchId !== input.batchId
    || result.batchStatus !== 'SUBMITTED'
    || result.revision !== 3
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
  ) throw new Error('Batch 2 SUBMIT returned an unexpected acknowledgement.');
}

export function assertBatch2PublishPreflight(currentBatch: CurrentBatch, input: Batch2LifecycleInput) {
  if (!currentBatch) throw new Error('Pre-publish read returned no current batch; PUBLISH was not called.');
  if (currentBatch.batchId !== input.batchId) throw new Error('Pre-publish batch ID mismatch; PUBLISH was not called.');
  if (currentBatch.batchStatus !== 'SUBMITTED') throw new Error('Pre-publish batch must be SUBMITTED; PUBLISH was not called.');
  if (currentBatch.revision !== input.expectedRevision) throw new Error('Pre-publish revision mismatch; PUBLISH was not called.');
  if (!currentBatch.canPublish) throw new Error('Pre-publish authority returned canPublish=false; PUBLISH was not called.');
}

export function assertBatch2PublishAcknowledgement(result: PublishAcknowledgement, input: Batch2LifecycleInput) {
  const publishedAtPresent = typeof result.publishedAt === 'string' && result.publishedAt.trim().length > 0;
  if (
    result.batchId !== input.batchId
    || result.batchStatus !== 'PUBLISHED'
    || result.revision !== 4
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
    || result.publishedFamilies !== 2
    || result.publishedPhysicalSkus !== 2
    || result.publishedBarcodes !== 2
    || result.publishedLinks !== 2
    || !publishedAtPresent
  ) throw new Error('Batch 2 PUBLISH returned an unexpected acknowledgement.');
}
