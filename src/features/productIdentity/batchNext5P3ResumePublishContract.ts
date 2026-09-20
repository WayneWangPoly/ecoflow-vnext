export type BatchNext5P3CurrentBatch = {
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

export type BatchNext5P3EvidenceRow = Record<string, unknown>;

export type BatchNext5P3Evidence = {
  batches: BatchNext5P3EvidenceRow[];
  scopeItems: BatchNext5P3EvidenceRow[];
  reconciliations: BatchNext5P3EvidenceRow[];
  observations: BatchNext5P3EvidenceRow[];
  tasks: BatchNext5P3EvidenceRow[];
  families: BatchNext5P3EvidenceRow[];
  physicalSkus: BatchNext5P3EvidenceRow[];
  packages: BatchNext5P3EvidenceRow[];
  barcodeBindings: BatchNext5P3EvidenceRow[];
  commercialFamilyLinks: BatchNext5P3EvidenceRow[];
  publicationAudits: BatchNext5P3EvidenceRow[];
  quantitySentinels: {
    inventoryMovements: BatchNext5P3EvidenceRow[];
    warehouseMovements: BatchNext5P3EvidenceRow[];
    warehouseLocationItems: BatchNext5P3EvidenceRow[];
    inventoryBalances: BatchNext5P3EvidenceRow[];
    stockMovements: BatchNext5P3EvidenceRow[];
  };
};

export type BatchNext5P3PublishAcknowledgement = {
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

export const BATCH_NEXT5_P3_TARGET = {
  protectedMainSha: '22e4dd4dc5f6c94a304b2c3230a5b1d27994334e',
  batchId: 'ab01a3b6-04c6-4ce2-b7d1-65d878fb6669',
  batchName: 'ECOFLOW-328 Batch Next 5 DRAFT-only',
  expectedRevision: 9,
  startCommandId: '6e0520a2-42bb-4caa-be57-13978326f4ed',
  submitCommandId: '29ba6829-d831-4c8c-bf45-f6e79dfb64d6',
  submittedAt: '2026-09-19T23:53:44.738195+00:00',
  publishCommandId: '06e765f0-b07d-4f1b-9844-a64492be27a9',
  publishNote: 'ECOFLOW-328-BATCH-NEXT5-P3 PUBLISH only; exact eight-SKU SUBMITTED rev9 graph independently verified; activation-only impact preview; no inventory/stocktake/location mutation, barcode reassignment/retirement or provider authority granted.',
  identities: {
    "PSJALLBLACK": {
        "commercialSkuId": "074d8387-3158-4324-8c33-27242b96e4d7",
        "surveyObservationId": "da4d26db-d5b6-4e03-bd79-4c47d4bb2d42",
        "reconcileCommandId": "0210e278-c82c-420d-b552-3471781bbd89",
        "reconciliationId": "4d0d7218-4c9e-4d71-9e32-c5575599bde9",
        "observationId": "e9d3531d-b639-4f1e-a2c1-644a689d9690",
        "familyId": "8c082042-9ede-4d7d-b30d-53356a7b6076",
        "physicalSkuId": "52e26971-98d0-48d8-8587-c7da2f4473f3",
        "packageId": "dfd354b6-d41a-4c44-aad1-b1646f6f1d09",
        "bindingId": "332a6cc1-ca5b-4830-80cc-ab2f27b4bc33",
        "linkId": "5a1b0cce-755d-49af-8b81-8ad87c1135d5",
        "physicalName": "10mm All Black Paper Straw Jumbo - 2500pcs",
        "barcode": "19348045023089"
    },
    "WRC750": {
        "commercialSkuId": "fb3eb334-3511-45b1-83ce-d72a646a5517",
        "surveyObservationId": "fc88c60f-f46a-467d-9cc3-96c20399dc21",
        "reconcileCommandId": "3526db98-c1ad-41a5-a89c-d85051837e37",
        "reconciliationId": "36a9d89a-9548-40db-8502-2dea55b0b1ad",
        "observationId": "765f5083-3e9a-48c9-9359-29fff03b79f8",
        "familyId": "6a5b3c7c-fedd-4046-baf8-caeb36d1c96c",
        "physicalSkuId": "140c2e20-3d63-4cb8-a68b-0af166104f76",
        "packageId": "7f622f6b-72e3-4353-9c16-60471c875ad3",
        "bindingId": "565b39a5-e196-44d7-b516-f9921a844295",
        "linkId": "69440f3a-ca43-4d71-9e55-e3577b724b7d",
        "physicalName": "750ml Plain Board Takeaway Base Carton - 300pcs",
        "barcode": "19348045026400"
    },
    "KRC500": {
        "commercialSkuId": "98a9ca25-5212-4527-95db-dc8c6556818a",
        "surveyObservationId": "c3152cb8-2c0e-4f62-a93e-f05546b52164",
        "reconcileCommandId": "63a76d0b-dc00-4a7c-bf6f-d52d18eabe23",
        "reconciliationId": "60b79ea4-1863-43a0-8b9d-1f45f498fbda",
        "observationId": "db532652-70d4-4073-a2fa-f823eee85776",
        "familyId": "f22b2530-bb28-4495-9aed-65fe79df172a",
        "physicalSkuId": "74fc2293-3e8d-4788-acf7-2d35f646567f",
        "packageId": "4042abe4-53df-4c02-97ed-325115ff3f56",
        "bindingId": "7fa31a53-97bd-4ba8-902b-b34ebf7a78bb",
        "linkId": "daf6251d-dc4c-4bca-9fc9-94de96a20e7a",
        "physicalName": "500ml Kraft Board Takeaway Base Carton - 300pcs",
        "barcode": "(01)19348045026301"
    },
    "Q404S0001": {
        "commercialSkuId": "b47f9e60-695d-415a-9d92-f7898128258c",
        "surveyObservationId": "fb352305-8b1c-42af-981d-559e68844c98",
        "reconcileCommandId": "28227a5a-1f14-400d-831f-6883fe5f92c2",
        "reconciliationId": "1903184a-ec65-4cd7-ad02-4c27b63720be",
        "observationId": "5d455f3d-f110-4c27-9f48-c92a6d535b00",
        "familyId": "80390775-1fb3-4bc7-a492-8dcbb3a6cf7c",
        "physicalSkuId": "afe617bd-e341-44a6-8090-12aa220fdf8c",
        "packageId": "1df994f4-cfa5-42cf-9579-22518f5de8fa",
        "bindingId": "972c7a42-ab57-4dfc-b1bb-94f9614b3bd3",
        "linkId": "24f24458-9415-446e-8d51-ab2f447b7fd8",
        "physicalName": "9inch White Cake Box with Window 240x240x120mm - Pack of 100pcs",
        "barcode": "19310707018139"
    },
    "SB32BOX": {
        "commercialSkuId": "fb02055e-656d-448b-a1b5-2897cace0a09",
        "surveyObservationId": "27e172af-cd68-4b57-b1da-622af99e2b31",
        "reconcileCommandId": "49faf34e-5731-4a6f-aa74-325cd745e743",
        "reconciliationId": "d2bb87d0-92d0-4c78-bbca-a0ceab17f1f2",
        "observationId": "273f6857-a016-4c2d-8df3-3f7829d7a0b8",
        "familyId": "f2b38994-23de-41b0-b614-1768f1cf6e9b",
        "physicalSkuId": "ca96b5b7-4b24-4b27-8a6e-608d1b21f15e",
        "packageId": "187a0606-69f4-4153-8e9e-c6b33c7bdf86",
        "bindingId": "5bf97443-dc71-4dac-8e2e-0c3c758153be",
        "linkId": "9b2e9c47-cf51-4729-ab36-71c99e00adf8",
        "physicalName": "32oz - 940ml Natural Plant Sugarcane Food Bowl - 125pcs",
        "barcode": "19348045022860"
    },
    "Q-500": {
        "commercialSkuId": "ba3acca8-471a-4cb7-838d-ac76d8964780",
        "surveyObservationId": "8c0c0907-f375-4b09-95b9-d1a67771724e",
        "reconcileCommandId": "8c8b5149-7918-4a49-b46a-069f98809604",
        "reconciliationId": "2331f332-b922-4896-ba17-e2b270b5a79a",
        "observationId": "eebea1ec-07ac-489d-83ff-0ab2a951b9ee",
        "familyId": "6f234f8e-fb4f-4661-890e-220c18578f8e",
        "physicalSkuId": "182fcb5c-05a1-420d-a282-6632f3b23840",
        "packageId": "a3ea26b9-f14a-4632-9c75-4c0f0fdf4613",
        "bindingId": "e0483457-76a8-482f-a55c-af12dd65a689",
        "linkId": "fc1c2e1e-6bb7-4b3a-9ee8-d6ae26c17420",
        "physicalName": "500ml Clear Tumbler BioCup",
        "barcode": "19344062035265"
    },
    "SB24/32/40SLBOX": {
        "commercialSkuId": "123b19b8-652f-4159-8ead-b952a1043317",
        "surveyObservationId": "6c03b9d7-00eb-4685-bfbf-a9cf5727bf68",
        "reconcileCommandId": "27615c80-6a3b-459d-8dec-04b49be3ab8f",
        "reconciliationId": "1489a404-f3fa-417d-a858-c6d67271124e",
        "observationId": "171a91de-df34-42c7-8cb8-fa1a69f4e9d4",
        "familyId": "1da6cc13-7fdb-4f53-88d4-26c8b617dded",
        "physicalSkuId": "becc2657-7b1c-4f02-97c4-73d3ea501033",
        "packageId": "d51d5342-e2a9-4c00-bc84-1fa20a1d0238",
        "bindingId": "7956cfda-20a7-4c1f-acb0-852f57114bcc",
        "linkId": "e3739800-f094-4ea0-98d7-241ca3082304",
        "physicalName": "800-1,180ml | 24-40oz Natural Sugarcane Plant Lids - 125pcs",
        "barcode": "19348045024383"
    },
    "CC832F": {
        "commercialSkuId": "6cd35ac2-c69b-4231-84ba-ac86b938e41a",
        "surveyObservationId": "d6c6536c-ba8d-4982-a70f-e81ff88f7b25",
        "reconcileCommandId": "8e4f839e-4f46-46cd-8763-809c68ae17f2",
        "reconciliationId": "a78621f9-6b53-4bc4-95a6-c92ec5fa000f",
        "observationId": "24b57f01-b92f-448a-b022-5d63a9716b38",
        "familyId": "0c802375-96af-416d-8415-8f089bdbd64d",
        "physicalSkuId": "b998c8a5-f4eb-40f3-98d6-9d6b49719d32",
        "packageId": "376ef72c-0f9f-4159-8b55-eaddb9ca1e16",
        "bindingId": "4fb01c28-e455-4385-9b15-0f86ceaebc04",
        "linkId": "807f8f7a-fdcf-4341-af41-134a620388e1",
        "physicalName": "4-Cup Egg Tray (Non Bio) - 300pcs",
        "barcode": "19348045037963"
    }
}
} as const;

type Identity = (typeof BATCH_NEXT5_P3_TARGET.identities)[keyof typeof BATCH_NEXT5_P3_TARGET.identities];

function hold(detail: string): never {
  throw new Error(`HOLD — ${detail}; PUBLISH was not called.`);
}

function requireCount(rows: BatchNext5P3EvidenceRow[], expected: number, label: string) {
  if (rows.length !== expected) hold(`${label} must contain exactly ${expected} rows`);
}

function expectField(row: BatchNext5P3EvidenceRow, field: string, expected: unknown, label: string) {
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

function findExactly(rows: BatchNext5P3EvidenceRow[], field: string, value: string, label: string) {
  const matches = rows.filter((row) => row[field] === value);
  if (matches.length !== 1) hold(`${label} must contain exactly one row for ${value}`);
  return matches[0];
}

function assertCurrentBatch(currentBatch: BatchNext5P3CurrentBatch | null) {
  const t = BATCH_NEXT5_P3_TARGET;
  if (!currentBatch) hold('current batch authority returned no batch');
  if (currentBatch.batchId !== t.batchId) hold('current batch ID mismatch');
  if (currentBatch.batchName !== t.batchName) hold('current batch name mismatch');
  if (currentBatch.batchStatus !== 'SUBMITTED') hold('current batch must be SUBMITTED');
  if (currentBatch.revision !== t.expectedRevision) hold('current batch must be revision 9');
  expectTimestamp(currentBatch.submittedAt, t.submittedAt, 'current batch submitted_at');
  if (currentBatch.publishedAt !== null) hold('current batch published_at must be null');
  if (currentBatch.openTasks !== 0 || currentBatch.draftReadyTasks !== 8 || currentBatch.conflictTasks !== 0 || currentBatch.resolvedTasks !== 0) {
    hold('current batch tasks must be 0 open / 8 draft-ready / 0 conflict / 0 resolved');
  }
  if (currentBatch.canSubmit) hold('current batch unexpectedly returned canSubmit=true');
  if (!currentBatch.canPublish) hold('current batch returned canPublish=false');
}

function assertBatch(rows: BatchNext5P3EvidenceRow[], phase: 'PRE' | 'POST') {
  const t = BATCH_NEXT5_P3_TARGET;
  const published = phase === 'POST';
  requireCount(rows, 1, `${phase} batch evidence`);
  const row = rows[0];
  for (const [field, expected] of Object.entries({
    id: t.batchId,
    batch_name: t.batchName,
    batch_status: published ? 'PUBLISHED' : 'SUBMITTED',
    revision: published ? 10 : 9,
    start_command_id: t.startCommandId,
    submit_command_id: t.submitCommandId,
    publish_command_id: published ? t.publishCommandId : null,
  })) expectField(row, field, expected, `${phase} batch evidence`);
  expectTimestamp(row.submitted_at, t.submittedAt, `${phase} batch submitted_at`);
  if (published) expectNonEmptyTimestamp(row.published_at, 'POST batch published_at');
  else expectField(row, 'published_at', null, 'PRE batch evidence');
}

function assertScope(rows: BatchNext5P3EvidenceRow[]) {
  requireCount(rows, 8, 'scope evidence');
  for (const identity of Object.values(BATCH_NEXT5_P3_TARGET.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'scope evidence');
    expectField(row, 'batch_id', BATCH_NEXT5_P3_TARGET.batchId, 'scope evidence');
    expectField(row, 'start_command_id', BATCH_NEXT5_P3_TARGET.startCommandId, 'scope evidence');
  }
}

function assertReconciliationAndObservation(evidence: BatchNext5P3Evidence, code: string, identity: Identity) {
  const r = findExactly(evidence.reconciliations, 'id', identity.reconciliationId, `${code} reconciliation`);
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT5_P3_TARGET.batchId,
    survey_observation_id: identity.surveyObservationId,
    product_identity_observation_id: identity.observationId,
    command_id: identity.reconcileCommandId,
    commercial_sku_id: identity.commercialSkuId,
    carton_barcode: identity.barcode,
    reconciliation_status: 'DRAFTED',
  })) expectField(r, field, expected, `${code} reconciliation`);

  const o = findExactly(evidence.observations, 'id', identity.observationId, `${code} observation`);
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT5_P3_TARGET.batchId,
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

function assertTasks(rows: BatchNext5P3EvidenceRow[], phase: 'PRE' | 'POST') {
  requireCount(rows, 8, `${phase} task evidence`);
  const expectedStatus = phase === 'POST' ? 'RESOLVED' : 'DRAFT_READY';
  for (const identity of Object.values(BATCH_NEXT5_P3_TARGET.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'task evidence');
    expectField(row, 'batch_id', BATCH_NEXT5_P3_TARGET.batchId, 'task evidence');
    expectField(row, 'task_status', expectedStatus, 'task evidence');
    expectField(row, 'blocking', true, 'task evidence');
  }
}

function assertCanonicalGraph(evidence: BatchNext5P3Evidence, phase: 'PRE' | 'POST') {
  const status = phase === 'POST' ? 'ACTIVE' : 'DRAFT';
  for (const [rows, label] of [
    [evidence.families, 'family'],
    [evidence.physicalSkus, 'Physical SKU'],
    [evidence.packages, 'package'],
    [evidence.barcodeBindings, 'barcode'],
    [evidence.commercialFamilyLinks, 'Commercial-family link'],
  ] as const) requireCount(rows, 8, `${phase} ${label} evidence`);

  for (const [code, identity] of Object.entries(BATCH_NEXT5_P3_TARGET.identities)) {
    const f = findExactly(evidence.families, 'id', identity.familyId, `${code} family`);
    for (const [field, expected] of Object.entries({
      family_code: code,
      family_name: identity.physicalName,
      identity_status: status,
      created_in_batch_id: BATCH_NEXT5_P3_TARGET.batchId,
    })) expectField(f, field, expected, `${code} family`);

    const p = findExactly(evidence.physicalSkus, 'id', identity.physicalSkuId, `${code} Physical SKU`);
    for (const [field, expected] of Object.entries({
      physical_sku_code: code,
      display_name: identity.physicalName,
      brand: null,
      supplier_name: null,
      family_id: identity.familyId,
      identity_status: status,
      created_in_batch_id: BATCH_NEXT5_P3_TARGET.batchId,
    })) expectField(p, field, expected, `${code} Physical SKU`);

    const pkg = findExactly(evidence.packages, 'id', identity.packageId, `${code} package`);
    for (const [field, expected] of Object.entries({
      physical_sku_id: identity.physicalSkuId,
      package_level: 'CARTON',
      identity_status: status,
      created_in_batch_id: BATCH_NEXT5_P3_TARGET.batchId,
    })) expectField(pkg, field, expected, `${code} package`);
    expectUnit(pkg.units_in_base_unit, `${code} package`);

    const binding = findExactly(evidence.barcodeBindings, 'id', identity.bindingId, `${code} barcode`);
    for (const [field, expected] of Object.entries({
      barcode: identity.barcode,
      physical_sku_id: identity.physicalSkuId,
      package_id: identity.packageId,
      identity_status: status,
      created_in_batch_id: BATCH_NEXT5_P3_TARGET.batchId,
    })) expectField(binding, field, expected, `${code} barcode`);

    const link = findExactly(evidence.commercialFamilyLinks, 'id', identity.linkId, `${code} link`);
    expectField(link, 'commercial_sku_id', identity.commercialSkuId, `${code} link`);
    for (const [field, expected] of Object.entries({
      family_id: identity.familyId,
      preferred_physical_sku_id: identity.physicalSkuId,
      substitution_policy: 'PROHIBITED',
      identity_status: status,
      created_in_batch_id: BATCH_NEXT5_P3_TARGET.batchId,
    })) expectField(link, field, expected, `${code} link`);
  }
}

function assertPublicationAudit(rows: BatchNext5P3EvidenceRow[], phase: 'PRE' | 'POST') {
  requireCount(rows, 1, `${phase} publication audit`);
  const row = rows[0];
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT5_P3_TARGET.batchId,
    batch_name: BATCH_NEXT5_P3_TARGET.batchName,
    batch_status: phase === 'POST' ? 'PUBLISHED' : 'SUBMITTED',
    revision: phase === 'POST' ? 10 : 9,
    observation_count: 8,
    conflict_observation_count: 0,
  })) expectField(row, field, expected, `${phase} publication audit`);
  expectTimestamp(row.submitted_at, BATCH_NEXT5_P3_TARGET.submittedAt, `${phase} publication audit submitted_at`);
  if (phase === 'POST') expectNonEmptyTimestamp(row.published_at, 'POST publication audit published_at');
  else expectField(row, 'published_at', null, 'PRE publication audit');
}

function assertQuantityIsolation(evidence: BatchNext5P3Evidence, phase: 'PRE' | 'POST') {
  for (const [key, rows] of Object.entries(evidence.quantitySentinels)) {
    if (rows.length !== 0) hold(`${phase} quantity isolation sentinel ${key} must remain empty`);
  }
}

export function assertBatchNext5P3Preflight(
  currentBatch: BatchNext5P3CurrentBatch | null,
  evidence: BatchNext5P3Evidence,
) {
  assertCurrentBatch(currentBatch);
  assertBatch(evidence.batches, 'PRE');
  assertScope(evidence.scopeItems);
  requireCount(evidence.reconciliations, 8, 'reconciliation evidence');
  requireCount(evidence.observations, 8, 'observation evidence');
  for (const [code, identity] of Object.entries(BATCH_NEXT5_P3_TARGET.identities)) {
    assertReconciliationAndObservation(evidence, code, identity);
  }
  assertTasks(evidence.tasks, 'PRE');
  assertCanonicalGraph(evidence, 'PRE');
  assertPublicationAudit(evidence.publicationAudits, 'PRE');
  assertQuantityIsolation(evidence, 'PRE');
}

export function assertBatchNext5P3Postflight(evidence: BatchNext5P3Evidence) {
  assertBatch(evidence.batches, 'POST');
  assertScope(evidence.scopeItems);
  requireCount(evidence.reconciliations, 8, 'POST reconciliation evidence');
  requireCount(evidence.observations, 8, 'POST observation evidence');
  for (const [code, identity] of Object.entries(BATCH_NEXT5_P3_TARGET.identities)) {
    assertReconciliationAndObservation(evidence, code, identity);
  }
  assertTasks(evidence.tasks, 'POST');
  assertCanonicalGraph(evidence, 'POST');
  assertPublicationAudit(evidence.publicationAudits, 'POST');
  assertQuantityIsolation(evidence, 'POST');
}

export function buildBatchNext5P3PublishInput() {
  return {
    batchId: BATCH_NEXT5_P3_TARGET.batchId,
    expectedRevision: BATCH_NEXT5_P3_TARGET.expectedRevision,
    commandId: BATCH_NEXT5_P3_TARGET.publishCommandId,
    note: BATCH_NEXT5_P3_TARGET.publishNote,
  };
}

export function assertBatchNext5P3PublishAcknowledgement(result: BatchNext5P3PublishAcknowledgement) {
  if (
    result.batchId !== BATCH_NEXT5_P3_TARGET.batchId
    || result.batchStatus !== 'PUBLISHED'
    || result.revision !== 10
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
    || result.publishedFamilies !== 8
    || result.publishedPhysicalSkus !== 8
    || result.publishedBarcodes !== 8
    || result.publishedLinks !== 8
    || typeof result.publishedAt !== 'string'
    || !result.publishedAt
    || Number.isNaN(Date.parse(result.publishedAt))
  ) throw new Error('Batch Next 5 P3 PUBLISH acknowledgement is not the exact PUBLISHED rev10 / 8-8-8-8 result.');
}

export function formatBatchNext5P3Failure(error: unknown, commandCrossedBoundary: boolean) {
  const detail = error instanceof Error ? error.message : String(error);
  if (commandCrossedBoundary) {
    return `HOLD — PUBLISH may have been called; do not retry or use a new command ID. Perform read-only server verification before any retry. Detail: ${detail}`;
  }
  if (detail.startsWith('HOLD —')) return detail;
  return `HOLD — ${detail}; PUBLISH was not called.`;
}
