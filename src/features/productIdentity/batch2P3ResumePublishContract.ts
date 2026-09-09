export type Batch2P3ResumeCurrentBatch = {
  batchId: string;
  batchName?: string;
  batchStatus: string;
  revision: number;
  submittedAt: string | null;
  publishedAt: string | null;
  openTasks: number;
  draftReadyTasks: number;
  conflictTasks: number;
  resolvedTasks: number;
  canSubmit: boolean;
  canPublish: boolean;
};

export type Batch2P3EvidenceRow = Record<string, unknown>;

export type Batch2P3ResumeEvidence = {
  batches: Batch2P3EvidenceRow[];
  scopeItems: Batch2P3EvidenceRow[];
  reconciliations: Batch2P3EvidenceRow[];
  observations: Batch2P3EvidenceRow[];
  tasks: Batch2P3EvidenceRow[];
  families: Batch2P3EvidenceRow[];
  physicalSkus: Batch2P3EvidenceRow[];
  packages: Batch2P3EvidenceRow[];
  barcodeBindings: Batch2P3EvidenceRow[];
  commercialFamilyLinks: Batch2P3EvidenceRow[];
  publicationAudits: Batch2P3EvidenceRow[];
  quantitySentinels: {
    inventoryMovements: Batch2P3EvidenceRow[];
    warehouseMovements: Batch2P3EvidenceRow[];
    warehouseLocationItems: Batch2P3EvidenceRow[];
    inventoryBalances: Batch2P3EvidenceRow[];
    stockMovements: Batch2P3EvidenceRow[];
  };
};

export type Batch2P3PublishInput = {
  batchId: string;
  expectedRevision: number;
  commandId: string;
  note: string;
};

export type Batch2P3PublishAcknowledgement = {
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

const FL_NOTE = '#338 Batch 2 FL115PLABOX Physical Identity; Owner/Admin confirmed CARTON × 1; no separate sleeve barcode; no inventory authority granted.';
const SB_NOTE = '#338 Batch 2 SB24/32/40LBOX Physical Identity; Owner/Admin confirmed CARTON × 1; no separate sleeve barcode; no inventory authority granted.';

export const BATCH2_P3_RESUME_TARGET = {
  batchId: '97fd2036-d0ff-492d-8ae7-1c9c0e09e526',
  batchName: '#338 Physical Identity Batch 2 low-complexity production canary',
  expectedRevision: 3,
  startCommandId: 'b34fa49b-f374-4237-8479-d9af37890de8',
  submitCommandId: 'bc5538d2-73e0-4aaf-987f-4b53fd8aa75d',
  submittedAt: '2026-09-09T12:39:14.496466Z',
  publishCommandId: '82041faf-fdfa-4d2f-882c-d2c1c33ecd7a',
  publishNote: '#338 Batch 2 production publish; two DRAFT payloads and SUBMIT independently verified; no inventory authority granted.',
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

type TargetIdentity = (typeof BATCH2_P3_RESUME_TARGET.identities)[keyof typeof BATCH2_P3_RESUME_TARGET.identities];

function hold(detail: string): never {
  throw new Error(`HOLD — ${detail}; PUBLISH was not called.`);
}

function requireCount(rows: Batch2P3EvidenceRow[], expected: number, label: string) {
  if (rows.length !== expected) hold(`${label} must contain exactly ${expected} row${expected === 1 ? '' : 's'}`);
}

function expectField(row: Batch2P3EvidenceRow, field: string, expected: unknown, label: string) {
  if (row[field] !== expected) hold(`${label} ${field} mismatch`);
}

function expectTimestamp(value: unknown, expected: string, label: string) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || Date.parse(value) !== Date.parse(expected)) {
    hold(`${label} timestamp mismatch`);
  }
}

function expectNonEmptyTimestamp(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) {
    hold(`${label} must be a non-null timestamp`);
  }
}

function expectUnit(value: unknown, label: string) {
  if ((typeof value !== 'number' && typeof value !== 'string') || Number(value) !== 1) {
    hold(`${label} units_in_base_unit must be exactly 1`);
  }
}

function findExactly(rows: Batch2P3EvidenceRow[], field: string, value: string, label: string) {
  const matches = rows.filter((row) => row[field] === value);
  if (matches.length !== 1) hold(`${label} must contain exactly one row for ${value}`);
  return matches[0];
}

function assertPayload(row: Batch2P3EvidenceRow, identity: TargetIdentity) {
  const rawPayload = row.payload;
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    hold(`${identity.physicalSkuCode} observation payload is missing`);
  }
  const payload = rawPayload as Record<string, unknown>;
  const expected: Record<string, unknown> = {
    batchId: BATCH2_P3_RESUME_TARGET.batchId,
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
    note: `SURVEY_OBSERVATION=${identity.surveyObservationId} | ${identity.note}`,
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

function assertCurrentBatch(currentBatch: Batch2P3ResumeCurrentBatch | null) {
  const target = BATCH2_P3_RESUME_TARGET;
  if (!currentBatch) hold('current batch authority returned no batch');
  if (currentBatch.batchId !== target.batchId) hold('current batch ID mismatch');
  if (currentBatch.batchName !== target.batchName) hold('current batch name mismatch');
  if (currentBatch.batchStatus !== 'SUBMITTED') hold('current batch must be SUBMITTED');
  if (currentBatch.revision !== target.expectedRevision) hold('current batch must be revision 3');
  expectTimestamp(currentBatch.submittedAt, target.submittedAt, 'current batch submitted_at');
  if (currentBatch.publishedAt !== null) hold('current batch published_at must be null');
  if (currentBatch.openTasks !== 0 || currentBatch.draftReadyTasks !== 2 || currentBatch.conflictTasks !== 0 || currentBatch.resolvedTasks !== 0) {
    hold('current batch tasks must be 0 open / 2 draft-ready / 0 conflict / 0 resolved');
  }
  if (currentBatch.canSubmit) hold('current batch authority unexpectedly returned canSubmit=true');
  if (!currentBatch.canPublish) hold('current batch authority returned canPublish=false');
}

function assertBatch(rows: Batch2P3EvidenceRow[], phase: 'PRE' | 'POST') {
  const target = BATCH2_P3_RESUME_TARGET;
  const published = phase === 'POST';
  requireCount(rows, 1, `${phase === 'POST' ? 'postflight ' : ''}batch evidence`);
  const row = rows[0];
  for (const [field, expected] of Object.entries({
    id: target.batchId,
    batch_name: target.batchName,
    batch_status: published ? 'PUBLISHED' : 'SUBMITTED',
    revision: published ? 4 : 3,
    start_command_id: target.startCommandId,
    submit_command_id: target.submitCommandId,
    publish_command_id: published ? target.publishCommandId : null,
  })) expectField(row, field, expected, `${phase === 'POST' ? 'postflight ' : ''}batch evidence`);
  expectTimestamp(row.submitted_at, target.submittedAt, 'batch submitted_at');
  if (published) expectNonEmptyTimestamp(row.published_at, 'postflight batch published_at');
  else expectField(row, 'published_at', null, 'batch evidence');
}

function assertScope(rows: Batch2P3EvidenceRow[]) {
  const target = BATCH2_P3_RESUME_TARGET;
  requireCount(rows, 2, 'scope evidence');
  for (const identity of Object.values(target.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'scope evidence');
    expectField(row, 'batch_id', target.batchId, 'scope evidence');
    expectField(row, 'start_command_id', target.startCommandId, 'scope evidence');
  }
}

function assertReconciliations(rows: Batch2P3EvidenceRow[]) {
  const target = BATCH2_P3_RESUME_TARGET;
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

function assertObservations(rows: Batch2P3EvidenceRow[], reconciliations: Batch2P3EvidenceRow[]) {
  const target = BATCH2_P3_RESUME_TARGET;
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

function assertTasks(rows: Batch2P3EvidenceRow[], phase: 'PRE' | 'POST') {
  const target = BATCH2_P3_RESUME_TARGET;
  const taskStatus = phase === 'POST' ? 'RESOLVED' : 'DRAFT_READY';
  requireCount(rows, 2, `${phase === 'POST' ? 'postflight ' : ''}task evidence`);
  for (const identity of Object.values(target.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'task evidence');
    expectField(row, 'batch_id', target.batchId, 'task evidence');
    expectField(row, 'task_status', taskStatus, 'task evidence');
    expectField(row, 'blocking', true, 'task evidence');
  }
}

function assertCanonicalRows(evidence: Batch2P3ResumeEvidence, phase: 'PRE' | 'POST') {
  const target = BATCH2_P3_RESUME_TARGET;
  const status = phase === 'POST' ? 'ACTIVE' : 'DRAFT';
  for (const [rows, label] of [
    [evidence.families, 'family evidence'], [evidence.physicalSkus, 'Physical evidence'],
    [evidence.packages, 'package evidence'], [evidence.barcodeBindings, 'barcode evidence'],
    [evidence.commercialFamilyLinks, 'link evidence'],
  ] as const) requireCount(rows, 2, `${phase === 'POST' ? 'postflight ' : ''}${label}`);

  for (const identity of Object.values(target.identities)) {
    const observation = findExactly(evidence.observations, 'commercial_sku_id', identity.commercialSkuId, 'observation evidence');
    const family = findExactly(evidence.families, 'family_code', identity.familyCode, 'family evidence');
    for (const [field, expected] of Object.entries({ id: observation.family_id, family_name: identity.familyName, identity_status: status, created_in_batch_id: target.batchId })) {
      expectField(family, field, expected, 'family evidence');
    }
    const physical = findExactly(evidence.physicalSkus, 'physical_sku_code', identity.physicalSkuCode, 'Physical evidence');
    for (const [field, expected] of Object.entries({ id: observation.physical_sku_id, display_name: identity.physicalName, brand: null, supplier_name: null, family_id: family.id, identity_status: status, created_in_batch_id: target.batchId })) {
      expectField(physical, field, expected, 'Physical evidence');
    }
    const packageRow = findExactly(evidence.packages, 'physical_sku_id', String(physical.id), 'package evidence');
    for (const [field, expected] of Object.entries({ package_level: 'CARTON', identity_status: status, created_in_batch_id: target.batchId })) {
      expectField(packageRow, field, expected, 'package evidence');
    }
    expectUnit(packageRow.units_in_base_unit, `${identity.physicalSkuCode} package`);
    const barcode = findExactly(evidence.barcodeBindings, 'barcode', identity.barcode, 'barcode evidence');
    for (const [field, expected] of Object.entries({ physical_sku_id: physical.id, package_id: packageRow.id, identity_status: status, created_in_batch_id: target.batchId })) {
      expectField(barcode, field, expected, 'barcode evidence');
    }
    const link = findExactly(evidence.commercialFamilyLinks, 'commercial_sku_id', identity.commercialSkuId, 'link evidence');
    for (const [field, expected] of Object.entries({ family_id: family.id, preferred_physical_sku_id: physical.id, substitution_policy: 'PROHIBITED', identity_status: status, created_in_batch_id: target.batchId })) {
      expectField(link, field, expected, 'link evidence');
    }
  }
}

function assertPublicationAudit(rows: Batch2P3EvidenceRow[], phase: 'PRE' | 'POST') {
  const target = BATCH2_P3_RESUME_TARGET;
  const published = phase === 'POST';
  requireCount(rows, 1, `${phase === 'POST' ? 'postflight ' : ''}publication audit evidence`);
  const row = rows[0];
  for (const [field, expected] of Object.entries({
    batch_id: target.batchId,
    batch_name: target.batchName,
    batch_status: published ? 'PUBLISHED' : 'SUBMITTED',
    revision: published ? 4 : 3,
    observation_count: 2,
    conflict_observation_count: 0,
  })) expectField(row, field, expected, `${phase === 'POST' ? 'postflight ' : ''}publication audit evidence`);
  expectTimestamp(row.submitted_at, target.submittedAt, 'publication audit submitted_at');
  if (published) expectNonEmptyTimestamp(row.published_at, 'postflight publication audit published_at');
  else expectField(row, 'published_at', null, 'publication audit evidence');
}

function assertQuantityIsolation(evidence: Batch2P3ResumeEvidence) {
  for (const [label, rows] of Object.entries(evidence.quantitySentinels)) {
    if (!Array.isArray(rows) || rows.length !== 0) hold(`quantity isolation ${label} sentinel must contain zero rows`);
  }
}

function assertSharedEvidence(evidence: Batch2P3ResumeEvidence, phase: 'PRE' | 'POST') {
  assertBatch(evidence.batches, phase);
  assertScope(evidence.scopeItems);
  assertReconciliations(evidence.reconciliations);
  assertObservations(evidence.observations, evidence.reconciliations);
  assertTasks(evidence.tasks, phase);
  assertCanonicalRows(evidence, phase);
  assertPublicationAudit(evidence.publicationAudits, phase);
  assertQuantityIsolation(evidence);
}

export function assertBatch2P3Preflight(currentBatch: Batch2P3ResumeCurrentBatch | null, evidence: Batch2P3ResumeEvidence) {
  assertCurrentBatch(currentBatch);
  assertSharedEvidence(evidence, 'PRE');
}

export function assertBatch2P3Postflight(evidence: Batch2P3ResumeEvidence) {
  try {
    assertSharedEvidence(evidence, 'POST');
    const batchPublishedAt = evidence.batches[0]?.published_at;
    const auditPublishedAt = evidence.publicationAudits[0]?.published_at;
    if (typeof batchPublishedAt !== 'string' || typeof auditPublishedAt !== 'string' || Date.parse(batchPublishedAt) !== Date.parse(auditPublishedAt)) {
      hold('postflight published_at evidence mismatch');
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.startsWith('HOLD —')) throw new Error(detail.replace('; PUBLISH was not called.', ''));
    throw error;
  }
}

export function buildBatch2P3PublishInput(): Batch2P3PublishInput {
  return {
    batchId: BATCH2_P3_RESUME_TARGET.batchId,
    expectedRevision: BATCH2_P3_RESUME_TARGET.expectedRevision,
    commandId: BATCH2_P3_RESUME_TARGET.publishCommandId,
    note: BATCH2_P3_RESUME_TARGET.publishNote,
  };
}

export function assertBatch2P3PublishAcknowledgement(result: Batch2P3PublishAcknowledgement) {
  const publishedAtPresent = typeof result.publishedAt === 'string' && result.publishedAt.trim().length > 0 && !Number.isNaN(Date.parse(result.publishedAt));
  if (
    result.batchId !== BATCH2_P3_RESUME_TARGET.batchId
    || result.batchStatus !== 'PUBLISHED'
    || result.revision !== 4
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
    || result.publishedFamilies !== 2
    || result.publishedPhysicalSkus !== 2
    || result.publishedBarcodes !== 2
    || result.publishedLinks !== 2
    || !publishedAtPresent
  ) throw new Error('Batch 2 P3 PUBLISH acknowledgement is not the exact PUBLISHED rev4 APPLIED/REPLAYED 2/2/2/2 result.');
}

export function formatBatch2P3ResumeFailure(error: unknown, commandCrossedBoundary: boolean) {
  const detail = error instanceof Error ? error.message : String(error);
  if (commandCrossedBoundary) {
    return `HOLD — PUBLISH may have been called; perform read-only server verification before any retry. Do not retry or use a new command ID. Detail: ${detail}`;
  }
  if (detail.startsWith('HOLD —')) return detail;
  return `HOLD — ${detail}; PUBLISH was not called.`;
}
