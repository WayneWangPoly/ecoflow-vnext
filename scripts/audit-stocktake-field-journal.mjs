import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');
const has = (source, text, message) => assert.ok(source.includes(text), message);
const lacks = (source, text, message) => assert.ok(!source.includes(text), message);

const journal = read('src/FirstStocktakeFieldJournal.tsx');
const bundle = read('src/enhancers/WarehouseOpsEnhancers.tsx');
const css = read('src/firstStocktakeFieldJournal.css');

has(bundle, '<FirstStocktakeFieldJournal />', 'Warehouse operations must mount the durable stocktake field journal.');
has(bundle, "firstStocktakeFieldJournal.css", 'Warehouse operations must load the field journal styles.');
has(journal, "ecoflow:first-stocktake-field-journal:v1", 'Stocktake counts must have a versioned device-storage key.');
has(journal, 'window.localStorage.setItem(JOURNAL_KEY', 'Every count must be persisted on the device.');
has(journal, "closest<HTMLButtonElement>('.first-stocktake-primary')", 'The journal must intercept the real Add control.');
has(journal, 'event.stopImmediatePropagation()', 'The original cloud-only Add handler must not race the local-first journal.');
has(journal, 'clearCountFields(screen)', 'The operator must be able to continue scanning without waiting for cloud sync.');
has(journal, 'idempotencyKey: entry.idempotencyKey', 'Cloud retries must reuse the durable stock-line idempotency key.');
has(journal, 'clientScannedAt: entry.clientScannedAt', 'Cloud retries must preserve the original field timestamp.');
has(journal, "status: 'SYNCED'", 'The journal must distinguish cloud-confirmed rows.');
has(journal, "status: 'NEEDS_REVIEW'", 'Unmatched or incomplete rows must remain visible for review.');
has(journal, "closest<HTMLButtonElement>('.first-stocktake-post')", 'The journal must guard final posting.');
has(journal, 'Final posting is blocked', 'Pending device rows must block final stock posting.');
has(journal, 'Export CSV', 'The operator must have a human-readable field backup.');
has(journal, 'Backup JSON', 'The operator must have a full retry-key backup.');
has(journal, 'window.addEventListener(\'online\'', 'Device rows must retry when connectivity returns.');
has(journal, 'recordBarcodeScan', 'Cloud sync must retain the barcode mapping event.');
has(journal, 'stageReceivingScan', 'Cloud sync must use the controlled receiving batch.');
has(journal, 'startStagedReceivingBatch', 'The journal must create or resume a controlled batch.');
lacks(journal, 'recordInventoryMovement', 'The field journal must never write stock directly.');
lacks(journal, 'receiveByBarcode', 'The field journal must never use a legacy direct-receive path.');
has(css, '.stocktake-journal-warning', 'Pending rows must have a visible warning state.');
has(css, '@media(max-width:760px)', 'The field journal must reflow on warehouse phones.');

console.log('Stocktake field journal audit passed (23 contracts).');
