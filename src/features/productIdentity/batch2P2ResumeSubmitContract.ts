export type Batch2P2ResumeCurrentBatch = {
  batchId: string;
  batchName?: string;
  batchStatus: string;
  revision: number;
  openTasks: number;
  draftReadyTasks: number;
  conflictTasks: number;
  canSubmit: boolean;
};

export type Batch2P2EvidenceRow = Record<string, unknown>;

export type Batch2P2ResumeEvidence = {
  batches: Batch2P2EvidenceRow[];
  scopeItems: Batch2P2EvidenceRow[];
  reconciliations: Batch2P2EvidenceRow[];
  observations: Batch2P2EvidenceRow[];
  families: Batch2P2EvidenceRow[];
  physicalSkus: Batch2P2EvidenceRow[];
  packages: Batch2P2EvidenceRow[];
  barcodeBindings: Batch2P2EvidenceRow[];
  commercialFamilyLinks: Batch2P2EvidenceRow[];
};

export type Batch2P2SubmitInput = {
  batchId: string;
  expectedRevision: number;
  commandId: string;
  note: string;
};

export type Batch2P2SubmitAcknowledgement = {
  batchId: string;
  batchStatus: string;
  revision: number;
  commandStatus: string;
};

const FL_NOTE = '#338 Batch 2 FL115PLABOX Physical Identity; Owner/Admin confirmed CARTON × 1; no separate sleeve barcode; no inventory authority granted.';
const SB_NOTE = '#338 Batch 2 SB24/32/40LBOX Physical Identity; Owner/Admin confirmed CARTON × 1; no separate sleeve barcode; no inventory authority granted.';

export const BATCH2_P2_RESUME_TARGET = {
  batchId: '97fd2036-d0ff-492d-8ae7-1c9c0e09e526',
  batchName: '#338 Physical Identity Batch 2 low-complexity production canary',
  expectedRevision: 2,
  startCommandId: 'b34fa49b-f374-4237-8479-d9af37890de8',
  submitCommandId: 'bc5538d2-73e0-4aaf-987f-4b53fd8aa75d',
  submitNote: '#338 Batch 2 production submit; two DRAFT Physical Identity payloads independently verified; no inventory authority granted.',
  identities: {
    FL115PLABOX: {
      commercialSkuId: '16be45a8-a98d-4b15-af2e-1846817e8d98',
      surveyObservationId: 'f1b087f0-d964-45cf-acb1-6818ab2b418f',
      reconciliationCommandId: '2353d72f-fd48-434e-a4c0-47f8d0d146ee',
      physicalSkuCode: 'FL115PLABOX',
      physicalName: 'PLA Flat Lid 12/16/24oz Soup Bowl',
      familyCode: 'FL115PLABOX',
      familyName: 'PLA Flat Lid 12/16/24oz Soup Bowl',
      barcode: '19348045010188',
      note: FL_NOTE,
    },
    'SB24/32/40LBOX': {
      commercialSkuId: '7cb8c724-35cb-4132-9437-db4c15e13fde',
      surveyObservationId: '617ad6e4-0860-4189-88e1-781c2d15d6cf',
      reconciliationCommandId: '9d94e547-b6da-4dc4-8829-5046258838da',
      physicalSkuCode: 'SB24/32/40LBOX',
      physicalName: 'RPET Lid Fits 24–40oz Sugarcane Food Bowl',
      familyCode: 'SB24/32/40LBOX',
      familyName: 'RPET Lid Fits 24–40oz Sugarcane Food Bowl',
      barcode: '19348045022914',
      note: SB_NOTE,
    },
  },
} as const;

type TargetKey = keyof typeof BATCH2_P2_RESUME_TARGET.identities;
type TargetIdentity = (typeof BATCH2_P2_RESUME_TARGET.identities)[TargetKey];

function hold(detail: string): never {
  throw new Error(`HOLD — ${detail}; SUBMIT was not called.`);
}

function requireCount(rows: Batch2P2EvidenceRow[], expected: number, label: string) {
  if (rows.length !== expected) hold(`${label} must contain exactly ${expected} row${expected === 1 ? '' : 's'}`);
}

function expectField(row: Batch2P2EvidenceRow, field: string, expected: unknown, label: string) {
  if (row[field] !== expected) hold(`${label} ${field} mismatch`);
}

function expectUnit(value: unknown, label: string) {
  if ((typeof value !== 'number' && typeof value !== 'string') || Number(value) !== 1) {
    hold(`${label} units_in_base_unit must be exactly 1`);
  }
}

function findExactly(
  rows: Batch2P2EvidenceRow[],
  field: string,
  value: string,
  label: string,
) {
  const matches = rows.filter((row) => row[field] === value);
  if (matches.length !== 1) hold(`${label} must contain exactly one row for ${value}`);
  return matches[0];
}

function expectedObservationNote(identity: TargetIdentity) {
  return `SURVEY_OBSERVATION=${identity.surveyObservationId} | ${identity.note}`;
}

function assertPayload(row: Batch2P2EvidenceRow, identity: TargetIdentity) {
  const rawPayload = row.payload;
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    hold(`${identity.physicalSkuCode} observation payload is missing`);
  }
  const payload = rawPayload as Record<string, unknown>;
  const expected: Record<string, unknown> = {
    batchId: BATCH2_P2_RESUME_TARGET.batchId,
    commercialSkuId: identity.commercialSkuId,
    physicalSkuCode: identity.physicalSkuCode,
    physicalName: identity.physicalName,
    brand: null,
    supplier: null,
    familyCode: identity.familyCode,
    familyName: identity.familyName,
    barcode: identity.barcode,
    packageLevel: 'CARTON',
    units: 1,
    policy: 'PROHIBITED',
    preferred: true,
    note: expectedObservationNote(identity),
  };
  const actualKeys = Object.keys(payload).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    hold(`${identity.physicalSkuCode} observation payload fields mismatch`);
  }
  for (const [field, value] of Object.entries(expected)) {
    if (payload[field] !== value) hold(`${identity.physicalSkuCode} observation payload ${field} mismatch`);
  }
}

function assertCurrentBatch(currentBatch: Batch2P2ResumeCurrentBatch | null) {
  if (!currentBatch) hold('current batch authority returned no batch');
  const target = BATCH2_P2_RESUME_TARGET;
  if (currentBatch.batchId !== target.batchId) hold('current batch ID mismatch');
  if (currentBatch.batchStatus !== 'DRAFT') hold('current batch must be DRAFT');
  if (currentBatch.revision !== target.expectedRevision) hold('current batch must be revision 2');
  if (currentBatch.openTasks !== 0 || currentBatch.draftReadyTasks !== 2 || currentBatch.conflictTasks !== 0) {
    hold('current batch tasks must be 0 open / 2 draft-ready / 0 conflict');
  }
  if (!currentBatch.canSubmit) hold('current batch authority returned canSubmit=false');
}

function assertBatchRow(rows: Batch2P2EvidenceRow[]) {
  const target = BATCH2_P2_RESUME_TARGET;
  requireCount(rows, 1, 'batch evidence');
  const row = rows[0];
  for (const [field, expected] of Object.entries({
    id: target.batchId,
    batch_name: target.batchName,
    batch_status: 'DRAFT',
    revision: target.expectedRevision,
    start_command_id: target.startCommandId,
    submit_command_id: null,
    publish_command_id: null,
    submitted_at: null,
    published_at: null,
  })) expectField(row, field, expected, 'batch evidence');
}

function assertScope(rows: Batch2P2EvidenceRow[]) {
  const target = BATCH2_P2_RESUME_TARGET;
  requireCount(rows, 2, 'scope evidence');
  for (const identity of Object.values(target.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'scope evidence');
    expectField(row, 'batch_id', target.batchId, 'scope evidence');
    expectField(row, 'start_command_id', target.startCommandId, 'scope evidence');
  }
}

function assertReconciliations(rows: Batch2P2EvidenceRow[]) {
  const target = BATCH2_P2_RESUME_TARGET;
  requireCount(rows, 2, 'reconciliation evidence');
  for (const identity of Object.values(target.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'reconciliation evidence');
    for (const [field, expected] of Object.entries({
      batch_id: target.batchId,
      survey_observation_id: identity.surveyObservationId,
      command_id: identity.reconciliationCommandId,
      carton_barcode: identity.barcode,
      reconciliation_status: 'DRAFTED',
    })) expectField(row, field, expected, 'reconciliation evidence');
    if (typeof row.product_identity_observation_id !== 'string' || !row.product_identity_observation_id) {
      hold(`${identity.physicalSkuCode} reconciliation observation mapping is missing`);
    }
  }
}

function assertObservations(rows: Batch2P2EvidenceRow[], reconciliations: Batch2P2EvidenceRow[]) {
  const target = BATCH2_P2_RESUME_TARGET;
  requireCount(rows, 2, 'observation evidence');
  for (const identity of Object.values(target.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'observation evidence');
    const reconciliation = findExactly(reconciliations, 'commercial_sku_id', identity.commercialSkuId, 'reconciliation evidence');
    for (const [field, expected] of Object.entries({
      id: reconciliation.product_identity_observation_id,
      batch_id: target.batchId,
      command_id: identity.reconciliationCommandId,
      barcode: identity.barcode,
      package_level: 'CARTON',
      substitution_policy: 'PROHIBITED',
      is_preferred: true,
      observation_status: 'DRAFTED',
    })) expectField(row, field, expected, 'observation evidence');
    expectUnit(row.units_in_base_unit, `${identity.physicalSkuCode} observation`);
    if (typeof row.physical_sku_id !== 'string' || typeof row.family_id !== 'string') {
      hold(`${identity.physicalSkuCode} observation canonical mapping is missing`);
    }
    assertPayload(row, identity);
  }
}

function assertCanonicalRows(evidence: Batch2P2ResumeEvidence) {
  const target = BATCH2_P2_RESUME_TARGET;
  for (const [rows, label] of [
    [evidence.families, 'family evidence'],
    [evidence.physicalSkus, 'Physical evidence'],
    [evidence.packages, 'package evidence'],
    [evidence.barcodeBindings, 'barcode evidence'],
    [evidence.commercialFamilyLinks, 'link evidence'],
  ] as const) requireCount(rows, 2, label);

  for (const identity of Object.values(target.identities)) {
    const observation = findExactly(evidence.observations, 'commercial_sku_id', identity.commercialSkuId, 'observation evidence');
    const family = findExactly(evidence.families, 'family_code', identity.familyCode, 'family evidence');
    for (const [field, expected] of Object.entries({
      id: observation.family_id,
      family_name: identity.familyName,
      identity_status: 'DRAFT',
      created_in_batch_id: target.batchId,
    })) expectField(family, field, expected, 'family evidence');

    const physical = findExactly(evidence.physicalSkus, 'physical_sku_code', identity.physicalSkuCode, 'Physical evidence');
    for (const [field, expected] of Object.entries({
      id: observation.physical_sku_id,
      display_name: identity.physicalName,
      brand: null,
      supplier_name: null,
      family_id: family.id,
      identity_status: 'DRAFT',
      created_in_batch_id: target.batchId,
    })) expectField(physical, field, expected, 'Physical evidence');

    const packageRow = findExactly(evidence.packages, 'physical_sku_id', String(physical.id), 'package evidence');
    for (const [field, expected] of Object.entries({
      package_level: 'CARTON',
      identity_status: 'DRAFT',
      created_in_batch_id: target.batchId,
    })) expectField(packageRow, field, expected, 'package evidence');
    expectUnit(packageRow.units_in_base_unit, `${identity.physicalSkuCode} package`);

    const barcode = findExactly(evidence.barcodeBindings, 'barcode', identity.barcode, 'barcode evidence');
    for (const [field, expected] of Object.entries({
      physical_sku_id: physical.id,
      package_id: packageRow.id,
      identity_status: 'DRAFT',
      created_in_batch_id: target.batchId,
    })) expectField(barcode, field, expected, 'barcode evidence');

    const link = findExactly(evidence.commercialFamilyLinks, 'commercial_sku_id', identity.commercialSkuId, 'link evidence');
    for (const [field, expected] of Object.entries({
      family_id: family.id,
      preferred_physical_sku_id: physical.id,
      substitution_policy: 'PROHIBITED',
      identity_status: 'DRAFT',
      created_in_batch_id: target.batchId,
    })) expectField(link, field, expected, 'link evidence');
  }
}

export function assertBatch2P2ResumeEvidence(
  currentBatch: Batch2P2ResumeCurrentBatch | null,
  evidence: Batch2P2ResumeEvidence,
) {
  assertCurrentBatch(currentBatch);
  assertBatchRow(evidence.batches);
  assertScope(evidence.scopeItems);
  assertReconciliations(evidence.reconciliations);
  assertObservations(evidence.observations, evidence.reconciliations);
  assertCanonicalRows(evidence);
}

export function buildBatch2P2SubmitInput(): Batch2P2SubmitInput {
  return {
    batchId: BATCH2_P2_RESUME_TARGET.batchId,
    expectedRevision: BATCH2_P2_RESUME_TARGET.expectedRevision,
    commandId: BATCH2_P2_RESUME_TARGET.submitCommandId,
    note: BATCH2_P2_RESUME_TARGET.submitNote,
  };
}

export function assertBatch2P2SubmitAcknowledgement(result: Batch2P2SubmitAcknowledgement) {
  if (
    result.batchId !== BATCH2_P2_RESUME_TARGET.batchId
    || result.batchStatus !== 'SUBMITTED'
    || result.revision !== 3
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
  ) hold('SUBMIT acknowledgement must be the exact Batch 2 SUBMITTED rev3 APPLIED/REPLAYED result');
}
