export type BatchNextP2CurrentBatch = {
  batchId: string;
  batchName?: string;
  batchStatus: string;
  revision: number;
  openTasks: number;
  draftReadyTasks: number;
  conflictTasks: number;
  canSubmit: boolean;
};

export type BatchNextP2EvidenceRow = Record<string, unknown>;

export type BatchNextP2Evidence = {
  batches: BatchNextP2EvidenceRow[];
  scopeItems: BatchNextP2EvidenceRow[];
  reconciliations: BatchNextP2EvidenceRow[];
  observations: BatchNextP2EvidenceRow[];
  families: BatchNextP2EvidenceRow[];
  physicalSkus: BatchNextP2EvidenceRow[];
  packages: BatchNextP2EvidenceRow[];
  barcodeBindings: BatchNextP2EvidenceRow[];
  commercialFamilyLinks: BatchNextP2EvidenceRow[];
};

export type BatchNextP2SubmitAcknowledgement = {
  batchId: string;
  batchStatus: string;
  revision: number;
  commandStatus: string;
};

export const BATCH_NEXT_P2_TARGET = {
  protectedMainSha: 'd8673c3c9457b676b9a24840310b684a640f3405',
  batchId: '5d5c1d6e-0c27-47b0-9b63-1d2fe34fe61a',
  batchName: 'ECOFLOW-328 Batch Next DRAFT-only',
  startCommandId: '54a86be1-b497-48aa-a9e1-5d61aab29b51',
  expectedRevision: 5,
  submitCommandId: 'd0b7e6a9-3b2f-4b14-8c52-7f0f2d6e9a41',
  submitNote: 'ECOFLOW-328-BATCH-NEXT-P2 SUBMIT only; exact five DRAFT identities independently verified; PUBLISH, barcode reassignment, inventory/stocktake/location mutation and provider traffic not authorized.',
  identities: {
    'CCLBPLA-80': {
      commercialSkuId: 'cc0d56f1-9ac8-47a4-a5b7-5a3f1c990e5d',
      surveyObservationId: 'd8226c36-057c-4cc8-925e-4f99276ddb60',
      reconcileCommandId: 'fd66defd-9dd6-47b4-8701-60dc8e73370a',
      reconciliationId: 'e71e40ee-8467-4a8b-bc6e-2c460a2a1157',
      observationId: '49c62abb-7943-4184-870d-1bc97e2d8def',
      familyId: 'a42fef9f-b29b-439b-9f9b-ea326583528e',
      physicalSkuId: '73d77fad-e6b8-401e-9ce5-79673b7fbeba',
      packageId: 'e7d08e3b-3132-494e-b317-8561d8659d50',
      bindingId: '5d17fda8-96ac-4685-bf5c-87abe0d33d82',
      physicalName: '80mm PLA Lids Black - 1000pcs',
      barcode: '757953135609',
    },
    'CCSKBM12-90': {
      commercialSkuId: '04b0ff03-bdbf-4897-9171-156af5fb8e00',
      surveyObservationId: '2fda2caa-0727-4e32-b036-0da3c8196e03',
      reconcileCommandId: '32ebe526-0f9a-4762-8fb0-e35db47b1934',
      reconciliationId: '147ce991-3e50-46e5-8c16-f8670cf57624',
      observationId: '47415d12-0bc9-4dfa-a1bc-dad22971cad1',
      familyId: 'bca01c1c-e8f6-4db9-86b0-b042a2c8d0ed',
      physicalSkuId: 'a02cb738-cee6-445c-ace7-abb0b491ac92',
      packageId: '67c9bb7a-9c74-42e7-a3e1-49f1e195b036',
      bindingId: '60655d23-63c1-4276-89db-74429b0838f6',
      physicalName: '(90mm) 12oz Compostable Kraft Bamboo',
      barcode: '757953139683',
    },
    NPK2DK: {
      commercialSkuId: 'f5c68b72-1684-4029-8219-f40b7513c54c',
      surveyObservationId: 'cf15dad3-07e1-4fe8-a184-35968b64a485',
      reconcileCommandId: 'efffab32-38e7-43d0-ac0b-03fceca9db3f',
      reconciliationId: '0ece8da4-189e-4f33-aad1-c1fedcd6ea21',
      observationId: 'b53df73c-a033-4e16-9c04-1ec4558e2d67',
      familyId: 'b296b2ad-3947-42a1-953e-cc56fe2b945f',
      physicalSkuId: 'ab642b2e-ada7-4911-ac96-29813aab635d',
      packageId: 'a06d2261-ccec-42aa-8f2d-1dd251f679c6',
      bindingId: 'a83bdbc7-9139-4453-90e9-b754a7296587',
      physicalName: 'Dinner Napkin 1/8 GT Fold Natural - 1000pcs',
      barcode: '757953135821',
    },
    'CCLWPLA-80': {
      commercialSkuId: '7d387ca1-482b-4143-8ec7-e20f82a8109e',
      surveyObservationId: 'f61dd655-9a7b-4f7a-ad10-f7a3a795d13e',
      reconcileCommandId: 'a9f58d3b-c4fc-4bb7-aa28-126ad773f03a',
      reconciliationId: '17541a6a-6600-4c6e-b7a5-c102ff227946',
      observationId: '69209a3a-080d-4782-8e02-b011258e2ffb',
      familyId: '182f5635-41f2-40eb-8e3a-587e2374d449',
      physicalSkuId: '8ee70919-721b-42db-9935-a18ae1e28d90',
      packageId: '6b61ef89-f8cf-4c8f-a520-dc5819937a20',
      bindingId: '6b9b149d-a423-43ee-a959-0e8e1171e42c',
      physicalName: '80mm PLA Lids White - 1000pcs',
      barcode: '757953135593',
    },
    'CCSA12-90': {
      commercialSkuId: '6b8e0688-d256-4bdb-acc4-175203905796',
      surveyObservationId: '9bde5c61-87de-4f3c-9006-fa9a8e9a3d08',
      reconcileCommandId: '3391354c-8733-498d-b626-719b4456fae1',
      reconciliationId: '1a02d289-e9e1-43ab-ab60-6d03dfb1d0f1',
      observationId: 'd912e828-4d67-47e2-a7a7-e17b3d2999de',
      familyId: 'bf813f72-6d3f-43f4-a279-368a3bac030b',
      physicalSkuId: '333cf47e-6798-4b72-a2f4-41a9f34eb364',
      packageId: '7d788fb0-6f80-4964-86de-a2a61d4401df',
      bindingId: '11ceeb77-beb9-4868-8723-a72411a07de6',
      physicalName: '(90mm) 12oz Art Series Single Wall - 1000pcs',
      barcode: '757953138389',
    },
  },
} as const;

type Identity = (typeof BATCH_NEXT_P2_TARGET.identities)[keyof typeof BATCH_NEXT_P2_TARGET.identities];

function hold(detail: string): never {
  throw new Error(`HOLD — ${detail}; SUBMIT was not called.`);
}

function requireCount(rows: BatchNextP2EvidenceRow[], expected: number, label: string) {
  if (rows.length !== expected) hold(`${label} must contain exactly ${expected} rows`);
}

function expectField(row: BatchNextP2EvidenceRow, field: string, expected: unknown, label: string) {
  if (row[field] !== expected) hold(`${label} ${field} mismatch`);
}

function expectUnit(value: unknown, label: string) {
  if ((typeof value !== 'number' && typeof value !== 'string') || Number(value) !== 1) {
    hold(`${label} units_in_base_unit must be exactly 1`);
  }
}

function findExactly(rows: BatchNextP2EvidenceRow[], field: string, value: string, label: string) {
  const matches = rows.filter((row) => row[field] === value);
  if (matches.length !== 1) hold(`${label} must contain exactly one row for ${value}`);
  return matches[0];
}

function assertCurrentBatch(currentBatch: BatchNextP2CurrentBatch | null) {
  if (!currentBatch) hold('current batch authority returned no batch');
  if (currentBatch.batchId !== BATCH_NEXT_P2_TARGET.batchId) hold('current batch ID mismatch');
  if (currentBatch.batchStatus !== 'DRAFT') hold('current batch must be DRAFT');
  if (currentBatch.revision !== 5) hold('current batch must be revision 5');
  if (currentBatch.openTasks !== 0 || currentBatch.draftReadyTasks !== 5 || currentBatch.conflictTasks !== 0) {
    hold('current batch tasks must be 0 open / 5 draft-ready / 0 conflict');
  }
  if (!currentBatch.canSubmit) hold('current batch authority returned canSubmit=false');
}

function assertBatchRow(rows: BatchNextP2EvidenceRow[]) {
  requireCount(rows, 1, 'batch evidence');
  const row = rows[0];
  for (const [field, expected] of Object.entries({
    id: BATCH_NEXT_P2_TARGET.batchId,
    batch_name: BATCH_NEXT_P2_TARGET.batchName,
    batch_status: 'DRAFT',
    revision: 5,
    start_command_id: BATCH_NEXT_P2_TARGET.startCommandId,
    submit_command_id: null,
    publish_command_id: null,
    submitted_at: null,
    published_at: null,
  })) expectField(row, field, expected, 'batch evidence');
}

function assertScope(rows: BatchNextP2EvidenceRow[]) {
  requireCount(rows, 5, 'scope evidence');
  for (const identity of Object.values(BATCH_NEXT_P2_TARGET.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'scope evidence');
    expectField(row, 'batch_id', BATCH_NEXT_P2_TARGET.batchId, 'scope evidence');
    expectField(row, 'start_command_id', BATCH_NEXT_P2_TARGET.startCommandId, 'scope evidence');
  }
}

function assertIdentity(evidence: BatchNextP2Evidence, code: string, identity: Identity) {
  const reconciliation = findExactly(evidence.reconciliations, 'id', identity.reconciliationId, `${code} reconciliation`);
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT_P2_TARGET.batchId,
    survey_observation_id: identity.surveyObservationId,
    product_identity_observation_id: identity.observationId,
    command_id: identity.reconcileCommandId,
    commercial_sku_id: identity.commercialSkuId,
    carton_barcode: identity.barcode,
    reconciliation_status: 'DRAFTED',
  })) expectField(reconciliation, field, expected, `${code} reconciliation`);

  const observation = findExactly(evidence.observations, 'id', identity.observationId, `${code} observation`);
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT_P2_TARGET.batchId,
    command_id: identity.reconcileCommandId,
    commercial_sku_id: identity.commercialSkuId,
    physical_sku_id: identity.physicalSkuId,
    family_id: identity.familyId,
    barcode: identity.barcode,
    package_level: 'CARTON',
    substitution_policy: 'PROHIBITED',
    is_preferred: true,
    observation_status: 'DRAFTED',
  })) expectField(observation, field, expected, `${code} observation`);
  expectUnit(observation.units_in_base_unit, `${code} observation`);

  const family = findExactly(evidence.families, 'id', identity.familyId, `${code} family`);
  for (const [field, expected] of Object.entries({
    family_code: code,
    family_name: identity.physicalName,
    identity_status: 'DRAFT',
    created_in_batch_id: BATCH_NEXT_P2_TARGET.batchId,
  })) expectField(family, field, expected, `${code} family`);

  const physical = findExactly(evidence.physicalSkus, 'id', identity.physicalSkuId, `${code} Physical SKU`);
  for (const [field, expected] of Object.entries({
    physical_sku_code: code,
    display_name: identity.physicalName,
    brand: null,
    supplier_name: null,
    family_id: identity.familyId,
    identity_status: 'DRAFT',
    created_in_batch_id: BATCH_NEXT_P2_TARGET.batchId,
  })) expectField(physical, field, expected, `${code} Physical SKU`);

  const packageRow = findExactly(evidence.packages, 'id', identity.packageId, `${code} package`);
  for (const [field, expected] of Object.entries({
    physical_sku_id: identity.physicalSkuId,
    package_level: 'CARTON',
    identity_status: 'DRAFT',
    created_in_batch_id: BATCH_NEXT_P2_TARGET.batchId,
  })) expectField(packageRow, field, expected, `${code} package`);
  expectUnit(packageRow.units_in_base_unit, `${code} package`);

  const binding = findExactly(evidence.barcodeBindings, 'id', identity.bindingId, `${code} barcode`);
  for (const [field, expected] of Object.entries({
    barcode: identity.barcode,
    physical_sku_id: identity.physicalSkuId,
    package_id: identity.packageId,
    identity_status: 'DRAFT',
    created_in_batch_id: BATCH_NEXT_P2_TARGET.batchId,
  })) expectField(binding, field, expected, `${code} barcode`);

  const link = findExactly(evidence.commercialFamilyLinks, 'commercial_sku_id', identity.commercialSkuId, `${code} link`);
  for (const [field, expected] of Object.entries({
    family_id: identity.familyId,
    preferred_physical_sku_id: identity.physicalSkuId,
    substitution_policy: 'PROHIBITED',
    identity_status: 'DRAFT',
    created_in_batch_id: BATCH_NEXT_P2_TARGET.batchId,
  })) expectField(link, field, expected, `${code} link`);
}

export function assertBatchNextP2ResumeEvidence(
  currentBatch: BatchNextP2CurrentBatch | null,
  evidence: BatchNextP2Evidence,
) {
  assertCurrentBatch(currentBatch);
  assertBatchRow(evidence.batches);
  assertScope(evidence.scopeItems);
  for (const [rows, label] of [
    [evidence.reconciliations, 'reconciliation evidence'],
    [evidence.observations, 'observation evidence'],
    [evidence.families, 'family evidence'],
    [evidence.physicalSkus, 'Physical evidence'],
    [evidence.packages, 'package evidence'],
    [evidence.barcodeBindings, 'barcode evidence'],
    [evidence.commercialFamilyLinks, 'link evidence'],
  ] as const) requireCount(rows, 5, label);

  for (const [code, identity] of Object.entries(BATCH_NEXT_P2_TARGET.identities)) {
    assertIdentity(evidence, code, identity);
  }
}

export function buildBatchNextP2SubmitInput() {
  return {
    batchId: BATCH_NEXT_P2_TARGET.batchId,
    expectedRevision: BATCH_NEXT_P2_TARGET.expectedRevision,
    commandId: BATCH_NEXT_P2_TARGET.submitCommandId,
    note: BATCH_NEXT_P2_TARGET.submitNote,
  };
}

export function assertBatchNextP2SubmitAcknowledgement(result: BatchNextP2SubmitAcknowledgement) {
  if (
    result.batchId !== BATCH_NEXT_P2_TARGET.batchId
    || result.batchStatus !== 'SUBMITTED'
    || result.revision !== 6
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
  ) throw new Error('Batch Next P2 SUBMIT acknowledgement is not the exact SUBMITTED rev6 APPLIED/REPLAYED result.');
}

export function formatBatchNextP2Failure(error: unknown, commandCrossedBoundary: boolean) {
  const detail = error instanceof Error ? error.message : String(error);
  if (commandCrossedBoundary) {
    return `HOLD — SUBMIT may have been called. Do not retry or use a new command ID; read-only server verification is required. Detail: ${detail}`;
  }
  if (detail.startsWith('HOLD —')) return detail;
  return `HOLD — ${detail}; SUBMIT was not called.`;
}
