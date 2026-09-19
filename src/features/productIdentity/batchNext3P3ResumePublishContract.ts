export type BatchNext3P3CurrentBatch = {
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

export type BatchNext3P3EvidenceRow = Record<string, unknown>;

export type BatchNext3P3Evidence = {
  batches: BatchNext3P3EvidenceRow[];
  scopeItems: BatchNext3P3EvidenceRow[];
  reconciliations: BatchNext3P3EvidenceRow[];
  observations: BatchNext3P3EvidenceRow[];
  tasks: BatchNext3P3EvidenceRow[];
  families: BatchNext3P3EvidenceRow[];
  physicalSkus: BatchNext3P3EvidenceRow[];
  packages: BatchNext3P3EvidenceRow[];
  barcodeBindings: BatchNext3P3EvidenceRow[];
  commercialFamilyLinks: BatchNext3P3EvidenceRow[];
  publicationAudits: BatchNext3P3EvidenceRow[];
  quantitySentinels: {
    inventoryMovements: BatchNext3P3EvidenceRow[];
    warehouseMovements: BatchNext3P3EvidenceRow[];
    warehouseLocationItems: BatchNext3P3EvidenceRow[];
    inventoryBalances: BatchNext3P3EvidenceRow[];
    stockMovements: BatchNext3P3EvidenceRow[];
  };
};

export type BatchNext3P3PublishAcknowledgement = {
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

export const BATCH_NEXT3_P3_TARGET = {
  protectedMainSha: '6bd53298ecd1c1b3e9969734d81a8c3c58e54b88',
  batchId: 'e4c8b31b-73e6-4607-9e10-b46509f49365',
  batchName: 'ECOFLOW-328 Batch Next 3 DRAFT-only',
  expectedRevision: 11,
  startCommandId: '8d1ecf05-6ebd-5661-aaff-b0e82b9b2e59',
  submitCommandId: '75d35e90-e939-4da5-8469-b4183bff5cf4',
  submittedAt: '2026-09-19T06:27:10.138883+00:00',
  publishCommandId: 'b2f74120-86de-4de9-8c80-435627ad76c9',
  publishNote: 'ECOFLOW-328-BATCH-NEXT3-P3 PUBLISH only; exact ten-SKU SUBMITTED rev11 graph independently verified; activation-only impact preview; no inventory/stocktake/location mutation, barcode reassignment/retirement or provider authority granted.',
  identities: {
    'CCEB16-90': {
      commercialSkuId: '7d65ed69-1a0d-4f08-a63d-5a01b61c42a1',
      surveyObservationId: 'bbdd187c-5719-4216-b56e-160cfb252f2a',
      reconcileCommandId: '3a87bfdd-86b1-5f76-a26e-f7c862f451c7',
      reconciliationId: 'd2279cd6-cb6c-4825-8efa-5a4181f4b73e',
      observationId: '0e38c410-8e53-4587-830c-62adf610562c',
      familyId: 'fe1b4cee-f616-45df-aa76-affa3f452e0d',
      physicalSkuId: '893963a9-d688-44c4-9c9a-0429f2fd199d',
      packageId: 'b1ab068d-e31f-4d98-9e4f-e1e865fff228',
      bindingId: '53c62ff3-fcfb-4afa-a99b-96a207e895d3',
      linkId: '9fa461eb-7887-4f03-8796-3cd39115b507',
      physicalName: '(90mm) 16oz Double Wall Black',
      barcode: '757953138709',
    },
    'CCLWPLA-62': {
      commercialSkuId: '2eedbacd-e98f-49e1-aa12-e73e211e5a93',
      surveyObservationId: '9e1d466e-452d-4d0d-a994-a3a8d6568b2b',
      reconcileCommandId: 'c4fd7c00-7598-5b4b-8171-de8bf54cf483',
      reconciliationId: 'd37874b0-09b0-43eb-af81-90dfca397513',
      observationId: 'df64c6a6-e4b2-49c0-8c46-a432ff64f2c1',
      familyId: 'fd9aebb3-d9ff-4359-b20b-7f90214cf28f',
      physicalSkuId: '64768296-9367-4afd-854f-c90f1556b861',
      packageId: 'ea53917d-1ba6-4ee6-a7c2-27312e8400b3',
      bindingId: '8c269b5b-feb6-4202-bbbf-ff4651d35dd5',
      linkId: '40c34711-daac-4e0e-9be0-961b7e995ed3',
      physicalName: '62mm PLA Lids White (4oz)',
      barcode: '757953139737',
    },
    'CCSB12-80': {
      commercialSkuId: '01bbcf87-68cd-496e-bc5c-36ab58efd706',
      surveyObservationId: 'b9c5518f-fccc-480d-bc67-450309de3174',
      reconcileCommandId: 'c23fed38-16aa-5ee1-834f-799d6ce2e4b1',
      reconciliationId: '65f5aed2-c4a6-4561-8de2-a53f6de048d3',
      observationId: 'd4704130-08fe-4260-bde2-ed860f47dad3',
      familyId: '5b91cfc9-31f2-4c5f-8bb3-2d308215c77b',
      physicalSkuId: '4dd3eb5a-16ff-48af-8aa9-55d4cf026b70',
      packageId: 'e3c30a40-6451-40a0-8ff6-83a9e8aa1a05',
      bindingId: '347b214f-8692-44dc-be3d-266bc9ca0ad4',
      linkId: 'd27093f0-d4aa-41c9-a610-f52fb07ba7ae',
      physicalName: '(80mm) 12oz Compostable Black',
      barcode: '757953138624',
    },
    'CCSB16-90': {
      commercialSkuId: '68406c4d-cc65-4ca1-882a-3d1ed190824d',
      surveyObservationId: '3fa20154-8b70-4459-b221-32f745bc8c21',
      reconcileCommandId: 'd14a41d9-ea69-5332-9d44-007600ca300f',
      reconciliationId: '9339cffd-1b53-49a7-80b0-740feba9da7a',
      observationId: 'cf184acc-5072-4e6d-8b47-ab9c601e5e8d',
      familyId: '453c4495-0474-486f-b044-f70b0b276cf7',
      physicalSkuId: 'b6714016-2ad6-43f3-a682-4b84036ce624',
      packageId: '9970d3bb-1b99-4a29-b7c8-b8e41ce2099e',
      bindingId: '243d9991-ebcd-45a0-958e-a274cc192019',
      linkId: '024185fd-3ffd-4c8d-8342-2d16003dcf32',
      physicalName: '(90mm) 16oz Compostable Black',
      barcode: '757953138648',
    },
    'CCSB8-90': {
      commercialSkuId: 'c60b80e5-21d3-4981-9b5e-ac148a927624',
      surveyObservationId: '0e0aee96-a157-4f29-ae4c-abf0775db66e',
      reconcileCommandId: '647e65a8-e401-5d0d-b2bc-61272dd8e6e3',
      reconciliationId: 'efa9aa7e-7a10-4b32-ba76-a5854141e76c',
      observationId: '2eae42d9-9d3b-426f-aadd-21554d367c7a',
      familyId: 'a387cab1-edb6-45d6-90ee-3160bedafc9e',
      physicalSkuId: '90bc0953-a9e5-4213-bcc1-f2bbd14d4e36',
      packageId: '3819c86e-b485-4b51-abb5-67646eb4b756',
      bindingId: '3a498b5b-2db0-4127-9f2b-b182f4cc1a49',
      linkId: 'e64a1e8e-881d-4ef6-bf06-90ef8e0b52e2',
      physicalName: '(90mm) 8oz Compostable Black',
      barcode: '757953138617',
    },
    'CCSKBM12-80': {
      commercialSkuId: 'f5656b1e-b73a-421f-b8da-11c6cca06ece',
      surveyObservationId: '8faf2289-5032-4476-84c8-063c690b815e',
      reconcileCommandId: 'a61fdfc2-efb5-54e3-a62b-75d77ade8bf0',
      reconciliationId: 'dab40f6e-813a-428e-b4e6-71e3e91b0da7',
      observationId: '1039e833-c0b6-4439-a1e8-18da467b257b',
      familyId: 'd201a8c5-38a7-48e3-9928-18a1b6e652ce',
      physicalSkuId: '3f14a00f-4eab-4326-96b8-55698e6b4cca',
      packageId: '8e427928-784f-4e16-8e0d-fefbe4897ed6',
      bindingId: 'aac15769-2df8-474c-ae5b-05b699c35fd7',
      linkId: 'fa334da0-0c2c-456a-b861-b92f24aa7b65',
      physicalName: '(80mm) 12oz Compostable Kraft Bamboo',
      barcode: '757953139676',
    },
    'CCSPW6-80': {
      commercialSkuId: '1e7aa029-34e5-4ba2-a73c-430480556ded',
      surveyObservationId: 'e8b9f9b7-08de-4df5-9be7-c2bbaa1fa068',
      reconcileCommandId: 'b91632ca-8d17-5339-81d6-ba376188f3b0',
      reconciliationId: 'ec6fdeec-0e1f-4f60-ab09-81239f48ae48',
      observationId: '72858cf0-e8fe-48ab-8b6b-6270590c5870',
      familyId: 'dc9842f2-2e4e-494d-9ae2-aa433f96436c',
      physicalSkuId: 'af7a2e48-8f35-4cc6-8b0a-25417289cabf',
      packageId: 'a8ad5843-3817-45eb-bde1-c214db4d556f',
      bindingId: '7751111d-6a61-4969-8a33-47d5148405ab',
      linkId: 'e5f267f1-3a15-45a3-a004-c7d1f8f45de9',
      physicalName: '(80mm) 6oz PLA White - 1000pcs',
      barcode: '757953135494',
    },
    'IC5BBOX': {
      commercialSkuId: 'e3dce7fd-3515-492c-8953-423293f38b09',
      surveyObservationId: 'f834833b-c65d-44ff-80de-2faa331503d4',
      reconcileCommandId: '2c6e667d-2064-5180-be71-4500431cfb6d',
      reconciliationId: 'c35d51f1-a4c9-4bec-8627-9a7382ea641f',
      observationId: 'c54f78cf-1479-47d9-91eb-539a35024106',
      familyId: '386fb2f9-1807-4376-935a-b74cd7a86580',
      physicalSkuId: 'a35f8e8d-afe9-4b34-92b6-8e0d4987603e',
      packageId: '1f10920b-5b16-4047-adfa-a741bfe81973',
      bindingId: '01fe737e-becb-4c6d-8d5e-836323d183a1',
      linkId: '03c28e64-f0a9-4293-8712-b367d37c250e',
      physicalName: '5oz Ice-cream Cup - 50pcs',
      barcode: '19348045026554',
    },
    'NPK1LW': {
      commercialSkuId: 'da8afc18-9198-44c0-98dc-839fd867c1d2',
      surveyObservationId: 'b9809796-f1a0-4dc1-9e15-b1046d77d44e',
      reconcileCommandId: '9e2dc95d-b60a-5c2a-8eb0-af63bb9bcd43',
      reconciliationId: 'f0677bda-b2ee-4a79-bfe3-860c08d4620e',
      observationId: 'fc25764a-7b1e-40da-8e20-394a320c3656',
      familyId: '7ee2d606-26ae-488e-8302-f3a9b60bbf7f',
      physicalSkuId: '855584d8-933c-462d-802b-9dab9bfd8565',
      packageId: 'f9856e8e-a735-42af-87f3-1bf437a9bd87',
      bindingId: 'df225c12-b332-46f5-a1e6-a9da498be631',
      linkId: '14f100f0-3cef-4e04-8cf0-17a1df7c5429',
      physicalName: 'Lunch Napkin 1ply  Fold White - 3000pcs',
      barcode: '757953135845',
    },
    'NPK2LK': {
      commercialSkuId: '98fb3e05-b19f-4fc7-9447-f887212b10e7',
      surveyObservationId: '7853b062-6ac7-4878-a1f3-dc0112a54e7a',
      reconcileCommandId: 'f3741782-edef-58e3-bf7b-09a438f8ed5e',
      reconciliationId: '26a1a5ef-15b1-498c-b2d2-a5f9e150343f',
      observationId: 'dfc9e12c-ef49-4495-8f80-ccb0c407350a',
      familyId: '78988cdb-b6a2-489f-9a08-8ffc08951b99',
      physicalSkuId: '37a86a2d-989f-44a8-afed-83a862b1e9ea',
      packageId: 'a17c3aab-b58d-4203-84d2-c6531aa62848',
      bindingId: '45f7f3dc-ddf8-40c8-a1cb-972fb50eb191',
      linkId: '6c20d785-ce0d-4cd3-84ef-81ffb1580021',
      physicalName: 'Lunch Napkin 1/4 Fold Natural - 2000pcs',
      barcode: '757953135876',
    },
  },
} as const;

type Identity = (typeof BATCH_NEXT3_P3_TARGET.identities)[keyof typeof BATCH_NEXT3_P3_TARGET.identities];

function hold(detail: string): never {
  throw new Error(`HOLD — ${detail}; PUBLISH was not called.`);
}

function requireCount(rows: BatchNext3P3EvidenceRow[], expected: number, label: string) {
  if (rows.length !== expected) hold(`${label} must contain exactly ${expected} rows`);
}

function expectField(row: BatchNext3P3EvidenceRow, field: string, expected: unknown, label: string) {
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

function findExactly(rows: BatchNext3P3EvidenceRow[], field: string, value: string, label: string) {
  const matches = rows.filter((row) => row[field] === value);
  if (matches.length !== 1) hold(`${label} must contain exactly one row for ${value}`);
  return matches[0];
}

function assertCurrentBatch(currentBatch: BatchNext3P3CurrentBatch | null) {
  const t = BATCH_NEXT3_P3_TARGET;
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

function assertBatch(rows: BatchNext3P3EvidenceRow[], phase: 'PRE' | 'POST') {
  const t = BATCH_NEXT3_P3_TARGET;
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

function assertScope(rows: BatchNext3P3EvidenceRow[]) {
  requireCount(rows, 10, 'scope evidence');
  for (const identity of Object.values(BATCH_NEXT3_P3_TARGET.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'scope evidence');
    expectField(row, 'batch_id', BATCH_NEXT3_P3_TARGET.batchId, 'scope evidence');
    expectField(row, 'start_command_id', BATCH_NEXT3_P3_TARGET.startCommandId, 'scope evidence');
  }
}

function assertReconciliationAndObservation(evidence: BatchNext3P3Evidence, code: string, identity: Identity) {
  const r = findExactly(evidence.reconciliations, 'id', identity.reconciliationId, `${code} reconciliation`);
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT3_P3_TARGET.batchId,
    survey_observation_id: identity.surveyObservationId,
    product_identity_observation_id: identity.observationId,
    command_id: identity.reconcileCommandId,
    commercial_sku_id: identity.commercialSkuId,
    carton_barcode: identity.barcode,
    reconciliation_status: 'DRAFTED',
  })) expectField(r, field, expected, `${code} reconciliation`);

  const o = findExactly(evidence.observations, 'id', identity.observationId, `${code} observation`);
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT3_P3_TARGET.batchId,
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

function assertTasks(rows: BatchNext3P3EvidenceRow[], phase: 'PRE' | 'POST') {
  requireCount(rows, 10, `${phase} task evidence`);
  const expectedStatus = phase === 'POST' ? 'RESOLVED' : 'DRAFT_READY';
  for (const identity of Object.values(BATCH_NEXT3_P3_TARGET.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'task evidence');
    expectField(row, 'batch_id', BATCH_NEXT3_P3_TARGET.batchId, 'task evidence');
    expectField(row, 'task_status', expectedStatus, 'task evidence');
    expectField(row, 'blocking', true, 'task evidence');
  }
}

function assertCanonicalGraph(evidence: BatchNext3P3Evidence, phase: 'PRE' | 'POST') {
  const status = phase === 'POST' ? 'ACTIVE' : 'DRAFT';
  for (const [rows, label] of [
    [evidence.families, 'family'],
    [evidence.physicalSkus, 'Physical SKU'],
    [evidence.packages, 'package'],
    [evidence.barcodeBindings, 'barcode'],
    [evidence.commercialFamilyLinks, 'Commercial-family link'],
  ] as const) requireCount(rows, 10, `${phase} ${label} evidence`);

  for (const [code, identity] of Object.entries(BATCH_NEXT3_P3_TARGET.identities)) {
    const f = findExactly(evidence.families, 'id', identity.familyId, `${code} family`);
    for (const [field, expected] of Object.entries({
      family_code: code,
      family_name: identity.physicalName,
      identity_status: status,
      created_in_batch_id: BATCH_NEXT3_P3_TARGET.batchId,
    })) expectField(f, field, expected, `${code} family`);

    const p = findExactly(evidence.physicalSkus, 'id', identity.physicalSkuId, `${code} Physical SKU`);
    for (const [field, expected] of Object.entries({
      physical_sku_code: code,
      display_name: identity.physicalName,
      brand: null,
      supplier_name: null,
      family_id: identity.familyId,
      identity_status: status,
      created_in_batch_id: BATCH_NEXT3_P3_TARGET.batchId,
    })) expectField(p, field, expected, `${code} Physical SKU`);

    const pkg = findExactly(evidence.packages, 'id', identity.packageId, `${code} package`);
    for (const [field, expected] of Object.entries({
      physical_sku_id: identity.physicalSkuId,
      package_level: 'CARTON',
      identity_status: status,
      created_in_batch_id: BATCH_NEXT3_P3_TARGET.batchId,
    })) expectField(pkg, field, expected, `${code} package`);
    expectUnit(pkg.units_in_base_unit, `${code} package`);

    const binding = findExactly(evidence.barcodeBindings, 'id', identity.bindingId, `${code} barcode`);
    for (const [field, expected] of Object.entries({
      barcode: identity.barcode,
      physical_sku_id: identity.physicalSkuId,
      package_id: identity.packageId,
      identity_status: status,
      created_in_batch_id: BATCH_NEXT3_P3_TARGET.batchId,
    })) expectField(binding, field, expected, `${code} barcode`);

    const link = findExactly(evidence.commercialFamilyLinks, 'id', identity.linkId, `${code} link`);
    expectField(link, 'commercial_sku_id', identity.commercialSkuId, `${code} link`);
    for (const [field, expected] of Object.entries({
      family_id: identity.familyId,
      preferred_physical_sku_id: identity.physicalSkuId,
      substitution_policy: 'PROHIBITED',
      identity_status: status,
      created_in_batch_id: BATCH_NEXT3_P3_TARGET.batchId,
    })) expectField(link, field, expected, `${code} link`);
  }
}

function assertPublicationAudit(rows: BatchNext3P3EvidenceRow[], phase: 'PRE' | 'POST') {
  requireCount(rows, 1, `${phase} publication audit`);
  const row = rows[0];
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT3_P3_TARGET.batchId,
    batch_name: BATCH_NEXT3_P3_TARGET.batchName,
    batch_status: phase === 'POST' ? 'PUBLISHED' : 'SUBMITTED',
    revision: phase === 'POST' ? 12 : 11,
    observation_count: 10,
    conflict_observation_count: 0,
  })) expectField(row, field, expected, `${phase} publication audit`);
  expectTimestamp(row.submitted_at, BATCH_NEXT3_P3_TARGET.submittedAt, `${phase} publication audit submitted_at`);
  if (phase === 'POST') expectNonEmptyTimestamp(row.published_at, 'POST publication audit published_at');
  else expectField(row, 'published_at', null, 'PRE publication audit');
}

function assertQuantityIsolation(evidence: BatchNext3P3Evidence, phase: 'PRE' | 'POST') {
  for (const [key, rows] of Object.entries(evidence.quantitySentinels)) {
    if (rows.length !== 0) hold(`${phase} quantity isolation sentinel ${key} must remain empty`);
  }
}

export function assertBatchNext3P3Preflight(
  currentBatch: BatchNext3P3CurrentBatch | null,
  evidence: BatchNext3P3Evidence,
) {
  assertCurrentBatch(currentBatch);
  assertBatch(evidence.batches, 'PRE');
  assertScope(evidence.scopeItems);
  requireCount(evidence.reconciliations, 10, 'reconciliation evidence');
  requireCount(evidence.observations, 10, 'observation evidence');
  for (const [code, identity] of Object.entries(BATCH_NEXT3_P3_TARGET.identities)) {
    assertReconciliationAndObservation(evidence, code, identity);
  }
  assertTasks(evidence.tasks, 'PRE');
  assertCanonicalGraph(evidence, 'PRE');
  assertPublicationAudit(evidence.publicationAudits, 'PRE');
  assertQuantityIsolation(evidence, 'PRE');
}

export function assertBatchNext3P3Postflight(evidence: BatchNext3P3Evidence) {
  assertBatch(evidence.batches, 'POST');
  assertScope(evidence.scopeItems);
  requireCount(evidence.reconciliations, 10, 'POST reconciliation evidence');
  requireCount(evidence.observations, 10, 'POST observation evidence');
  for (const [code, identity] of Object.entries(BATCH_NEXT3_P3_TARGET.identities)) {
    assertReconciliationAndObservation(evidence, code, identity);
  }
  assertTasks(evidence.tasks, 'POST');
  assertCanonicalGraph(evidence, 'POST');
  assertPublicationAudit(evidence.publicationAudits, 'POST');
  assertQuantityIsolation(evidence, 'POST');
}

export function buildBatchNext3P3PublishInput() {
  return {
    batchId: BATCH_NEXT3_P3_TARGET.batchId,
    expectedRevision: BATCH_NEXT3_P3_TARGET.expectedRevision,
    commandId: BATCH_NEXT3_P3_TARGET.publishCommandId,
    note: BATCH_NEXT3_P3_TARGET.publishNote,
  };
}

export function assertBatchNext3P3PublishAcknowledgement(result: BatchNext3P3PublishAcknowledgement) {
  if (
    result.batchId !== BATCH_NEXT3_P3_TARGET.batchId
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
  ) throw new Error('Batch Next 3 P3 PUBLISH acknowledgement is not the exact PUBLISHED rev12 / 10-10-10-10 result.');
}

export function formatBatchNext3P3Failure(error: unknown, commandCrossedBoundary: boolean) {
  const detail = error instanceof Error ? error.message : String(error);
  if (commandCrossedBoundary) {
    return `HOLD — PUBLISH may have been called; do not retry or use a new command ID. Perform read-only server verification before any retry. Detail: ${detail}`;
  }
  if (detail.startsWith('HOLD —')) return detail;
  return `HOLD — ${detail}; PUBLISH was not called.`;
}
