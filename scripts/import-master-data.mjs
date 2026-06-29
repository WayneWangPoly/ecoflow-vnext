import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const inputDir = path.join(root, 'data', 'master');
const outDir = path.join(root, 'src', 'core', 'data', 'generated');
fs.mkdirSync(outDir, { recursive: true });

const now = new Date().toISOString();

function readCsv(fileName) {
  const file = path.join(inputDir, fileName);
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8').trim();
  if (!content) return [];
  const [headerLine, ...lines] = content.split(/\r?\n/);
  const headers = splitCsvLine(headerLine);
  return lines.filter(Boolean).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current.trim());
  return result;
}

function stableId(prefix, value) {
  const hash = crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

function bool(value, fallback = true) {
  if (value === undefined || value === '') return fallback;
  return ['true', '1', 'yes', 'y'].includes(String(value).toLowerCase());
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function writeTs(fileName, exportName, rows, importType) {
  const file = path.join(outDir, fileName);
  const body = `import type { ${importType} } from '@/core/types/database';\n\nexport const ${exportName}: ${importType}[] = ${JSON.stringify(rows, null, 2)};\n`;
  fs.writeFileSync(file, body, 'utf8');
  console.log(`wrote ${file}`);
}

const skuRows = readCsv('skus.csv');
const skus = skuRows.map((row) => ({
  id: stableId('sku', row.sku_code),
  skuCode: row.sku_code,
  displayName: row.display_name,
  category: row.category || 'Uncategorised',
  canSellByCarton: bool(row.can_sell_by_carton),
  canSellBySleeve: bool(row.can_sell_by_sleeve),
  sleevesPerCarton: number(row.sleeves_per_carton, 1),
  piecesPerSleeve: row.pieces_per_sleeve ? number(row.pieces_per_sleeve) : undefined,
  defaultStorageUnit: row.default_storage_unit || 'carton',
  defaultPickUnit: row.default_pick_unit || 'sleeve',
  packageWeight: row.package_weight ? number(row.package_weight) : undefined,
  canMixPack: bool(row.can_mix_pack),
  setupStatus: row.setup_status || 'active',
  createdAt: now,
  updatedAt: now
}));
writeTs('seedSkus.generated.ts', 'generatedSkus', skus, 'Sku');

const unitBySkuAndLevel = new Map();
const barcodeRows = readCsv('sku_barcodes.csv');
const units = [];
for (const row of barcodeRows) {
  const skuId = stableId('sku', row.sku_code);
  const level = row.unit_level || row.barcode_type || 'unknown';
  const key = `${skuId}:${level}`;
  if (!unitBySkuAndLevel.has(key)) {
    const unit = {
      id: stableId('unit', key),
      skuId,
      unitLevel: level,
      quantityInBaseUnit: number(row.quantity_in_base_unit, 1),
      isDefaultReceivingUnit: level === 'carton',
      isDefaultPickingUnit: level === 'sleeve' || level === 'piece',
      createdAt: now,
      updatedAt: now
    };
    unitBySkuAndLevel.set(key, unit);
    units.push(unit);
  }
}
writeTs('seedSkuUnits.generated.ts', 'generatedSkuUnits', units, 'SkuUnit');

const barcodes = barcodeRows.map((row) => {
  const skuId = stableId('sku', row.sku_code);
  const level = row.unit_level || row.barcode_type || 'unknown';
  return {
    id: stableId('barcode', `${skuId}:${row.barcode_value}:${level}`),
    skuId,
    skuUnitId: unitBySkuAndLevel.get(`${skuId}:${level}`)?.id,
    barcodeValue: String(row.barcode_value),
    barcodeType: row.barcode_type || level,
    unitLevel: level,
    quantityInBaseUnit: number(row.quantity_in_base_unit, 1),
    isPrimary: bool(row.is_primary, level === 'carton'),
    isActive: bool(row.is_active),
    createdAt: now,
    updatedAt: now
  };
});
writeTs('seedSkuBarcodes.generated.ts', 'generatedSkuBarcodes', barcodes, 'SkuBarcode');

const locationRows = readCsv('locations.csv');
const locations = locationRows.map((row) => ({
  id: stableId('loc', `${row.warehouse_code || 'MAIN'}:${row.location_code}`),
  warehouseId: stableId('wh', row.warehouse_code || 'MAIN'),
  locationCode: row.location_code,
  zone: row.zone || 'UNZONED',
  bay: row.bay || undefined,
  level: row.level || undefined,
  side: row.side || undefined,
  barcodeValue: row.barcode_value || `LOC-${row.location_code}`,
  locationType: row.location_type || 'rack',
  sortOrder: number(row.sort_order, 0),
  isPickable: bool(row.is_pickable),
  isStaging: bool(row.is_staging, false),
  isActive: bool(row.is_active),
  assignedSkuId: row.assigned_sku_code ? stableId('sku', row.assigned_sku_code) : undefined,
  createdAt: now,
  updatedAt: now
}));
writeTs('seedLocations.generated.ts', 'generatedLocations', locations, 'Location');

console.log('Master data import finished. Review generated files before wiring them into seed modules. Barcode values are preserved as text.');
