import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260820104500_warehouse_survey_001_smart_packaging_evidence.sql';
const repositoryPath = 'src/data/repositories/barcodeSurvey.ts';
const uiPath = 'src/features/operationalStability/BarcodeSurveyWorkspace.tsx';
const cameraPath = 'src/WarehouseCameraScanner.tsx';
const cameraCssPath = 'src/warehouseCameraPerformance.css';
const vendorScriptPath = 'scripts/warehouse-survey-001-vendor-scanner-assets.mjs';
const packagePath = 'package.json';

const [migration, repository, ui, camera, cameraCss, vendorScript, packageJson] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(repositoryPath, 'utf8'),
  readFile(uiPath, 'utf8'),
  readFile(cameraPath, 'utf8'),
  readFile(cameraCssPath, 'utf8'),
  readFile(vendorScriptPath, 'utf8'),
  readFile(packagePath, 'utf8'),
]);

test('smart evidence remains non-authoritative staging evidence', () => {
  assert.match(migration, /staging-only physical evidence/i);
  assert.match(migration, /does not publish barcode mappings/i);
  for (const forbiddenTarget of [
    'ecoflow_commercial_skus',
    'ecoflow_product_identity',
    'ecoflow_inventory_movements',
    'ecoflow_inventory_balances',
  ]) {
    assert.doesNotMatch(migration, new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${forbiddenTarget}`, 'i'));
  }
});

test('history is reusable only for exact SKU + exact carton direct physical evidence', () => {
  assert.match(migration, /o\.sku_context = v_sku_context/);
  assert.match(migration, /o\.carton_barcode = v_carton_barcode/);
  assert.match(migration, /o\.evidence_source = 'OBSERVED_NOW'/);
  assert.match(migration, /o\.sleeve_status in \('SCANNED', 'NO_SEPARATE_BARCODE'\)/);
  assert.match(migration, /count\(distinct case/i);
  assert.match(migration, /'CONFLICT'::text/);
  assert.match(migration, /v_signature_count <> 1/);
});

test('reused evidence is provenance-linked and server-derived, never presented as a new scan', () => {
  assert.match(migration, /REUSED_EXACT_PACKAGE/);
  assert.match(migration, /source_observation_id/);
  assert.match(migration, /v_source\.evidence_source <> 'OBSERVED_NOW'/);
  assert.match(migration, /v_source\.sku_context is distinct from v_sku_context/);
  assert.match(migration, /v_source\.carton_barcode is distinct from v_carton_barcode/);
  assert.match(migration, /BARCODE_SURVEY_REUSE_DERIVES_SLEEVE/);
  assert.match(migration, /BARCODE_SURVEY_EVIDENCE_CONFLICT/);
  assert.match(migration, /v_sleeve_status := v_source\.sleeve_status/);
  assert.match(migration, /v_sleeve_barcode := v_source\.sleeve_barcode/);
});

test('deferred cartons are explicit non-verifying observations', () => {
  assert.match(migration, /DEFERRED_INACCESSIBLE/);
  assert.match(migration, /DEFERRED_OPENING_REQUIRED/);
  assert.match(migration, /v_sleeve_status := 'NOT_CHECKED'/);
  assert.match(migration, /DEFER_DERIVES_SLEEVE/);
  assert.doesNotMatch(migration, /evidence_source = 'DEFERRED_INACCESSIBLE'[\s\S]{0,300}VERIFIED_/i);
});

test('repository uses bounded smart lookup and v3 append command while keeping v2 compatibility', () => {
  assert.match(repository, /ecoflow_get_barcode_survey_packaging_evidence_v1/);
  assert.match(repository, /ecoflow_record_barcode_survey_observation_v3/);
  assert.match(repository, /ecoflow_record_barcode_survey_observation_v2/);
  assert.match(repository, /REUSED_EXACT_PACKAGE/);
  assert.match(repository, /DEFERRED_INACCESSIBLE/);
  assert.match(repository, /DEFERRED_OPENING_REQUIRED/);
  assert.match(repository, /sourceObservationId/);
});

test('field UI defaults verified exact packages to reuse and offers safe opportunity deferral', () => {
  assert.match(ui, /Packaging already verified/);
  assert.match(ui, /No need to open this carton/);
  assert.match(ui, /Use verified evidence/);
  assert.match(ui, /New \/ unverified packaging/);
  assert.match(ui, /Defer — high rack \/ inaccessible/);
  assert.match(ui, /Cannot check without opening stock/);
  assert.match(ui, /Conflicting physical evidence/);
  assert.match(ui, /never guess or use “latest wins”/);
  assert.match(ui, /setCaptureMode\('REUSED_EXACT_PACKAGE'\)/);
  assert.match(ui, /Not checked is recorded as a defer reason, not as verified packaging evidence/);
});

test('camera scanning contract remains mounted and targets the same stable inputs', () => {
  assert.match(ui, /<WarehouseCameraScanner \/>/);
  assert.match(ui, /ecoflow:warehouse-camera-scan/);
  assert.match(ui, /barcode-survey-carton-input/);
  assert.match(ui, /barcode-survey-sleeve-input/);
  assert.match(ui, /requestCameraScan\(CARTON_INPUT_ID\)/);
  assert.match(ui, /requestCameraScan\(SLEEVE_INPUT_ID\)/);
});

test('iPhone barcode scanning requires the rear environment camera and fails closed on front camera', () => {
  assert.match(camera, /facingMode: strictEnvironment \? \{ exact: 'environment' \} : \{ ideal: 'environment' \}/);
  assert.match(camera, /getSettings\(\)\.facingMode/);
  assert.match(camera, /settingsFacingMode === 'user'/);
  assert.match(camera, /score > 0/);
  assert.match(camera, /never treat an arbitrary first device as "rear"/i);
  assert.match(camera, /Rear camera could not be selected/);
  assert.match(camera, /getUserMedia\(cameraConstraints\(undefined, true\)\)/);
  assert.doesNotMatch(camera, /sort\([^\n]+\)\[0\] \?\? null/);
});

test('scanner v2 uses centre ROI multi-profile ZXing-C++ WASM decoding with a legacy runtime fallback', () => {
  assert.match(camera, /ZXING_WASM_READER_URL = `\/vendor\/zxing-wasm\/\$\{ZXING_WASM_VERSION\}\/reader\/index\.js`/);
  assert.match(camera, /const ZXING_WASM_VERSION = '2\.0\.2'/);
  assert.match(camera, /readBarcodes\?: \(source: ImageData/);
  assert.match(camera, /const SCAN_PROFILES: ScanProfile\[\]/);
  assert.match(camera, /widthFraction: 0\.82, heightFraction: 0\.34/);
  assert.match(camera, /widthFraction: 1, heightFraction: 1/);
  assert.match(camera, /captureBarcodeCandidate/);
  assert.match(camera, /getImageData\(0, 0, targetWidth, targetHeight\)/);
  assert.match(camera, /applyBarcodeContrast/);
  assert.match(camera, /formats: WAREHOUSE_WASM_FORMATS/);
  assert.match(camera, /tryHarder: true/);
  assert.match(camera, /maxNumberOfSymbols: 1/);
  assert.match(camera, /scanProfileForAttempt\(scanAttemptRef\.current, targetKindRef\.current\)/);
  assert.match(camera, /startLegacyIphoneFallback/);
  assert.match(camera, /Fast scanner ready/);
});

test('scanner v2.1 self-hosts both runtime engines and recovers from a poisoned WASM runtime', () => {
  assert.match(camera, /ZXING_FALLBACK_URL = `\/vendor\/zxing-browser\/\$\{ZXING_BROWSER_VERSION\}\/zxing-browser\.min\.js`/);
  assert.match(camera, /ZXING_WASM_BINARY_URL = `\/vendor\/zxing-wasm\/\$\{ZXING_WASM_VERSION\}\/reader\/zxing_reader\.wasm`/);
  assert.doesNotMatch(camera, /https:\/\/(?:cdn|fastly)\.jsdelivr\.net/);
  assert.doesNotMatch(camera, /https:\/\/unpkg\.com/);
  assert.match(camera, /prepareZXingModule/);
  assert.match(camera, /fireImmediately: true/);
  assert.match(camera, /locateFile: \(path, prefix\) => path\.endsWith\('\.wasm'\) \? ZXING_WASM_BINARY_URL/);
  assert.match(camera, /const WASM_RUNTIME_FAILURE_LIMIT = 2/);
  assert.match(camera, /const WASM_RECOVERY_LIMIT = 1/);
  assert.match(camera, /purgeZXingModule/);
  assert.match(camera, /equalityFn: \(\) => false/);
  assert.match(camera, /recoverZxingWasmReader/);
  assert.match(camera, /activateLegacyFallback/);
  assert.match(camera, /wasmRuntimeFailureRef\.current = 0/);
  assert.match(camera, /Backup scanner active/);
});

test('scanner v2.2.1 preserves the field-proven carton target lifecycle while keeping sleeve micro-ROI', () => {
  assert.match(camera, /const SLEEVE_INPUT_ID = 'barcode-survey-sleeve-input'/);
  assert.match(camera, /const SLEEVE_SCAN_PROFILES: ScanProfile\[\]/);
  assert.match(camera, /widthFraction: 0\.46, heightFraction: 0\.20, contrast: 1\.10, upscale: 1\.80, maxWidth: 1920/);
  assert.match(camera, /widthFraction: 0\.36, heightFraction: 0\.16, contrast: 1\.35, upscale: 2\.20, maxWidth: 1920/);
  assert.match(camera, /widthFraction: 0\.28, heightFraction: 0\.14, contrast: 1\.55, upscale: 2\.50, maxWidth: 1920/);
  assert.match(camera, /\.\.\.SCAN_PROFILES/);
  assert.match(camera, /targetKind === 'sleeve' \? SLEEVE_SCAN_PROFILES : SCAN_PROFILES/);

  // The known-good v2.1 behaviour targets the active barcode input. The keyboard
  // guard must preserve that active element instead of replacing it with a detached ref.
  assert.match(camera, /const target = barcodeInput\(\);/);
  assert.match(camera, /function focusBarcodeInputWithoutKeyboard\(input: HTMLInputElement\)/);
  assert.match(camera, /input\.readOnly = true/);
  assert.match(camera, /input\.focus\(\{ preventScroll: true \}\)/);
  assert.match(camera, /guardBarcodeTarget\(requested\)/);
  assert.match(camera, /releaseBarcodeInputFocus/);
  assert.doesNotMatch(camera, /targetInputRef/);
  assert.doesNotMatch(camera, /dismissSoftKeyboard/);
  assert.doesNotMatch(camera, /document\.documentElement\.classList\.add\('warehouse-camera-open'\)/);
  assert.doesNotMatch(camera, /document\.body\.classList\.add\('warehouse-camera-open'\)/);

  // The mobile layout itself stays on the previously working v2.1 viewport rules;
  // only the sleeve reticle is narrower.
  assert.doesNotMatch(cameraCss, /html\.warehouse-camera-open/);
  assert.doesNotMatch(cameraCss, /body\.warehouse-camera-open/);
  assert.doesNotMatch(cameraCss, /contain: layout paint size/);
  assert.match(cameraCss, /\.warehouse-camera-reticle\.sleeve/);
  assert.match(cameraCss, /left: 27%/);
  assert.match(cameraCss, /height: 20%/);
});

test('scanner runtime assets are pinned, integrity-checked at build time and emitted under public vendor paths', () => {
  assert.match(vendorScript, /const ZXING_WASM_VERSION = '2\.0\.2'/);
  assert.match(vendorScript, /const ZXING_BROWSER_VERSION = '0\.2\.1'/);
  assert.match(vendorScript, /public\/vendor\/zxing-wasm\/\$\{ZXING_WASM_VERSION\}\/reader\/index\.js/);
  assert.match(vendorScript, /public\/vendor\/zxing-wasm\/\$\{ZXING_WASM_VERSION\}\/reader\/zxing_reader\.wasm/);
  assert.match(vendorScript, /public\/vendor\/zxing-browser\/\$\{ZXING_BROWSER_VERSION\}\/zxing-browser\.min\.js/);
  assert.match(vendorScript, /createHash\('sha256'\)/);
  assert.match(vendorScript, /bytes\[0\] === 0x00/);
  assert.match(vendorScript, /bytes\[1\] === 0x61/);
  assert.match(vendorScript, /embeddedSha256\.includes\(actualSha256\)/);
  assert.match(vendorScript, /https:\/\/cdn\.jsdelivr\.net\/npm\/zxing-wasm@\$\{ZXING_WASM_VERSION\}/);
  assert.match(vendorScript, /https:\/\/unpkg\.com\/zxing-wasm@\$\{ZXING_WASM_VERSION\}/);
  assert.match(packageJson, /"prebuild": "node scripts\/warehouse-survey-001-vendor-scanner-assets\.mjs"/);
});
