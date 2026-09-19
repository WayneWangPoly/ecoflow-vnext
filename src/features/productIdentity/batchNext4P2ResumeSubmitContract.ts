export type BatchNext4P2CurrentBatch = {
  batchId: string;
  batchName?: string;
  batchStatus: string;
  revision: number;
  openTasks: number;
  draftReadyTasks: number;
  conflictTasks: number;
  canSubmit: boolean;
};

export type BatchNext4P2EvidenceRow = Record<string, unknown>;

export type BatchNext4P2Evidence = {
  batches: BatchNext4P2EvidenceRow[];
  scopeItems: BatchNext4P2EvidenceRow[];
  reconciliations: BatchNext4P2EvidenceRow[];
  observations: BatchNext4P2EvidenceRow[];
  families: BatchNext4P2EvidenceRow[];
  physicalSkus: BatchNext4P2EvidenceRow[];
  packages: BatchNext4P2EvidenceRow[];
  barcodeBindings: BatchNext4P2EvidenceRow[];
  commercialFamilyLinks: BatchNext4P2EvidenceRow[];
};

export type BatchNext4P2SubmitAcknowledgement = {
  batchId: string;
  batchStatus: string;
  revision: number;
  commandStatus: string;
};

export const BATCH_NEXT4_P2_TARGET = {
  protectedMainSha: 'faddc2d39bd053620f6d84c28d1cb3e09e0563f8',
  batchId: 'f72ecd68-9177-4df7-ad18-c29a26e612f3',
  batchName: 'ECOFLOW-328 Batch Next 4 DRAFT-only',
  startCommandId: 'f2bf897d-a1e6-54e2-909a-c58204960210',
  expectedRevision: 10,
  submitCommandId: '3fa78212-ba4c-5318-8b35-55fcbbf103af',
  submitNote: 'ECOFLOW-328-BATCH-NEXT4-P2 SUBMIT only; exact ten-SKU DRAFT graph independently verified; PUBLISH, barcode reassignment/retirement, inventory/stocktake/location mutation and provider traffic not authorized.',
  identities: {
    "BSB42LPLA": {
      "commercialSkuId": "033e87c1-49ae-44b9-b78d-3a07c35ac6cb",
      "surveyObservationId": "49b64a4c-1698-4890-8a1f-d10c03d7bb05",
      "reconcileCommandId": "24f9ba97-0962-5256-8898-00716dcd49ec",
      "reconciliationId": "29db99c0-89ec-40bf-8e0f-670995a2417e",
      "observationId": "fe191d82-b83e-47f9-9942-f2a3050e7210",
      "familyId": "3788c9db-9028-4607-b607-f9317ea94f4b",
      "physicalSkuId": "9a14b64f-6433-4d0e-8bec-980ff63481a7",
      "packageId": "57b3d617-5edc-430c-b496-db2cc58ba6c4",
      "bindingId": "f82b1bc6-7358-4a48-b10b-1c45f8b3b920",
      "linkId": "52ea2c1b-984b-4827-99e3-baaa330a85a6",
      "physicalName": "Flat PLA Lids Fit 42oz 1300ml - 300 pcs",
      "barcode": "19348045026820"
    },
    "CCEA12-90": {
      "commercialSkuId": "72649e8e-776d-4ebb-b788-3e9942b83319",
      "surveyObservationId": "c58d70df-5ba9-44da-9eb4-a0ea48da49c4",
      "reconcileCommandId": "4e621911-eefb-58d9-b855-4e119fbd39cb",
      "reconciliationId": "0c3b0984-f784-44b5-a628-b25ad858d591",
      "observationId": "c13b8c4e-8974-4ba4-a344-580386c717a4",
      "familyId": "f02a895a-5081-4552-81fb-f2cd27fbe98a",
      "physicalSkuId": "00629ac7-ba2c-4fc0-9771-1734860456ac",
      "packageId": "12159773-4de9-44cf-972e-ca73258a3045",
      "bindingId": "a684be04-7b5d-4e2c-81bf-72fe37060b6d",
      "linkId": "1feb5d21-e521-4d19-8b55-f5f2518daf02",
      "physicalName": "(90mm) 12oz Double Wall Art Series - 1000pcs",
      "barcode": "757953138419"
    },
    "CCSW12-80": {
      "commercialSkuId": "d1d0baf6-9629-48f2-9a99-df3ae61566a2",
      "surveyObservationId": "eac75a2a-9322-4a58-86d5-2e2d965ee267",
      "reconcileCommandId": "8866c1c7-285b-5805-a5cd-1130ae1c3caf",
      "reconciliationId": "3989eb97-0212-4112-9561-f737fd6bf708",
      "observationId": "f03d987c-49ac-4c06-9735-5b13b5972ad3",
      "familyId": "271fafa5-91c3-498f-9937-a1acbf68fb17",
      "physicalSkuId": "f879ed18-5df3-440c-9354-baac90cf7522",
      "packageId": "de289696-ab91-4070-9b91-afb9340d0910",
      "bindingId": "ff418fbb-52c5-4c99-93d2-d94476cf4ad7",
      "linkId": "c0c30df3-cf71-459f-80ab-d781e14401cd",
      "physicalName": "(80mm) 12oz Compostable White",
      "barcode": "757953139782"
    },
    "IC4BOX": {
      "commercialSkuId": "7eb93774-b496-43b4-acac-c5d2bafbc864",
      "surveyObservationId": "5e1c9487-a49a-45c0-b5ee-b63fa24e93ca",
      "reconcileCommandId": "c531d642-5f37-584a-9726-7c8a660463a8",
      "reconciliationId": "2ac10433-b170-49e5-8344-d3c3f3bb41e9",
      "observationId": "36ef3f93-db7f-403b-8917-9a143c08e3fc",
      "familyId": "907522b2-bb4a-4ecf-8262-3828debb3552",
      "physicalSkuId": "fb042ebe-b1bb-4d7f-9610-9898ec9cbd1e",
      "packageId": "d1500c9d-d681-48d4-9ce9-d8ee640f2fe1",
      "bindingId": "b5d45a9c-6d05-4897-bca2-f4a3d4e503ac",
      "linkId": "9abd3b87-e875-4b3e-8f31-f3cad6158001",
      "physicalName": "4oz Ice-cream Cup - 50pcs",
      "barcode": "19348045021177"
    },
    "KRC650": {
      "commercialSkuId": "63b5efb8-6384-40f5-a78f-13c17ebd7bfb",
      "surveyObservationId": "7a55478a-a98a-4dbe-ac2e-116d03eeb8b6",
      "reconcileCommandId": "8bda6430-f171-566c-8381-92573809fab1",
      "reconciliationId": "12908755-54ee-42c6-8608-bdd955dd3427",
      "observationId": "147145bb-521b-49b7-a6eb-c0337c825d22",
      "familyId": "705b2230-ef34-4c30-bde3-3982cd7e1ebc",
      "physicalSkuId": "f6cdf9c5-1073-4898-82d1-15c85f48b18d",
      "packageId": "d568261c-af4d-4e84-8e76-d6a584920847",
      "bindingId": "92d18baf-8185-43e7-846e-8fed5e77b6a8",
      "linkId": "bc32e7c3-4b7f-46bc-85aa-badbcf083f1d",
      "physicalName": "650ml Kraft Board Takeaway Base Carton - 300pcs",
      "barcode": "(01)19348045026318"
    },
    "KSB16": {
      "commercialSkuId": "6d78bf81-613a-46da-bab9-d379b42b11bf",
      "surveyObservationId": "885abeee-5427-428a-aaa8-3a982bd23949",
      "reconcileCommandId": "0c81220c-96ce-5f18-baf8-f9d8bf49d221",
      "reconciliationId": "f6f4931e-4912-4095-939f-97950a340173",
      "observationId": "bb327487-9f6c-48a1-887f-ae4dfe204d94",
      "familyId": "12a652f3-2b9a-4744-94c6-a41c01c382d8",
      "physicalSkuId": "3f559255-dde3-4be3-95a1-9e8316d111e0",
      "packageId": "2a3ef62f-a627-427c-9256-b3a61a6075b9",
      "bindingId": "4cce4ac5-bf85-46cf-80cc-befd6741f466",
      "linkId": "266aa4f1-4cde-497b-bb01-f3fdfc292b65",
      "physicalName": "16oz - 500ml Small Deli Bowl Kraft - 300pcs",
      "barcode": "19348045021092"
    },
    "KSB25": {
      "commercialSkuId": "7b91588d-2b82-4bcf-93ff-4540aab5fb0b",
      "surveyObservationId": "e8bcc676-7c54-4cae-bdfe-d0fe321cf697",
      "reconcileCommandId": "995a3b99-ec17-5f92-a656-f3cd1ed38213",
      "reconciliationId": "c8305759-8929-4285-99b8-817889be623b",
      "observationId": "16f38f72-ff54-4e6f-957c-4ae8e09e91e9",
      "familyId": "f24eda05-636a-42ef-948d-dda1ead8da26",
      "physicalSkuId": "978bef62-6f9a-43d6-b9f9-cbfbf53f0325",
      "packageId": "a43be376-cdf5-49fa-9f65-efc873105d09",
      "bindingId": "119f11d3-e9c1-4958-a0bf-6acb127f957a",
      "linkId": "490bbe9f-f71f-457a-95ad-210bda00cb58",
      "physicalName": "25oz - 750ml Small Deli Bowl Kraft - 300pcs",
      "barcode": "19348045021108"
    },
    "KSB32": {
      "commercialSkuId": "2e5358e4-9eb3-409d-8e52-cdbc133579c8",
      "surveyObservationId": "b0e688ff-2023-4aef-8107-d8717dc3e75c",
      "reconcileCommandId": "5b953340-e020-584f-9940-57895656f0fb",
      "reconciliationId": "76baba24-4f0e-491e-9746-6a2549ffeac5",
      "observationId": "65b4040f-4071-45f6-824a-c35093c4201a",
      "familyId": "2fd629aa-9942-4aed-b3b5-62f8059c47d9",
      "physicalSkuId": "60983b54-bbd3-4d17-ac7a-97e6dc4f2c27",
      "packageId": "316796bb-7424-45e5-9b57-8e3961636f72",
      "bindingId": "69d93f75-cc22-48bb-bcf8-b85e1597fe0b",
      "linkId": "52c7dbc8-f7a5-415d-aef4-1952f11fb46b",
      "physicalName": "32oz - 1000ml Small Deli Bowl Kraft - 300pcs",
      "barcode": "19348045021115"
    },
    "PCB11": {
      "commercialSkuId": "efe3e003-1925-40b8-956f-bbaf81a96edb",
      "surveyObservationId": "00caf945-f139-4097-bd4a-d67e9bf67b19",
      "reconcileCommandId": "11c04225-cfcf-57fb-8357-3231bb85ef95",
      "reconciliationId": "8d65c78c-3de2-43e9-979a-6dd9666bf401",
      "observationId": "8b3cd422-3258-4a63-8b3c-93f82fa44386",
      "familyId": "9e0b04d5-318b-4378-8786-1d771393f568",
      "physicalSkuId": "5046841a-1c05-4313-b4d3-2f78448225f8",
      "packageId": "f70475d5-5368-44ad-a982-718712225f47",
      "bindingId": "a591f543-c5ec-4b10-be43-510372b0362a",
      "linkId": "40c12f6f-adbe-403e-bd19-7210d5852872",
      "physicalName": "Family Box - 100pcs",
      "barcode": "19348045017828"
    },
    "Q514S0001": {
      "commercialSkuId": "e9c5467c-b454-487e-83b0-4f9ca38a132e",
      "surveyObservationId": "f660518b-149e-4157-a699-f3d43681e548",
      "reconcileCommandId": "75728192-7264-50c5-b77d-e466031586e2",
      "reconciliationId": "5509fd14-7be6-4055-a4e1-25a2b057db48",
      "observationId": "92744733-e099-4d80-b678-8ad1bae4e095",
      "familyId": "3c36f19d-8313-4131-a1e4-2af7194799a7",
      "physicalSkuId": "867aa6ac-304e-49bb-8c5d-ff0b8e513ed2",
      "packageId": "75f9015b-d2a6-4d1f-bdc9-4b299d880221",
      "bindingId": "45a8ed56-0146-48ab-8f5d-97d72f527b47",
      "linkId": "8ed68494-6cfe-4a54-a129-dbd0343e3c7e",
      "physicalName": "4 Pack Donut Box with Window 8x8x3inch- 200pcs",
      "barcode": "19310707072803"
    }
  }
} as const;

type Identity = (typeof BATCH_NEXT4_P2_TARGET.identities)[keyof typeof BATCH_NEXT4_P2_TARGET.identities];

function hold(detail: string): never {
  throw new Error(`HOLD — ${detail}; SUBMIT was not called.`);
}

function requireCount(rows: BatchNext4P2EvidenceRow[], expected: number, label: string) {
  if (rows.length !== expected) hold(`${label} must contain exactly ${expected} rows`);
}

function expectField(row: BatchNext4P2EvidenceRow, field: string, expected: unknown, label: string) {
  if (row[field] !== expected) hold(`${label} ${field} mismatch`);
}

function expectUnit(value: unknown, label: string) {
  if ((typeof value !== 'number' && typeof value !== 'string') || Number(value) !== 1) {
    hold(`${label} units_in_base_unit must be exactly 1`);
  }
}

function findExactly(rows: BatchNext4P2EvidenceRow[], field: string, value: string, label: string) {
  const matches = rows.filter((row) => row[field] === value);
  if (matches.length !== 1) hold(`${label} must contain exactly one row for ${value}`);
  return matches[0];
}

function assertCurrentBatch(currentBatch: BatchNext4P2CurrentBatch | null) {
  if (!currentBatch) hold('current batch authority returned no batch');
  if (currentBatch.batchId !== BATCH_NEXT4_P2_TARGET.batchId) hold('current batch ID mismatch');
  if (currentBatch.batchName !== BATCH_NEXT4_P2_TARGET.batchName) hold('current batch name mismatch');
  if (currentBatch.batchStatus !== 'DRAFT') hold('current batch must be DRAFT');
  if (currentBatch.revision !== BATCH_NEXT4_P2_TARGET.expectedRevision) hold('current batch must be revision 10');
  if (currentBatch.openTasks !== 0 || currentBatch.draftReadyTasks !== 10 || currentBatch.conflictTasks !== 0) {
    hold('current batch tasks must be 0 open / 10 draft-ready / 0 conflict');
  }
  if (!currentBatch.canSubmit) hold('current batch authority returned canSubmit=false');
}

function assertBatchRow(rows: BatchNext4P2EvidenceRow[]) {
  requireCount(rows, 1, 'batch evidence');
  const row = rows[0];
  for (const [field, expected] of Object.entries({
    id: BATCH_NEXT4_P2_TARGET.batchId,
    batch_name: BATCH_NEXT4_P2_TARGET.batchName,
    batch_status: 'DRAFT',
    revision: BATCH_NEXT4_P2_TARGET.expectedRevision,
    start_command_id: BATCH_NEXT4_P2_TARGET.startCommandId,
    submit_command_id: null,
    publish_command_id: null,
    submitted_at: null,
    published_at: null,
  })) expectField(row, field, expected, 'batch evidence');
}

function assertScope(rows: BatchNext4P2EvidenceRow[]) {
  requireCount(rows, 10, 'scope evidence');
  for (const identity of Object.values(BATCH_NEXT4_P2_TARGET.identities)) {
    const row = findExactly(rows, 'commercial_sku_id', identity.commercialSkuId, 'scope evidence');
    expectField(row, 'batch_id', BATCH_NEXT4_P2_TARGET.batchId, 'scope evidence');
    expectField(row, 'start_command_id', BATCH_NEXT4_P2_TARGET.startCommandId, 'scope evidence');
  }
}

function assertIdentity(evidence: BatchNext4P2Evidence, code: string, identity: Identity) {
  const reconciliation = findExactly(evidence.reconciliations, 'id', identity.reconciliationId, `${code} reconciliation`);
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT4_P2_TARGET.batchId,
    survey_observation_id: identity.surveyObservationId,
    product_identity_observation_id: identity.observationId,
    command_id: identity.reconcileCommandId,
    commercial_sku_id: identity.commercialSkuId,
    carton_barcode: identity.barcode,
    reconciliation_status: 'DRAFTED',
  })) expectField(reconciliation, field, expected, `${code} reconciliation`);

  const observation = findExactly(evidence.observations, 'id', identity.observationId, `${code} observation`);
  for (const [field, expected] of Object.entries({
    batch_id: BATCH_NEXT4_P2_TARGET.batchId,
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
    created_in_batch_id: BATCH_NEXT4_P2_TARGET.batchId,
  })) expectField(family, field, expected, `${code} family`);

  const physical = findExactly(evidence.physicalSkus, 'id', identity.physicalSkuId, `${code} Physical SKU`);
  for (const [field, expected] of Object.entries({
    physical_sku_code: code,
    display_name: identity.physicalName,
    brand: null,
    supplier_name: null,
    family_id: identity.familyId,
    identity_status: 'DRAFT',
    created_in_batch_id: BATCH_NEXT4_P2_TARGET.batchId,
  })) expectField(physical, field, expected, `${code} Physical SKU`);

  const packageRow = findExactly(evidence.packages, 'id', identity.packageId, `${code} package`);
  for (const [field, expected] of Object.entries({
    physical_sku_id: identity.physicalSkuId,
    package_level: 'CARTON',
    identity_status: 'DRAFT',
    created_in_batch_id: BATCH_NEXT4_P2_TARGET.batchId,
  })) expectField(packageRow, field, expected, `${code} package`);
  expectUnit(packageRow.units_in_base_unit, `${code} package`);

  const binding = findExactly(evidence.barcodeBindings, 'id', identity.bindingId, `${code} barcode`);
  for (const [field, expected] of Object.entries({
    barcode: identity.barcode,
    physical_sku_id: identity.physicalSkuId,
    package_id: identity.packageId,
    identity_status: 'DRAFT',
    created_in_batch_id: BATCH_NEXT4_P2_TARGET.batchId,
  })) expectField(binding, field, expected, `${code} barcode`);

  const link = findExactly(evidence.commercialFamilyLinks, 'id', identity.linkId, `${code} link`);
  expectField(link, 'commercial_sku_id', identity.commercialSkuId, `${code} link`);
  for (const [field, expected] of Object.entries({
    family_id: identity.familyId,
    preferred_physical_sku_id: identity.physicalSkuId,
    substitution_policy: 'PROHIBITED',
    identity_status: 'DRAFT',
    created_in_batch_id: BATCH_NEXT4_P2_TARGET.batchId,
  })) expectField(link, field, expected, `${code} link`);
}

export function assertBatchNext4P2ResumeEvidence(
  currentBatch: BatchNext4P2CurrentBatch | null,
  evidence: BatchNext4P2Evidence,
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
  ] as const) requireCount(rows, 10, label);

  for (const [code, identity] of Object.entries(BATCH_NEXT4_P2_TARGET.identities)) {
    assertIdentity(evidence, code, identity);
  }
}

export function buildBatchNext4P2SubmitInput() {
  return {
    batchId: BATCH_NEXT4_P2_TARGET.batchId,
    expectedRevision: BATCH_NEXT4_P2_TARGET.expectedRevision,
    commandId: BATCH_NEXT4_P2_TARGET.submitCommandId,
    note: BATCH_NEXT4_P2_TARGET.submitNote,
  };
}

export function assertBatchNext4P2SubmitAcknowledgement(result: BatchNext4P2SubmitAcknowledgement) {
  if (
    result.batchId !== BATCH_NEXT4_P2_TARGET.batchId
    || result.batchStatus !== 'SUBMITTED'
    || result.revision !== 11
    || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
  ) throw new Error('Batch Next 4 P2 SUBMIT acknowledgement is not the exact SUBMITTED rev11 APPLIED/REPLAYED result.');
}

export function formatBatchNext4P2Failure(error: unknown, commandCrossedBoundary: boolean) {
  const detail = error instanceof Error ? error.message : String(error);
  if (commandCrossedBoundary) {
    return `HOLD — SUBMIT may have been called. Do not retry or use a new command ID; read-only server verification is required. Detail: ${detail}`;
  }
  if (detail.startsWith('HOLD —')) return detail;
  return `HOLD — ${detail}; SUBMIT was not called.`;
}
