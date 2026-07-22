import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import {
  recordBarcodeScan,
  setSkuPackagePolicy,
  startBarcodeScanSession,
  type BarcodePackageLevel,
  type SkuPackageMode,
} from '@/data/repositories/inventoryControl';
import {
  loadOpenStagedReceivingBatches,
  stageReceivingScan,
  startStagedReceivingBatch,
} from '@/data/repositories/stagedReceiving';
import { loadStocktakeSkuOptions, type StocktakeSkuOption } from '@/data/repositories/stocktakeAssist';
import { loadWarehouseLocationItems, type WarehouseLocationItemRow } from '@/data/repositories/warehouseLocations';

const JOURNAL_KEY = 'ecoflow:first-stocktake-field-journal:v1';
const SESSION_KEY = 'ecoflow:first-stocktake-session';
const BATCH_KEY = 'ecoflow:first-stocktake-batch';
const BARCODE_INPUT_ID = 'first-stocktake-package-barcode';
const MAX_JOURNAL_ROWS = 5000;

type WarehouseFacing = 'left' | 'right' | 'front';
type JournalStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'NEEDS_REVIEW' | 'POSTED';

type LocationOption = {
  baseCode: string;
  storageCode: string;
  side: WarehouseFacing;
};

type LocationChoice = {
  baseCode: string;
  options: LocationOption[];
};

type CaptureSnapshot = {
  baseLocation: string;
  storageLocation: string;
  locationMatched: boolean;
  facing: WarehouseFacing;
  sku: string;
  barcode: string;
  packageMode: SkuPackageMode;
  packageLevel: BarcodePackageLevel;
  unitsPerPackage: number;
  packagesObserved: number;
  note: string;
};

type StocktakeJournalEntry = CaptureSnapshot & {
  id: string;
  fingerprint: string;
  idempotencyKey: string;
  clientScannedAt: string;
  createdAt: string;
  updatedAt: string;
  status: JournalStatus;
  attemptCount: number;
  error: string;
  policySaved: boolean;
  barcodeSaved: boolean;
  batchId: string;
  cloudLineId: string;
};

function canonicalTypedLocation(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function compact(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function baseLocationCode(locationCode: string, side: WarehouseFacing) {
  const code = canonicalTypedLocation(locationCode);
  if (side === 'left') return code.replace(/-L-/, '-');
  if (side === 'right') return code.replace(/-R-/, '-');
  return code;
}

function storageLocationFallback(baseCode: string, side: WarehouseFacing) {
  const code = canonicalTypedLocation(baseCode);
  if (side === 'front' || /-[LR]-/.test(code)) return code;
  const [rack, ...rest] = code.split('-').filter(Boolean);
  if (!rack || !rest.length) return code;
  return [rack, side === 'left' ? 'L' : 'R', ...rest].join('-');
}

function buildLocationChoices(rows: WarehouseLocationItemRow[]) {
  const deduped = new Map<string, LocationOption>();
  rows
    .filter((row) => row.location_status === 'ACTIVE')
    .forEach((row) => {
      const side = row.side as WarehouseFacing;
      if (!['left', 'right', 'front'].includes(side)) return;
      const storageCode = canonicalTypedLocation(row.location_code);
      if (!storageCode) return;
      const option: LocationOption = {
        baseCode: baseLocationCode(storageCode, side),
        storageCode,
        side,
      };
      deduped.set(`${option.storageCode}:${option.side}`, option);
    });

  const grouped = new Map<string, LocationOption[]>();
  Array.from(deduped.values()).forEach((option) => {
    grouped.set(option.baseCode, [...(grouped.get(option.baseCode) ?? []), option]);
  });

  return Array.from(grouped.entries()).map(([baseCode, options]) => ({ baseCode, options }));
}

function resolveLocation(value: string, facing: WarehouseFacing, rows: WarehouseLocationItemRow[]) {
  const typed = canonicalTypedLocation(value);
  const choices = buildLocationChoices(rows);
  const choice = choices.find((item) => compact(item.baseCode) === compact(typed));
  const selected = choice?.options.find((option) => option.side === facing) ?? choice?.options[0] ?? null;
  return {
    baseLocation: choice?.baseCode || typed,
    storageLocation: selected?.storageCode || storageLocationFallback(typed, facing),
    facing: selected?.side || facing,
    matched: Boolean(choice && selected),
  };
}

function canonicalSku(value: string, options: StocktakeSkuOption[]) {
  const trimmed = value.trim().toUpperCase();
  const exact = options.find((option) => option.sku.toUpperCase() === trimmed)
    ?? options.find((option) => compact(option.sku) === compact(trimmed));
  return exact?.sku || trimmed;
}

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isJournalStatus(value: unknown): value is JournalStatus {
  return value === 'PENDING' || value === 'SYNCING' || value === 'SYNCED' || value === 'NEEDS_REVIEW' || value === 'POSTED';
}

function readJournal() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(JOURNAL_KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [] as StocktakeJournalEntry[];
    return parsed
      .filter((item): item is StocktakeJournalEntry => Boolean(item && typeof item === 'object' && 'id' in item && 'sku' in item))
      .map((item) => ({
        ...item,
        status: item.status === 'SYNCING' || !isJournalStatus(item.status) ? 'PENDING' : item.status,
        error: item.status === 'SYNCING' ? 'The browser closed before cloud confirmation. Retry uses the same stock-line key.' : String(item.error || ''),
        attemptCount: Number(item.attemptCount || 0),
        policySaved: Boolean(item.policySaved),
        barcodeSaved: Boolean(item.barcodeSaved),
        batchId: String(item.batchId || ''),
        cloudLineId: String(item.cloudLineId || ''),
      }))
      .slice(-MAX_JOURNAL_ROWS);
  } catch {
    return [] as StocktakeJournalEntry[];
  }
}

function writeJournal(rows: StocktakeJournalEntry[]) {
  const bounded = rows.slice(-MAX_JOURNAL_ROWS);
  window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(bounded));
  return bounded;
}

function inputValue(screen: HTMLElement, selector: string) {
  return screen.querySelector<HTMLInputElement>(selector)?.value.trim() || '';
}

function selectedFacing(screen: HTMLElement): WarehouseFacing {
  const label = screen.querySelector<HTMLButtonElement>('.first-stocktake-facing-options button.active')?.textContent?.toLowerCase() || '';
  if (label.includes('right')) return 'right';
  if (label.includes('front')) return 'front';
  return 'left';
}

function readCaptureSnapshot(screen: HTMLElement, locationRows: WarehouseLocationItemRow[], skuOptions: StocktakeSkuOption[], allowMissingBarcode = false) {
  const location = inputValue(screen, '#first-stocktake-location');
  const sku = canonicalSku(inputValue(screen, '#first-stocktake-sku'), skuOptions);
  const barcode = inputValue(screen, `#${BARCODE_INPUT_ID}`);
  const selects = Array.from(screen.querySelectorAll<HTMLSelectElement>('.first-stocktake-package-rule select'));
  const counts = Array.from(screen.querySelectorAll<HTMLInputElement>('.first-stocktake-count-row input'));
  const noteInput = Array.from(screen.querySelectorAll<HTMLInputElement>('.first-stocktake-entry input')).find((input) => /damaged cartons|count note/i.test(input.placeholder));
  const facing = selectedFacing(screen);
  const resolved = resolveLocation(location, facing, locationRows);
  const unitsPerPackage = Number(counts[0]?.value || 0);
  const packagesObserved = Number(counts[1]?.value || 0);
  const packageMode = (selects[0]?.value || 'CARTON_AND_SLEEVE') as SkuPackageMode;
  const packageLevel = (selects[1]?.value || 'CARTON') as BarcodePackageLevel;

  if (!location) throw new Error('Enter the warehouse location before recording this count.');
  if (!sku) throw new Error('Enter the Ordermentum SKU before recording this count.');
  if (!barcode && !allowMissingBarcode) throw new Error('Scan or enter the package barcode. Use “Save current count locally” only when the barcode is missing.');
  if (!Number.isInteger(unitsPerPackage) || unitsPerPackage <= 0) throw new Error('Units per package must be a whole number greater than zero.');
  if (!Number.isInteger(packagesObserved) || packagesObserved <= 0) throw new Error('Packages counted must be a whole number greater than zero.');

  return {
    baseLocation: resolved.baseLocation,
    storageLocation: resolved.storageLocation,
    locationMatched: locationRows.length === 0 ? false : resolved.matched,
    facing: resolved.facing,
    sku,
    barcode,
    packageMode,
    packageLevel,
    unitsPerPackage,
    packagesObserved,
    note: noteInput?.value.trim() || '',
  } satisfies CaptureSnapshot;
}

function fingerprint(snapshot: CaptureSnapshot) {
  return JSON.stringify([
    snapshot.storageLocation,
    snapshot.facing,
    snapshot.sku,
    snapshot.barcode,
    snapshot.packageLevel,
    snapshot.unitsPerPackage,
    snapshot.packagesObserved,
    snapshot.note,
  ]);
}

function nativeInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function nativeSelectValue(select: HTMLSelectElement | null, value: string) {
  if (!select) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function clearCountFields(screen: HTMLElement) {
  nativeInputValue(screen.querySelector<HTMLInputElement>('#first-stocktake-sku'), '');
  nativeInputValue(screen.querySelector<HTMLInputElement>(`#${BARCODE_INPUT_ID}`), '');
  const counts = Array.from(screen.querySelectorAll<HTMLInputElement>('.first-stocktake-count-row input'));
  nativeInputValue(counts[1] ?? null, '1');
  const noteInput = Array.from(screen.querySelectorAll<HTMLInputElement>('.first-stocktake-entry input')).find((input) => /damaged cartons|count note/i.test(input.placeholder));
  nativeInputValue(noteInput ?? null, '');
  window.setTimeout(() => screen.querySelector<HTMLInputElement>('#first-stocktake-sku')?.focus(), 0);
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function networkFailure(message: string) {
  return /failed to fetch|network|load failed|offline|timeout|timed out|connection|supabase is not configured|57014/i.test(message);
}

function statusLabel(status: JournalStatus) {
  if (status === 'SYNCED') return 'Cloud saved';
  if (status === 'SYNCING') return 'Syncing';
  if (status === 'NEEDS_REVIEW') return 'Needs review';
  if (status === 'POSTED') return 'Posted';
  return 'Device saved';
}

export function FirstStocktakeFieldJournal() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [journal, setJournal] = useState<StocktakeJournalEntry[]>(readJournal);
  const [locationRows, setLocationRows] = useState<WarehouseLocationItemRow[]>([]);
  const [skuOptions, setSkuOptions] = useState<StocktakeSkuOption[]>([]);
  const [message, setMessage] = useState('');
  const [storageError, setStorageError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const journalRef = useRef(journal);
  const locationRowsRef = useRef(locationRows);
  const skuOptionsRef = useRef(skuOptions);
  const processingRef = useRef(false);
  const batchIdRef = useRef(window.localStorage.getItem(BATCH_KEY) || '');
  const sessionIdRef = useRef(window.localStorage.getItem(SESSION_KEY) || '');
  const editingEntryRef = useRef('');
  const lastCaptureRef = useRef({ fingerprint: '', at: 0 });

  const counts = useMemo(() => ({
    total: journal.length,
    pending: journal.filter((entry) => entry.status === 'PENDING' || entry.status === 'SYNCING').length,
    review: journal.filter((entry) => entry.status === 'NEEDS_REVIEW').length,
    synced: journal.filter((entry) => entry.status === 'SYNCED').length,
    posted: journal.filter((entry) => entry.status === 'POSTED').length,
  }), [journal]);
  const unresolved = counts.pending + counts.review;

  function replaceJournal(next: StocktakeJournalEntry[]) {
    try {
      const saved = writeJournal(next);
      journalRef.current = saved;
      setJournal(saved);
      setStorageError('');
      return saved;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setStorageError(`This phone could not save the field journal: ${detail}. Do not continue until device storage works or use a paper backup.`);
      throw error;
    }
  }

  function updateEntry(id: string, patch: Partial<StocktakeJournalEntry>) {
    const updatedAt = new Date().toISOString();
    replaceJournal(journalRef.current.map((entry) => entry.id === id ? { ...entry, ...patch, updatedAt } : entry));
  }

  function addOrUpdateEntry(snapshot: CaptureSnapshot, initialStatus: JournalStatus) {
    const now = new Date().toISOString();
    const nextFingerprint = fingerprint(snapshot);
    const editingId = editingEntryRef.current;
    editingEntryRef.current = '';

    if (editingId) {
      const existing = journalRef.current.find((entry) => entry.id === editingId);
      if (existing) {
        const changed = existing.fingerprint !== nextFingerprint;
        const updated: StocktakeJournalEntry = {
          ...existing,
          ...snapshot,
          fingerprint: nextFingerprint,
          idempotencyKey: changed ? uuid() : existing.idempotencyKey,
          clientScannedAt: changed ? now : existing.clientScannedAt,
          status: initialStatus,
          error: snapshot.barcode ? '' : 'Barcode missing. Add the correct package barcode before cloud sync.',
          policySaved: changed ? false : existing.policySaved,
          barcodeSaved: changed ? false : existing.barcodeSaved,
          batchId: changed ? '' : existing.batchId,
          cloudLineId: changed ? '' : existing.cloudLineId,
          updatedAt: now,
        };
        replaceJournal(journalRef.current.map((entry) => entry.id === editingId ? updated : entry));
        return updated;
      }
    }

    const entry: StocktakeJournalEntry = {
      ...snapshot,
      id: uuid(),
      fingerprint: nextFingerprint,
      idempotencyKey: uuid(),
      clientScannedAt: now,
      createdAt: now,
      updatedAt: now,
      status: initialStatus,
      attemptCount: 0,
      error: snapshot.barcode ? '' : 'Barcode missing. Add the correct package barcode before cloud sync.',
      policySaved: false,
      barcodeSaved: false,
      batchId: '',
      cloudLineId: '',
    };
    replaceJournal([...journalRef.current, entry]);
    return entry;
  }

  async function ensureSession(targetLocation: string) {
    if (sessionIdRef.current) return sessionIdRef.current;
    const stored = window.localStorage.getItem(SESSION_KEY) || '';
    if (stored) {
      sessionIdRef.current = stored;
      return stored;
    }
    const rows = await startBarcodeScanSession({
      sessionName: `First stocktake ${new Date().toLocaleDateString('en-AU')}`,
      targetArea: targetLocation || 'Warehouse',
    });
    const sessionId = rows[0]?.session_id || '';
    if (!sessionId) throw new Error('Could not start the first-stocktake barcode session.');
    window.localStorage.setItem(SESSION_KEY, sessionId);
    sessionIdRef.current = sessionId;
    return sessionId;
  }

  async function ensureBatch() {
    if (batchIdRef.current) return batchIdRef.current;
    const stored = window.localStorage.getItem(BATCH_KEY) || '';
    const open = await loadOpenStagedReceivingBatches();
    const storedBatch = stored ? open.find((batch) => batch.id === stored) : null;
    if (storedBatch) {
      batchIdRef.current = storedBatch.id;
      return storedBatch.id;
    }
    if (stored) window.localStorage.removeItem(BATCH_KEY);
    if (open.length > 0) {
      const proceed = window.confirm('Another receiving batch is already open. Start a separate first-stocktake batch so both jobs remain auditable?');
      if (!proceed) throw new Error('No first-stocktake batch was selected. Finish the other receiving batch or confirm a separate stocktake batch.');
    }
    const rows = await startStagedReceivingBatch();
    const batchId = rows[0]?.batch_id || '';
    if (!batchId) throw new Error('Could not start the controlled first-stocktake batch.');
    window.localStorage.setItem(BATCH_KEY, batchId);
    batchIdRef.current = batchId;
    return batchId;
  }

  function refreshNativeBatch() {
    const screen = host?.closest<HTMLElement>('.first-stocktake-screen');
    const refresh = Array.from(screen?.querySelectorAll<HTMLButtonElement>('.first-stocktake-hero-actions button') ?? [])
      .find((button) => /refresh/i.test(button.textContent || ''));
    refresh?.click();
  }

  async function syncEntry(id: string) {
    let entry = journalRef.current.find((item) => item.id === id);
    if (!entry || entry.status === 'SYNCED' || entry.status === 'POSTED') return;
    if (!entry.barcode) {
      updateEntry(id, { status: 'NEEDS_REVIEW', error: 'Barcode missing. Edit this row and scan the correct carton or sleeve barcode.' });
      return;
    }
    if (locationRowsRef.current.length > 0 && !entry.locationMatched) {
      updateEntry(id, { status: 'NEEDS_REVIEW', error: `Location ${entry.baseLocation} did not match an active warehouse cell. Edit the row and choose a suggested location.` });
      return;
    }

    updateEntry(id, { status: 'SYNCING', attemptCount: entry.attemptCount + 1, error: '' });
    entry = journalRef.current.find((item) => item.id === id) || entry;
    const sessionId = await ensureSession(entry.storageLocation);
    const batchId = entry.batchId || await ensureBatch();
    if (!entry.batchId) updateEntry(id, { batchId });

    if (!entry.policySaved) {
      await setSkuPackagePolicy({
        sku: entry.sku,
        packageMode: entry.packageMode,
        defaultShelf: entry.storageLocation,
        note: entry.note || `First stocktake · FACING ${entry.facing.toUpperCase()}`,
      });
      updateEntry(id, { policySaved: true });
    }

    entry = journalRef.current.find((item) => item.id === id) || entry;
    if (!entry.barcodeSaved) {
      await recordBarcodeScan({
        sessionId,
        sku: entry.sku,
        barcode: entry.barcode,
        packageLevel: entry.packageLevel,
        unitsPerBarcode: entry.unitsPerPackage,
        shelf: entry.storageLocation,
        qtyObserved: entry.packagesObserved,
        actionMode: 'MAP_AND_COUNT',
        note: entry.note || `First stocktake mapping and observed count · FACING ${entry.facing.toUpperCase()}`,
      });
      updateEntry(id, { barcodeSaved: true });
    }

    const staged = await stageReceivingScan({
      batchId,
      barcode: entry.barcode,
      qtyPackages: entry.packagesObserved,
      targetLocation: entry.storageLocation,
      note: `FIRST STOCKTAKE · ${entry.sku} · ${entry.packageLevel} · FACING ${entry.facing.toUpperCase()}${entry.note ? ` · ${entry.note}` : ''}`,
      idempotencyKey: entry.idempotencyKey,
      clientScannedAt: entry.clientScannedAt,
    });
    const first = staged[0];
    updateEntry(id, {
      status: 'SYNCED',
      batchId: first?.batch_id || batchId,
      cloudLineId: first?.line_id || entry.cloudLineId,
      error: '',
    });
    refreshNativeBatch();
  }

  async function processIds(ids?: string[]) {
    if (processingRef.current) return;
    if (!navigator.onLine) {
      setMessage('Offline: every count is safe on this device. Cloud sync will resume when a connection is available.');
      return;
    }
    processingRef.current = true;
    setSyncing(true);
    setMessage('');
    const targets = ids ?? journalRef.current.filter((entry) => entry.status === 'PENDING').map((entry) => entry.id);
    try {
      for (const id of targets) {
        const current = journalRef.current.find((entry) => entry.id === id);
        if (!current || current.status === 'SYNCED' || current.status === 'POSTED') continue;
        try {
          await syncEntry(id);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (networkFailure(detail)) {
            updateEntry(id, { status: 'PENDING', error: `${detail} · Count remains saved on this device.` });
            setMessage('Cloud connection stopped. Continue counting: new rows remain safe on this device. Retry pending when reception returns.');
            break;
          }
          updateEntry(id, { status: 'NEEDS_REVIEW', error: detail });
        }
      }
    } finally {
      processingRef.current = false;
      setSyncing(false);
      const stillPending = journalRef.current.some((entry) => entry.status === 'PENDING');
      if (stillPending && navigator.onLine && !journalRef.current.some((entry) => networkFailure(entry.error))) {
        window.setTimeout(() => void processIds(), 0);
      }
    }
  }

  function captureAndQueue(allowMissingBarcode = false) {
    const screen = host?.closest<HTMLElement>('.first-stocktake-screen');
    if (!screen) return;
    try {
      const snapshot = readCaptureSnapshot(screen, locationRowsRef.current, skuOptionsRef.current, allowMissingBarcode);
      const nextFingerprint = fingerprint(snapshot);
      const now = Date.now();
      if (lastCaptureRef.current.fingerprint === nextFingerprint && now - lastCaptureRef.current.at < 800) return;
      lastCaptureRef.current = { fingerprint: nextFingerprint, at: now };
      const initialStatus: JournalStatus = snapshot.barcode ? 'PENDING' : 'NEEDS_REVIEW';
      const entry = addOrUpdateEntry(snapshot, initialStatus);
      clearCountFields(screen);
      setMessage(snapshot.barcode
        ? `${snapshot.sku} saved on this device. You can scan the next item while cloud sync runs.`
        : `${snapshot.sku} saved locally without a barcode. Photograph or label the package, then edit this row before final posting.`);
      if (entry.status === 'PENDING') void processIds();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function editEntry(entry: StocktakeJournalEntry) {
    const screen = host?.closest<HTMLElement>('.first-stocktake-screen');
    if (!screen) return;
    nativeInputValue(screen.querySelector<HTMLInputElement>('#first-stocktake-location'), entry.baseLocation);
    const facingButton = Array.from(screen.querySelectorAll<HTMLButtonElement>('.first-stocktake-facing-options button'))
      .find((button) => button.textContent?.toLowerCase().includes(entry.facing));
    facingButton?.click();
    nativeInputValue(screen.querySelector<HTMLInputElement>('#first-stocktake-sku'), entry.sku);
    nativeInputValue(screen.querySelector<HTMLInputElement>(`#${BARCODE_INPUT_ID}`), entry.barcode);
    const selects = Array.from(screen.querySelectorAll<HTMLSelectElement>('.first-stocktake-package-rule select'));
    nativeSelectValue(selects[0] ?? null, entry.packageMode);
    nativeSelectValue(selects[1] ?? null, entry.packageLevel);
    const countInputs = Array.from(screen.querySelectorAll<HTMLInputElement>('.first-stocktake-count-row input'));
    nativeInputValue(countInputs[0] ?? null, String(entry.unitsPerPackage));
    nativeInputValue(countInputs[1] ?? null, String(entry.packagesObserved));
    const noteInput = Array.from(screen.querySelectorAll<HTMLInputElement>('.first-stocktake-entry input')).find((input) => /damaged cartons|count note/i.test(input.placeholder));
    nativeInputValue(noteInput ?? null, entry.note);
    editingEntryRef.current = entry.id;
    setMessage(`Editing ${entry.sku}. Correct the fields, then tap Add to update this device row and sync it safely.`);
    screen.querySelector('.first-stocktake-entry')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exportCsv() {
    const headers = ['status', 'created_at', 'updated_at', 'location', 'storage_location', 'facing', 'sku', 'barcode', 'package_mode', 'package_level', 'units_per_package', 'packages_counted', 'total_units', 'note', 'batch_id', 'cloud_line_id', 'idempotency_key', 'error'];
    const rows = journalRef.current.map((entry) => [
      entry.status,
      entry.createdAt,
      entry.updatedAt,
      entry.baseLocation,
      entry.storageLocation,
      entry.facing,
      entry.sku,
      entry.barcode,
      entry.packageMode,
      entry.packageLevel,
      entry.unitsPerPackage,
      entry.packagesObserved,
      entry.unitsPerPackage * entry.packagesObserved,
      entry.note,
      entry.batchId,
      entry.cloudLineId,
      entry.idempotencyKey,
      entry.error,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    downloadText(`ecoflow-stocktake-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
    setMessage('CSV backup created. Keep one copy outside this browser after each warehouse zone.');
  }

  function exportJson() {
    downloadText(`ecoflow-stocktake-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), entries: journalRef.current }, null, 2), 'application/json');
    setMessage('Full JSON backup created with retry keys and cloud status.');
  }

  function clearPosted() {
    if (!window.confirm('Remove only rows already marked Posted from this phone? Pending, review and cloud-saved unposted rows will remain.')) return;
    replaceJournal(journalRef.current.filter((entry) => entry.status !== 'POSTED'));
  }

  useEffect(() => observeBody(() => {
    const screen = document.querySelector<HTMLElement>('.first-stocktake-screen');
    if (!screen) {
      setHost(null);
      return;
    }
    let mount = screen.querySelector<HTMLElement>(':scope > .first-stocktake-field-journal-mount');
    if (!mount) {
      mount = document.createElement('div');
      mount.className = 'first-stocktake-field-journal-mount';
      const review = screen.querySelector('.first-stocktake-review');
      screen.insertBefore(mount, review || null);
    }
    setHost((current) => current === mount ? current : mount);
  }), []);

  useEffect(() => {
    journalRef.current = journal;
  }, [journal]);

  useEffect(() => {
    locationRowsRef.current = locationRows;
  }, [locationRows]);

  useEffect(() => {
    skuOptionsRef.current = skuOptions;
  }, [skuOptions]);

  useEffect(() => {
    void loadWarehouseLocationItems().then(setLocationRows).catch(() => setMessage('Location assistance is unavailable. Counts are still saved locally, but unmatched rows will wait for review.'));
    void loadStocktakeSkuOptions().then(setSkuOptions).catch(() => setMessage('SKU assistance is unavailable. Enter the exact Ordermentum SKU; every count is still saved locally.'));
  }, []);

  useEffect(() => {
    const screen = host?.closest<HTMLElement>('.first-stocktake-screen');
    if (!screen) return;

    const captureClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const add = target?.closest<HTMLButtonElement>('.first-stocktake-primary');
      if (add && screen.contains(add)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        captureAndQueue(false);
        return;
      }
      const post = target?.closest<HTMLButtonElement>('.first-stocktake-post');
      if (post && screen.contains(post) && unresolved > 0) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setMessage(`${unresolved} device-saved row${unresolved === 1 ? '' : 's'} still need cloud sync or review. Final posting is blocked so no physical count is left behind.`);
      }
    };

    const captureKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.id !== BARCODE_INPUT_ID || !screen.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      captureAndQueue(false);
    };

    document.addEventListener('click', captureClick, true);
    document.addEventListener('keydown', captureKey, true);
    return () => {
      document.removeEventListener('click', captureClick, true);
      document.removeEventListener('keydown', captureKey, true);
    };
  }, [host, unresolved]);

  useEffect(() => {
    const screen = host?.closest<HTMLElement>('.first-stocktake-screen');
    if (!screen) return;
    let previousNotice = '';
    const observePosting = () => {
      const notice = screen.querySelector<HTMLElement>('.first-stocktake-notice')?.textContent?.trim() || '';
      if (!notice || notice === previousNotice) return;
      previousNotice = notice;
      if (!/First stocktake posted once:/i.test(notice)) return;
      const postedBatchId = batchIdRef.current;
      replaceJournal(journalRef.current.map((entry) => entry.status === 'SYNCED' && (!postedBatchId || entry.batchId === postedBatchId)
        ? { ...entry, status: 'POSTED', updatedAt: new Date().toISOString() }
        : entry));
      batchIdRef.current = '';
      sessionIdRef.current = '';
      setMessage('Opening stock posted. The device journal remains as an audit backup until you export it and clear Posted rows.');
    };
    const observer = new MutationObserver(observePosting);
    observer.observe(screen, { subtree: true, childList: true, characterData: true });
    observePosting();
    return () => observer.disconnect();
  }, [host]);

  useEffect(() => {
    const retry = () => {
      setMessage('Connection restored. Retrying device-saved stocktake rows.');
      void processIds();
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);

  if (!host) return null;

  const visibleRows = [...journal].reverse().slice(0, 20);
  return createPortal(
    <section className="stocktake-field-journal" aria-label="Stocktake field journal">
      <header>
        <div><span>DEVICE SAFETY JOURNAL</span><h3>Every physical count is saved before cloud sync</h3></div>
        <div className="stocktake-journal-counts">
          <strong>{counts.total}</strong><small>device rows</small>
          <strong>{counts.synced}</strong><small>cloud saved</small>
          <strong>{unresolved}</strong><small>pending / review</small>
        </div>
      </header>

      {storageError ? <div className="stocktake-journal-fatal" role="alert">{storageError}</div> : null}
      {message ? <div className="stocktake-journal-message" aria-live="polite">{message}</div> : null}
      {unresolved > 0 ? <div className="stocktake-journal-warning"><strong>Do not final-post yet.</strong><span>{unresolved} row{unresolved === 1 ? '' : 's'} are safe on this phone but not fully confirmed in the cloud.</span></div> : null}

      <div className="stocktake-journal-actions">
        <button type="button" onClick={() => captureAndQueue(true)}>Save current count locally</button>
        <button type="button" disabled={syncing || counts.pending === 0} onClick={() => void processIds()}>{syncing ? 'Syncing…' : `Retry pending (${counts.pending})`}</button>
        <button type="button" disabled={!journal.length} onClick={exportCsv}>Export CSV</button>
        <button type="button" disabled={!journal.length} onClick={exportJson}>Backup JSON</button>
        <button type="button" disabled={!counts.posted} onClick={clearPosted}>Clear posted</button>
      </div>

      <p className="stocktake-journal-rule">The normal Add button is now local-first: it records the location, SKU, barcode, conversion, count and a durable retry key immediately, clears the form for the next item, then syncs in the background. Never clear browser data or switch browsers before exporting.</p>

      <div className="stocktake-journal-list">
        {visibleRows.map((entry) => (
          <article key={entry.id} className={`stocktake-journal-row status-${entry.status.toLowerCase()}`}>
            <div className="stocktake-journal-status"><strong>{statusLabel(entry.status)}</strong><small>{new Date(entry.createdAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</small></div>
            <div><strong>{entry.sku}</strong><span>{entry.baseLocation} · {entry.facing}</span><small>{entry.barcode || 'NO BARCODE'} · {entry.packagesObserved} × {entry.unitsPerPackage} = {entry.packagesObserved * entry.unitsPerPackage} units</small>{entry.error ? <em>{entry.error}</em> : null}</div>
            <div className="stocktake-journal-row-actions">
              {(entry.status === 'PENDING' || entry.status === 'NEEDS_REVIEW') && entry.barcode ? <button type="button" disabled={syncing} onClick={() => void processIds([entry.id])}>Retry sync</button> : null}
              {entry.status !== 'SYNCED' && entry.status !== 'POSTED' ? <button type="button" onClick={() => editEntry(entry)}>Edit</button> : null}
            </div>
          </article>
        ))}
        {!journal.length ? <div className="stocktake-journal-empty">No device rows yet. Start with a 3–5 SKU pilot and confirm that rows move from Device saved to Cloud saved before counting the full warehouse.</div> : null}
      </div>
      {journal.length > visibleRows.length ? <small className="stocktake-journal-more">Showing the latest {visibleRows.length} of {journal.length} device rows. CSV and JSON include every row.</small> : null}
    </section>,
    host,
  );
}
