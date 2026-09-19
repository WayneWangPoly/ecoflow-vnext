export type BatchNext2P3CurrentBatch = {
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

export type BatchNext2P3EvidenceRow = Record<string, unknown>;

export type BatchNext2P3Evidence = {
  batches: BatchNext2P3EvidenceRow[];
  scopeItems: BatchNext2P3EvidenceRow[];
  reconciliations: BatchNext2P3EvidenceRow[];
  observations: BatchNext2P3EvidenceRow[];
  tasks: BatchNext2P3EvidenceRow[];
  families: BatchNext2P3EvidenceRow[];
  physicalSkus: BatchNext2P3EvidenceRow[];
  packages: BatchNext2P3EvidenceRow[];
  barcodeBindings: BatchNext2P3EvidenceRow[];
  commercialFamilyLinks: BatchNext2P3EvidenceRow[];
  publicationAudits: BatchNext2P3EvidenceRow[];
  quantitySentinels: {
    inventoryMovements: BatchNext2P3EvidenceRow[];
    warehouseMovements: BatchNext2P3EvidenceRow[];
    warehouseLocationItems: BatchNext2P3EvidenceRow[];
    inventoryBalances: BatchNext2P3EvidenceRow[];
    stockMovements: BatchNext2P3EvidenceRow[];
  };
};

export type BatchNext2P3PublishAcknowledgement = {
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

export const BATCH_NEXT2_P3_TARGET = {
  protectedMainSha: 'e001ddcbcc300cf19ec13e590694157b2ef810c7',
  batchId: 'db7887ba-937e-4782-81a4-3eff21a6dfd4',
  batchName: 'ECOFLOW-328 Batch Next 2 DRAFT-only',
  expectedRevision: 11,
  startCommandId: 'f93b5ce7-80d0-4b41-a756-d2fd382827dd',
  submitCommandId: 'a4c5c70e-8171-4d70-8f52-dbc722c1212c',
  submittedAt: '2026-09-19T04:13:31.171576+00:00',
  publishCommandId: '0b6f54e1-1c36-49c8-9ff1-e6ed4fcb3da2',
  publishNote: 'ECOFLOW-328-BATCH-NEXT2-P3 PUBLISH only; exact ten-SKU SUBMITTED rev11 graph independently verified; activation-only impact preview; no inventory/stocktake/location mutation, barcode reassignment/retirement or provider authority granted.',
  identities: {
    'CCEA16-90': {
      commercialSkuId: '656cd296-4814-4409-b58e-14b9495241f1',
      surveyObservationId: '98cb55ed-9ad6-492a-95ec-946d640b3c73',
      reconcileCommandId: '361e0b4e-7a28-49c1-87b0-bdd830a05270',
      reconciliationId: 'e94dfd69-bc5f-4d7e-b6f7-7ec4423ad394',
      observationId: '18055d0b-5e1a-4b18-b9b9-c7b5308598a5',
      familyId: 'f6444108-1ed9-4f36-b421-19a2d874a6b3',
      physicalSkuId: 'eb7938ee-83b5-402f-b328-7a933fc08f6c',
      packageId: 'b9282601-1ca2-4ef7-bd03-e593420d99ad',
      bindingId: '9aba847d-6bd5-44a0-95b4-edb1396f99cb',
      physicalName: '(90mm) 16oz Double Wall Art Series - 600pcs',
      barcode: '757953138426',
    },
    'CCLGPLA-90': {
      commercialSkuId: 'cb1ba85f-a7f5-422b-98c4-4e587ad4e7cf',
      surveyObservationId: '896eecb7-23f8-4aae-99bf-93b7b4943f35',
      reconcileCommandId: 'd3b3e931-15c2-42d3-ad09-bfba9bfe804e',
      reconciliationId: '05766176-db4e-4b0c-8afa-733ed1f4acf4',
      observationId: 'b8716ec4-891e-469a-802e-079402ffafbd',
      familyId: 'b77dd7df-93c5-4c53-be93-6e065614cdcd',
      physicalSkuId: 'bae1e25a-867d-47a5-bc41-a692fbe57698',
      packageId: 'd7a5b485-912c-4218-be47-5c3da17e8f92',
      bindingId: '6b00eae1-951f-49f5-8225-39939d299f4b',
      physicalName: '90mm PLA Lids Green - 1000pcs',
      barcode: '757953139751',
    },
    'CCSA16-90': {
      commercialSkuId: 'e945e29f-cfca-4d87-83a8-8b29a97650a5',
      surveyObservationId: '880a4fd9-048f-4749-827c-2e60bb6a27b3',
      reconcileCommandId: '770bdad7-b60c-491e-80a1-66cc3e06962d',
      reconciliationId: '54aadb4b-f260-4ebe-ba86-e64eacc56ab3',
      observationId: 'cab46472-bf27-416a-8071-acc5c007d6ed',
      familyId: 'bd6055e6-5797-48b8-94aa-bca155aec0a0',
      physicalSkuId: 'c5779b7d-6b89-4bce-858c-9091f078f634',
      packageId: '64badb6c-5995-4bf7-92ca-ad5351eeb018',
      bindingId: 'b7bc60f3-46a7-4baa-8b4a-126eb873f68f',
      physicalName: '(90mm) 16oz Art Series Single Wall - 1000pcs',
      barcode: '757953138396',
    },
    'CCSA8-80': {
      commercialSkuId: '3e7bdb7a-9215-4b61-9b80-9a4f94131e77',
      surveyObservationId: '725c470b-2e6c-4edb-ad21-cbf7fbc500f0',
      reconcileCommandId: '0ee4632b-6248-47b2-943c-0d3de8c9a627',
      reconciliationId: '3570f325-fd91-4f6e-a1b7-678d07f8ed2f',
      observationId: '213f2c6e-da13-4dc7-9378-d8744b76852a',
      familyId: '730af24e-6137-4bf1-9df7-35ba1a8c5d4c',
      physicalSkuId: '4dcc28f4-02dd-4645-b113-d2c9042883f6',
      packageId: 'd7941944-8d1a-4bd4-a6a9-2e3b6b611203',
      bindingId: '97370363-f6e4-4994-8c1d-a0ed075ff701',
      physicalName: '(80mm) 8oz Art Series Single Wall - 1000pcs',
      barcode: '757953138358',
    },
    'CCSA8-90': {
      commercialSkuId: 'c5aff73b-1405-4e9f-8696-e2aacdf4dc13',
      surveyObservationId: '45833c7d-cebb-43c4-8229-f4b4f7c7261a',
      reconcileCommandId: '3ab72fc4-b2b4-4751-8fa5-fea72821214c',
      reconciliationId: '044c78d0-5db1-4f02-a80a-8bdfba882fbf',
      observationId: '10750bb2-4b20-4c51-91cf-4454f1751658',
      familyId: '215c15e1-0700-46dd-aedd-78966c36f762',
      physicalSkuId: 'e2a1ce6c-2343-450d-947f-554e9b1d8745',
      packageId: '2ef04abc-25ff-4784-ab30-99bdee8a63f6',
      bindingId: '15b90c26-bf12-4383-a38c-90eed10e1fe4',
      physicalName: '(90mm) 8oz Art Series Single Wall',
      barcode: '757953138365',
    },
    'CCSB8-80': {
      commercialSkuId: 'ea271ac3-2b26-46e0-93be-2c1e39db76fe',
      surveyObservationId: '24844232-4696-4173-98fe-98a3b0dd14ed',
      reconcileCommandId: 'f2368798-6245-4324-b02b-e0046d3bfe30',
      reconciliationId: '3211d76a-59e3-423a-82fb-120d5936dcf0',
      observationId: '64d12942-8d4c-4c75-9b3c-e5ac90c2cb58',
      familyId: '3be5f1ca-7c8c-4abb-b8c4-03e1d03b364f',
      physicalSkuId: '8419cbc0-2f38-4d4a-8285-ad1f564cc5b2',
      packageId: '3012f347-430f-4f2d-b9e6-f57bb40a77d3',
      bindingId: '01595c31-3772-4e90-9645-1dccf7607923',
      physicalName: '(80mm) 8oz Compostable Black',
      barcode: '757953138600',
    },
    'CCSKBM8-90': {
      commercialSkuId: '51ac0da9-cf2c-40f0-9a92-02f9ddde4d0f',
      surveyObservationId: 'd1d865b8-e922-4066-b60c-1874e5b7c96c',
      reconcileCommandId: '878df1c1-bf9a-4d02-9821-8bfdd51f63de',
      reconciliationId: '43927ab0-5f5d-4264-8b9e-7bf95b6ccc87',
      observationId: 'a8c013ed-2417-4e71-a81f-e18d4dcaea40',
      familyId: 'ae2f5671-5def-434d-87b4-e1f83160eca8',
      physicalSkuId: '64af64f0-5227-4e5d-a910-6c14dc0e9a3e',
      packageId: '20e63f66-f3a5-41f1-8721-3c51a3d2d586',
      bindingId: '0c5ec4fc-61a8-42c7-9dc6-8b5a3064f87c',
      physicalName: '(90mm) 8oz Compostable Kraft Bamboo',
      barcode: '757953139652',
    },
    'CCSPW8-80': {
      commercialSkuId: '372b9da5-3592-46e1-937c-529f384960a9',
      surveyObservationId: '9123d1e1-b5ab-48da-83ba-70614200826b',
      reconcileCommandId: '26d1a003-4bd8-46df-8f8d-d4534d646386',
      reconciliationId: '3cd856d0-2af5-4cc8-bc53-4b45e0d7a2c3',
      observationId: 'e25c8acb-4bea-4b61-8f6e-0a282ec198b9',
      familyId: '643e482f-0e36-4aae-beaf-23a38fe6008e',
      physicalSkuId: '28805aaf-6715-4361-9b72-230c78c6b3a5',
      packageId: '8e39193d-1f25-4de8-9327-a772404295e1',
      bindingId: '7a76354e-cfe2-4343-bc43-17505ef26e93',
      physicalName: '(80mm) 8oz PLA White - 1000pcs',
      barcode: '757953135500',
    },
    'CCSW6-80': {
      commercialSkuId: '014c8fec-08e7-41b2-97c3-cd30e44e5bac',
      surveyObservationId: '3a72538c-55ea-4163-bf45-e54c0ea3be87',
      reconcileCommandId: 'e37c8e4d-6686-4d17-9b07-068dc4a1ce00',
      reconciliationId: '827f0788-c888-4033-b461-8c849f08d4ef',
      observationId: 'cd6804c4-a7d0-4e14-91f2-a1ffc1593b4f',
      familyId: '18843a04-bf75-45af-ab7a-5f5a35a9a1b4',
      physicalSkuId: '56133121-9a13-4219-962f-185a9e785999',
      packageId: '008e4e45-dad8-4af5-bf4a-2cd5c3a74537',
      bindingId: 'ca1b4482-9802-4d61-a669-ce7934a27199',
      physicalName: '(80mm) 6oz Compostable White',
      barcode: '757953138457',
    },
    KRCL: {
      commercialSkuId: '03d6599a-cfac-4fcb-8e34-76bbae1cba2f',
      surveyObservationId: 'e0094a89-467e-4a8c-a088-d47d76ebeb3f',
      reconcileCommandId: '14e459e6-77a7-44c7-a631-ff2db32fb9c3',
      reconciliationId: '0a258ea0-8709-4656-8fbe-7d8aee48f10e',
      observationId: '0f4a03c0-e289-4d53-933c-292438f67e63',
      familyId: '1f2290de-4cb8-4786-8992-d7a3bd33106b',
      physicalSkuId: 'ac0992d6-f55c-4b9c-8710-e288b7b7105d',
      packageId: '9a04c92c-fa02-4462-a34e-80b16ae56ced',
      bindingId: 'e99b9f09-c927-4e8f-b6b8-f6d88d492887',
      physicalName: '500-1,000ml Kraft Paper Board Takeaway Lid - 300pcs',
      barcode: '19348045026424',
    },
  },
} as const;

type Identity = (typeof BATCH_NEXT2_P3_TARGET.identities)[keyof typeof BATCH_NEXT2_P3_TARGET.identities];

function hold(detail: string): never {
  throw new Error(`HOLD — ${detail}; PUBLISH was not called.`);
}

function requireCount(rows: BatchNext2P3EvidenceRow[], expected: number, label: string) {
  if (rows.length !== expected) hold(`${label} must contain exactly ${expected} rows`);
}

function expectField(row: BatchNext2P3EvidenceRow, field: string, expected: unknown, label: string) {
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

function findExactly(rows: BatchNext2P3EvidenceRow[], field: string, value: string, label: string) {
  const matches = rows.filter((row) => row[field] === value);
  if (matches.length !== 1) hold(`${label} must contain exactly one row for ${value}`);
  return matches[0];
}

function assertCurrentBatch(currentBatch: BatchNext2P3CurrentBatch | null) {
  const t = BATCH_NEXT2_P3_TARGET;
  if (!currentBatch) hold('current batch authority returned no batch');
  if (currentBatch.batchId !== t.batchId) hold('current batch ID mismatch');
  if (currentBatch.batchName !== t.batchName) hold('current batch name mismatch');
  if (currentBatch.batchStatus !== 'SUBMITTED') hold('current batch must be SUBMITTED');
  if (currentBatch.revision !== t.expectedRevision) hold('current batch must be revision 11');
  expectTimestamp(currentBatch.submittedAt, t.submittedAt, 'current batch submitted_at');
  if (currentBatch.publishedAt !== null) hold('current batch published_at must be null');
  if (currentBatch.openTasks !== 0 || currentBatch.draftReadyTasks !== 10 || currentBatch.conflictTasks !== 0 || currentBatch.resolvedTasks !== 0) {
    hold('current batch tasks must be 0 open / 10 draft-ready / 0 conflict / 0 resolved');
  }
  if (currentBatch.canSubmit) hold('current batch unexpectedly returned canSubmit=true');
  if (!currentBatch.canPublish) hold('current batch returned canPublish=false');
}

function assertBatch(rows: BatchNext2P3EvidenceRow[], phase: 'PRE' | 'POST') {
  const t = BATCH_NEXT2_P3_TARGET;
  const published = phase === 'POST';
  requireCount(rows, 1, `${phase} batch evidence`);
  const row = rows[0];
  for (const [field, expected] of Object.entries({
    id: t.batchId,
    batch_name: t.batchName,
    batch_status: published ? 'PUBLISHED' : 'SUBMITTED',
    revision: published ? 12 : 11,
    start_command_id: t.startCommandId,
    submit_command_id: t.submitCommandId,
    publish_command_id: published ? t.publishCommandId : null,
  })) expectField(row, field, expected, `${phase} batch evidence`);
  expectTimestamp(row.submitted_at, t.submittedAt, `${phase} batch submitted_at`);
  if (published) expectNonEmptyTimestamp(row.published_at, 'POST batch published_at');
  else expectField(row, 'published_at', null, 'PRE batch evidence');
}

function assertScope(rows: BatchNext2P3EvidenceRow[]) {
  requireCount(rows, 10, 'scope evidence');
  for (const identity of Object.values(BATCH_NEXT2_P3_TARGET.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'scope evidence');
    expectField(row, 'batch_id', BATCH_NEXT2_P3_TARGET.batchId, 'scope evidence');
    expectField(row, 'start_command_id', BATCH_NEXT2_P3_TARGET.startCommandId, 'scope evidence');
  }
}

function assertReconciliationAndObservation(evidence: BatchNext2P3Evidence, code: string, identity: Identity) {
  const r = findExactly(evidence.reconciliations, 'id', identity.reconciliationId, `${code} reconciliation`);
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT2_P3_TARGET.batchId,
    survey_observation_id: identity.surveyObservationId,
    product_identity_observation_id: identity.observationId,
    command_id: identity.reconcileCommandId,
    commercial_sku_id: identity.commercialSkuId,
    carton_barcode: identity.barcode,
    reconciliation_status: 'DRAFTED',
  })) expectField(r, field, expected, `${code} reconciliation`);

  const o = findExactly(evidence.observations, 'id', identity.observationId, `${code} observation`);
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT2_P3_TARGET.batchId,
    command_id: identity.reconcileCommandId,
    commercial_sku_id: identity.commercialSkuId,
    physical_sku_id: identity.physicalSkuId,
    family_id: identity.familyId,
    barcode: identity.barcode,
    package_level: 'CARTON',
    substitution_policy: 'PROHIBITED',
    is_preferred: true,
    observation_status: 'DRAFTED',
  })) expectField(o, field, expected, `${code} observation`);
  expectUnit(o.units_in_base_unit, `${code} observation`);
}

function assertTasks(rows: BatchNext2P3EvidenceRow[], phase: 'PRE' | 'POST') {
  requireCount(rows, 10, `${phase} task evidence`);
  const expectedStatus = phase === 'POST' ? 'RESOLVED' : 'DRAFT_READY';
  for (const identity of Object.values(BATCH_NEXT2_P3_TARGET.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'task evidence');
    expectField(row, 'batch_id', BATCH_NEXT2_P3_TARGET.batchId, 'task evidence');
    expectField(row, 'task_status', expectedStatus, 'task evidence');
    expectField(row, 'blocking', true, 'task evidence');
  }
}

function assertCanonicalGraph(evidence: BatchNext2P3Evidence, phase: 'PRE' | 'POST') {
  const status = phase === 'POST' ? 'ACTIVE' : 'DRAFT';
  for (const [rows, label] of [
    [evidence.families, 'family'],
    [evidence.physicalSkus, 'Physical SKU'],
    [evidence.packages, 'package'],
    [evidence.barcodeBindings, 'barcode'],
    [evidence.commercialFamilyLinks, 'Commercial-family link'],
  ] as const) requireCount(rows, 10, `${phase} ${label} evidence`);

  for (const [code, identity] of Object.entries(BATCH_NEXT2_P3_TARGET.identities)) {
    const f = findExactly(evidence.families, 'id', identity.familyId, `${code} family`);
    for (const [field, expected] of Object.entries({
      family_code: code,
      family_name: identity.physicalName,
      identity_status: status,
      created_in_batch_id: BATCH_NEXT2_P3_TARGET.batchId,
    })) expectField(f, field, expected, `${code} family`);

    const p = findExactly(evidence.physicalSkus, 'id', identity.physicalSkuId, `${code} Physical SKU`);
    for (const [field, expected] of Object.entries({
      physical_sku_code: code,
      display_name: identity.physicalName,
      brand: null,
      supplier_name: null,
      family_id: identity.familyId,
      identity_status: status,
      created_in_batch_id: BATCH_NEXT2_P3_TARGET.batchId,
    })) expectField(p, field, expected, `${code} Physical SKU`);

    const pkg = findExactly(evidence.packages, 'id', identity.packageId, `${code} package`);
    for (const [field, expected] of Object.entries({
      physical_sku_id: identity.physicalSkuId,
      package_level: 'CARTON',
      identity_status: status,
      created_in_batch_id: BATCH_NEXT2_P3_TARGET.batchId,
    })) expectField(pkg, field, expected, `${code} package`);
    expectUnit(pkg.units_in_base_unit, `${code} package`);

    const binding = findExactly(evidence.barcodeBindings, 'id', identity.bindingId, `${code} barcode`);
    for (const [field, expected] of Object.entries({
      barcode: identity.barcode,
      physical_sku_id: identity.physicalSkuId,
      package_id: identity.packageId,
      identity_status: status,
      created_in_batch_id: BATCH_NEXT2_P3_TARGET.batchId,
    })) expectField(binding, field, expected, `${code} barcode`);

    const link = findExactly(evidence.commercialFamilyLinks, 'commercial_sku_id', identity.commercialSkuId, `${code} link`);
    for (const [field, expected] of Object.entries({
      family_id: identity.familyId,
      preferred_physical_sku_id: identity.physicalSkuId,
      substitution_policy: 'PROHIBITED',
      identity_status: status,
      created_in_batch_id: BATCH_NEXT2_P3_TARGET.batchId,
    })) expectField(link, field, expected, `${code} link`);
  }
}

function assertPublicationAudit(rows: BatchNext2P3EvidenceRow[], phase: 'PRE' | 'POST') {
  requireCount(rows, 1, `${phase} publication audit`);
  const row = rows[0];
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT2_P3_TARGET.batchId,
    batch_name: BATCH_NEXT2_P3_TARGET.batchName,
    batch_status: phase === 'POST' ? 'PUBLISHED' : 'SUBMITTED',
    revision: phase === 'POST' ? 12 : 11,
    observation_count: 10,
    conflict_observation_count: 0,
  })) expectField(row, field, expected, `${phase} publication audit`);
  expectTimestamp(row.submitted_at, BATCH_NEXT2_P3_TARGET.submittedAt, `${phase} publication audit submitted_at`);
  if (phase === 'POST') expectNonEmptyTimestamp(row.published_at, 'POST publication audit published_at');
  else expectField(row, 'published_at', null, 'PRE publication audit');
}

function assertQuantityIsolation(evidence: BatchNext2P3Evidence, phase: 'PRE' | 'POST') {
  for (const [key, rows] of Object.entries(evidence.quantitySentinels)) {
    if (rows.length !== 0) hold(`${phase} quantity isolation sentinel ${key} must remain empty`);
  }
}

export function assertBatchNext2P3Preflight(
  currentBatch: BatchNext2P3CurrentBatch | null,
  evidence: BatchNext2P3Evidence,
) {
  assertCurrentBatch(currentBatch);
  assertBatch(evidence.batches, 'PRE');
  assertScope(evidence.scopeItems);
  requireCount(evidence.reconciliations, 10, 'reconciliation evidence');
  requireCount(evidence.observations, 10, 'observation evidence');
  for (const [code, identity] of Object.entries(BATCH_NEXT2_P3_TARGET.identities)) {
    assertReconciliationAndObservation(evidence, code, identity);
  }
  assertTasks(evidence.tasks, 'PRE');
  assertCanonicalGraph(evidence, 'PRE');
  assertPublicationAudit(evidence.publicationAudits, 'PRE');
  assertQuantityIsolation(evidence, 'PRE');
}

export function assertBatchNext2P3Postflight(evidence: BatchNext2P3Evidence) {
  assertBatch(evidence.batches, 'POST');
  assertScope(evidence.scopeItems);
  requireCount(evidence.reconciliations, 10, 'POST reconciliation evidence');
  requireCount(evidence.observations, 10, 'POST observation evidence');
  for (const [code, identity] of Object.entries(BATCH_NEXT2_P3_TARGET.identities)) {
    assertReconciliationAndObservation(evidence, code, identity);
  }
  assertTasks(evidence.tasks, 'POST');
  assertCanonicalGraph(evidence, 'POST');
  assertPublicationAudit(evidence.publicationAudits, 'POST');
  assertQuantityIsolation(evidence, 'POST');
}

export function buildBatchNext2P3PublishInput() {
  return {
    batchId: BATCH_NEXT2_P3_TARGET.batchId,
    expectedRevision: BATCH_NEXT2_P3_TARGET.expectedRevision,
    commandId: BATCH_NEXT2_P3_TARGET.publishCommandId,
    note: BATCH_NEXT2_P3_TARGET.publishNote,
  };
}

export function assertBatchNext2P3PublishAcknowledgement(result: BatchNext2P3PublishAcknowledgement) {
  if (
    result.batchId !== BATCH_NEXT2_P3_TARGET.batchId
    || result.batchStatus !== 'PUBLISHED'
    || result.revision !== 12
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
    || result.publishedFamilies !== 10
    || result.publishedPhysicalSkus !== 10
    || result.publishedBarcodes !== 10
    || result.publishedLinks !== 10
    || typeof result.publishedAt !== 'string'
    || !result.publishedAt
    || Number.isNaN(Date.parse(result.publishedAt))
  ) throw new Error('Batch Next 2 P3 PUBLISH acknowledgement is not the exact PUBLISHED rev12 / 10-10-10-10 result.');
}

export function formatBatchNext2P3Failure(error: unknown, commandCrossedBoundary: boolean) {
  const detail = error instanceof Error ? error.message : String(error);
  if (commandCrossedBoundary) {
    return `HOLD — PUBLISH may have been called; do not retry or use a new command ID. Perform read-only server verification before any retry. Detail: ${detail}`;
  }
  if (detail.startsWith('HOLD —')) return detail;
  return `HOLD — ${detail}; PUBLISH was not called.`;
}
