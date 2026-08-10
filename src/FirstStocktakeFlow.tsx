import { useEffect, useMemo, useRef, useState } from 'react';
import {
  recordBarcodeScan,
  startBarcodeScanSession,
  type BarcodePackageLevel,
} from '@/data/repositories/inventoryControl';
import {
  operationalBarcodeFailureMessage,
  resolveOperationalBarcode,
} from '@/data/repositories/productIdentityBarcodeResolution';
import {
  finishStagedReceivingBatch,
  loadOpenStagedReceivingBatches,
  loadStagedReceivingLines,
  setReceivingLineTick,
  stageReceivingScan,
  startStagedReceivingBatch,
  type StagedReceivingBatch,
  type StagedReceivingLine,
} from '@/data/repositories/stagedReceiving';
import { loadStocktakeSkuOptions, type StocktakeSkuOption } from '@/data/repositories/stocktakeAssist';
import { loadWarehouseLocationItems, type WarehouseLocationItemRow } from '@/data/repositories/warehouseLocations';

const SESSION_KEY = 'ecoflow:first-stocktake-session';
const BATCH_KEY = 'ecoflow:first-stocktake-batch';
const COVERAGE_KEY_PREFIX = 'ecoflow:first-stocktake-coverage:';
const CAMERA_SCAN_EVENT = 'ecoflow:warehouse-camera-scan';
const BARCODE_INPUT_ID = 'first-stocktake-package-barcode';

type WarehouseFacing = 'left' | 'right' | 'front';

type PendingLine = {
  fingerprint: string;
  idempotencyKey: string;
  clientScannedAt: string;
};

type LocationOption = {
  baseCode: string;
  storageCode: string;
  side: WarehouseFacing;
};

type LocationChoice = {
  baseCode: string;
  options: LocationOption[];
};

type MissingSkuReview = StocktakeSkuOption & {
  liveQuantity: number;
  liveLocations: string[];
};

const facingLabel: Record<WarehouseFacing, string> = {
  left: 'Left-facing view',
  right: 'Right-facing view',
  front: 'Front-facing view',
};

function n(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function canonicalPackageLevel(value: string | null): BarcodePackageLevel {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'CARTON' || normalized === 'SLEEVE' || normalized === 'EACH' || normalized === 'INNER') return normalized;
  return 'UNKNOWN';
}

function locationCompact(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function canonicalTypedLocation(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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

function initialLocation() {
  const value = new URLSearchParams(window.location.search).get('location') || '';
  const upper = canonicalTypedLocation(value);
  if (/-L-/.test(upper)) return upper.replace(/-L-/, '-');
  if (/-R-/.test(upper)) return upper.replace(/-R-/, '-');
  return upper;
}

function initialFacing(): WarehouseFacing {
  const value = canonicalTypedLocation(new URLSearchParams(window.location.search).get('location') || '');
  if (/-R-/.test(value)) return 'right';
  if (/-L-/.test(value)) return 'left';
  return 'left';
}

function coverageKey(batchId: string) {
  return `${COVERAGE_KEY_PREFIX}${batchId}`;
}

function levenshtein(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function scoreLocation(input: string, baseCode: string) {
  const needle = locationCompact(input);
  const target = locationCompact(baseCode);
  if (!needle) return Number.POSITIVE_INFINITY;
  if (needle === target) return 0;
  if (target.startsWith(needle)) return 10 + (target.length - needle.length);
  if (target.includes(needle)) return 30 + target.indexOf(needle);
  return 100 + levenshtein(needle, target) * 10 + Math.abs(target.length - needle.length);
}

function buildLocationChoices(rows: WarehouseLocationItemRow[]) {
  const deduped = new Map<string, LocationOption>();
  rows
    .filter((row) => row.location_status === 'ACTIVE')
    .forEach((row) => {
      const side = row.side as WarehouseFacing;
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
    const current = grouped.get(option.baseCode) ?? [];
    current.push(option);
    grouped.set(option.baseCode, current);
  });

  return Array.from(grouped.entries())
    .map(([baseCode, options]) => ({
      baseCode,
      options: options.sort((left, right) => ['left', 'right', 'front'].indexOf(left.side) - ['left', 'right', 'front'].indexOf(right.side)),
    }))
    .sort((left, right) => left.baseCode.localeCompare(right.baseCode, undefined, { numeric: true }));
}

function resolveLocationChoice(value: string, choices: LocationChoice[]) {
  const needle = locationCompact(value);
  if (!needle) return null;
  return choices.find((choice) => locationCompact(choice.baseCode) === needle) ?? null;
}

function canonicalSku(value: string, options: StocktakeSkuOption[]) {
  const trimmed = value.trim().toUpperCase();
  const compact = locationCompact(trimmed);
  const exact = options.find((option) => option.sku.toUpperCase() === trimmed)
    ?? options.find((option) => locationCompact(option.sku) === compact);
  return exact?.sku || trimmed;
}

export function FirstStocktakeFlow() {
  const [location, setLocation] = useState(initialLocation);
  const [facing, setFacing] = useState<WarehouseFacing>(initialFacing);
  const [locationRows, setLocationRows] = useState<WarehouseLocationItemRow[]>([]);
  const [locationAssistError, setLocationAssistError] = useState('');
  const [locationFocused, setLocationFocused] = useState(false);
  const [sku, setSku] = useState('');
  const [skuOptions, setSkuOptions] = useState<StocktakeSkuOption[]>([]);
  const [skuAssistError, setSkuAssistError] = useState('');
  const [skuFocused, setSkuFocused] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [packagesObserved, setPackagesObserved] = useState('1');
  const [note, setNote] = useState('');
  const [batch, setBatch] = useState<StagedReceivingBatch | null>(null);
  const [openBatches, setOpenBatches] = useState<StagedReceivingBatch[]>([]);
  const [lines, setLines] = useState<StagedReceivingLine[]>([]);
  const [coverageAcknowledged, setCoverageAcknowledged] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const barcodeRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef<PendingLine | null>(null);

  const locationChoices = useMemo(() => buildLocationChoices(locationRows), [locationRows]);
  const resolvedLocation = useMemo(() => resolveLocationChoice(location, locationChoices), [location, locationChoices]);
  const availableFacings = useMemo<WarehouseFacing[]>(() => {
    if (!resolvedLocation) return ['left', 'right'];
    return Array.from(new Set(resolvedLocation.options.map((option) => option.side)));
  }, [resolvedLocation]);
  const locationSuggestions = useMemo(() => {
    if (!locationFocused || location.trim().length < 2 || resolvedLocation) return [];
    return locationChoices
      .map((choice) => ({ choice, score: scoreLocation(location, choice.baseCode) }))
      .filter((item) => item.score < 160)
      .sort((left, right) => left.score - right.score || left.choice.baseCode.localeCompare(right.choice.baseCode, undefined, { numeric: true }))
      .slice(0, 6)
      .map((item) => item.choice);
  }, [location, locationChoices, locationFocused, resolvedLocation]);
  const skuSuggestions = useMemo(() => {
    const needle = sku.trim().toUpperCase();
    if (!skuFocused || !needle) return [];
    return skuOptions
      .filter((option) => option.sku.toUpperCase().includes(needle) || (option.productName || '').toUpperCase().includes(needle))
      .sort((left, right) => {
        const leftStarts = left.sku.toUpperCase().startsWith(needle) ? 0 : 1;
        const rightStarts = right.sku.toUpperCase().startsWith(needle) ? 0 : 1;
        return leftStarts - rightStarts || right.orderCount - left.orderCount || left.sku.localeCompare(right.sku);
      })
      .slice(0, 8);
  }, [sku, skuFocused, skuOptions]);

  async function reload(preferredBatchId?: string | null) {
    const batches = await loadOpenStagedReceivingBatches();
    setOpenBatches(batches);
    const stored = preferredBatchId === undefined ? window.localStorage.getItem(BATCH_KEY) : preferredBatchId;
    const active = stored ? batches.find((row) => row.id === stored) ?? null : null;
    if (!active && stored) window.localStorage.removeItem(BATCH_KEY);
    setBatch(active);
    setLines(active ? await loadStagedReceivingLines(active.id) : []);
  }

  useEffect(() => {
    void reload().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    void loadWarehouseLocationItems()
      .then((rows) => {
        setLocationRows(rows);
        setLocationAssistError('');
      })
      .catch((reason) => setLocationAssistError(reason instanceof Error ? reason.message : String(reason)));
    void loadStocktakeSkuOptions()
      .then((rows) => {
        setSkuOptions(rows);
        setSkuAssistError('');
      })
      .catch((reason) => setSkuAssistError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  useEffect(() => {
    if (!batch?.id) {
      setCoverageAcknowledged(false);
      return;
    }
    setCoverageAcknowledged(window.localStorage.getItem(coverageKey(batch.id)) === 'true');
  }, [batch?.id]);

  useEffect(() => {
    if (!resolvedLocation) return;
    if (availableFacings.includes(facing)) return;
    setFacing(availableFacings[0] ?? 'front');
  }, [availableFacings, facing, resolvedLocation]);

  async function ensureSession(targetLocation: string) {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const rows = await startBarcodeScanSession({
      sessionName: `First stocktake ${new Date().toLocaleDateString('en-AU')}`,
      targetArea: targetLocation || 'Warehouse',
    });
    const id = rows[0]?.session_id;
    if (!id) throw new Error('Could not start the first-stocktake scan session.');
    window.localStorage.setItem(SESSION_KEY, id);
    return id;
  }

  async function ensureBatch() {
    if (batch?.id) return batch.id;
    if (openBatches.length > 0) {
      const proceed = window.confirm('Another receiving batch is already open. Start a separate first-stocktake batch so the two jobs remain auditable?');
      if (!proceed) throw new Error('First stocktake was not started. Finish or cancel the existing receiving batch first.');
    }
    const rows = await startStagedReceivingBatch();
    const first = rows[0];
    if (!first?.batch_id) throw new Error('Could not start the controlled first-stocktake batch.');
    window.localStorage.setItem(BATCH_KEY, first.batch_id);
    await reload(first.batch_id);
    return first.batch_id;
  }

  function openBarcodeCamera() {
    barcodeRef.current?.focus();
    window.dispatchEvent(new CustomEvent(CAMERA_SCAN_EVENT, { detail: { inputId: BARCODE_INPUT_ID } }));
  }

  function chooseLocation(choice: LocationChoice) {
    setLocation(choice.baseCode);
    const sides = choice.options.map((option) => option.side);
    if (!sides.includes(facing)) setFacing(sides[0] ?? 'front');
    setLocationFocused(false);
    setError('');
  }

  function setCoverageConfirmation(next: boolean) {
    setCoverageAcknowledged(next);
    if (!batch?.id) return;
    if (next) window.localStorage.setItem(coverageKey(batch.id), 'true');
    else window.localStorage.removeItem(coverageKey(batch.id));
  }

  async function addStocktakeLine() {
    const typedLocation = canonicalTypedLocation(location);
    const choice = resolveLocationChoice(typedLocation, locationChoices);
    if (!typedLocation) { setError('Step 1: enter or scan a warehouse location.'); return; }
    if (locationChoices.length > 0 && !choice) { setError('Step 1: choose the matching warehouse location shown below the field.'); return; }

    const selectedLocation = choice?.options.find((option) => option.side === facing)
      ?? choice?.options[0]
      ?? null;
    if (choice && !selectedLocation) { setError('Step 1: choose the correct left-facing or right-facing view.'); return; }

    const cleanBaseLocation = choice?.baseCode || typedLocation;
    const storageLocation = selectedLocation?.storageCode || storageLocationFallback(cleanBaseLocation, facing);
    const selectedFacing = selectedLocation?.side || facing;
    const cleanSku = canonicalSku(sku, skuOptions);
    const cleanBarcode = barcode.trim();
    const packages = Number(packagesObserved);
    if (!cleanSku) { setError('Step 2: enter the Ordermentum SKU / item code.'); return; }
    if (!cleanBarcode) { setError('Step 3: scan the published package barcode.'); return; }
    if (!Number.isInteger(packages) || packages <= 0) { setError('Packages counted must be a whole number greater than zero.'); return; }

    setBusy('add');
    setError('');
    setNotice('');
    try {
      const identity = await resolveOperationalBarcode(cleanBarcode, cleanSku);
      if (identity.resolutionStatus !== 'RESOLVED') throw new Error(operationalBarcodeFailureMessage(identity));
      const packageLevel = canonicalPackageLevel(identity.packageLevel);
      const units = Number(identity.unitsInBaseUnit);
      if (packageLevel === 'UNKNOWN' || !Number.isFinite(units) || units <= 0) {
        throw new Error('Published Product Identity is missing a valid package conversion. Resolve it before stocktake.');
      }

      setLocation(cleanBaseLocation);
      setFacing(selectedFacing);
      setSku(cleanSku);
      const [sessionId, batchId] = await Promise.all([ensureSession(storageLocation), ensureBatch()]);
      const facingNote = `FACING ${selectedFacing.toUpperCase()}`;
      await recordBarcodeScan({
        sessionId,
        sku: cleanSku,
        barcode: cleanBarcode,
        packageLevel,
        unitsPerBarcode: units,
        shelf: storageLocation,
        qtyObserved: packages,
        actionMode: 'MAP_AND_COUNT',
        note: note || `First stocktake canonical count observation · ${facingNote}`,
      });

      const fingerprint = JSON.stringify([batchId, storageLocation, selectedFacing, cleanSku, cleanBarcode, packageLevel, units, packages, note.trim()]);
      const pending = pendingRef.current?.fingerprint === fingerprint
        ? pendingRef.current
        : { fingerprint, idempotencyKey: crypto.randomUUID(), clientScannedAt: new Date().toISOString() };
      pendingRef.current = pending;

      await stageReceivingScan({
        batchId,
        barcode: cleanBarcode,
        qtyPackages: packages,
        targetLocation: storageLocation,
        note: `FIRST STOCKTAKE · ${cleanSku} · ${packageLevel} · ${units} units/package · ${facingNote}${note ? ` · ${note}` : ''}`,
        idempotencyKey: pending.idempotencyKey,
        clientScannedAt: pending.clientScannedAt,
      });
      pendingRef.current = null;
      window.localStorage.removeItem(coverageKey(batchId));
      setCoverageAcknowledged(false);
      setNotice(`${cleanSku} · ${packageLevel} × ${units} units validated by Product Identity and counted at ${cleanBaseLocation} · ${facingLabel[selectedFacing]}.`);
      setSku('');
      setBarcode('');
      setPackagesObserved('1');
      setNote('');
      await reload(batchId);
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : String(reason)} · The same retry key is retained, so retrying will not duplicate the stocktake line.`);
    } finally {
      setBusy('');
    }
  }

  async function toggleLine(line: StagedReceivingLine) {
    setBusy(line.id);
    setError('');
    try {
      await setReceivingLineTick({ lineId: line.id, ticked: !line.confirmation_checked });
      await reload(line.batch_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  async function postOpeningStock() {
    if (!batch?.id) return;
    if (!coverageAcknowledged) {
      setError('Review SKU coverage and confirm that every physical location has been checked before posting opening stock.');
      return;
    }
    setBusy('post');
    setError('');
    setNotice('');
    try {
      const result = await finishStagedReceivingBatch({ batchId: batch.id, note: 'FIRST STOCKTAKE · verified opening stock · physical coverage confirmed' });
      const first = result[0];
      window.localStorage.removeItem(BATCH_KEY);
      window.localStorage.removeItem(SESSION_KEY);
      window.localStorage.removeItem(coverageKey(batch.id));
      setCoverageAcknowledged(false);
      setBatch(null);
      setLines([]);
      setNotice(`First stocktake posted once: ${n(first?.posted_lines)} SKU lines and ${n(first?.posted_units)} units are now in the stock ledger and warehouse locations.`);
      await reload(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  const checked = lines.filter((line) => line.confirmation_checked || line.line_status === 'POSTED').length;
  const allChecked = lines.length > 0 && checked === lines.length;
  const totalUnits = useMemo(() => lines.reduce((sum, line) => sum + n(line.units_received), 0), [lines]);
  const countedSkus = useMemo(() => new Set(lines.map((line) => String(line.sku || '').trim().toUpperCase()).filter(Boolean)), [lines]);
  const liveStockBySku = useMemo(() => {
    const map = new Map<string, { quantity: number; locations: Set<string> }>();
    locationRows.forEach((row) => {
      const code = String(row.sku || '').trim().toUpperCase();
      const quantity = n(row.quantity);
      if (!code || quantity <= 0) return;
      const current = map.get(code) ?? { quantity: 0, locations: new Set<string>() };
      current.quantity += quantity;
      if (row.location_code) current.locations.add(row.location_code);
      map.set(code, current);
    });
    return map;
  }, [locationRows]);
  const missingSkuReview = useMemo<MissingSkuReview[]>(() => skuOptions
    .filter((option) => !countedSkus.has(option.sku.trim().toUpperCase()))
    .map((option) => {
      const live = liveStockBySku.get(option.sku.trim().toUpperCase());
      return {
        ...option,
        liveQuantity: live?.quantity ?? 0,
        liveLocations: Array.from(live?.locations ?? []),
      };
    })
    .sort((left, right) => Number(right.liveQuantity > 0) - Number(left.liveQuantity > 0)
      || right.orderCount - left.orderCount
      || left.sku.localeCompare(right.sku, undefined, { numeric: true })), [countedSkus, liveStockBySku, skuOptions]);
  const missingLive = missingSkuReview.filter((option) => option.liveQuantity > 0);
  const missingWithOrders = missingSkuReview.filter((option) => option.liveQuantity <= 0 && option.orderCount > 0);
  const catalogOnlyMissing = missingSkuReview.filter((option) => option.liveQuantity <= 0 && option.orderCount <= 0);
  const priorityMissing = [...missingLive, ...missingWithOrders].slice(0, 18);

  return (
    <section className="first-stocktake-screen">
      <header className="first-stocktake-hero">
        <div>
          <span>FIELD READINESS · CURRENT TASK</span>
          <h2>First stocktake</h2>
          <p>Work one physical location at a time. Product Identity owns barcode and package conversion facts; Stocktake records only the observed package count. Stock changes only after the final review.</p>
        </div>
        <div className="first-stocktake-hero-actions">
          <a href="/warehouse-map">Open warehouse map</a>
          <a href="/commissioning/product-identity">Product Identity</a>
          <button type="button" onClick={() => void reload(batch?.id)} disabled={Boolean(busy)}>Refresh</button>
        </div>
      </header>

      <ol className="first-stocktake-steps">
        <li className={location ? 'done' : 'active'}><b>1</b><span><strong>Location</strong><small>Choose the physical cell</small></span></li>
        <li className={sku ? 'done' : location ? 'active' : ''}><b>2</b><span><strong>SKU</strong><small>Use the Ordermentum item code</small></span></li>
        <li className={barcode ? 'done' : sku ? 'active' : ''}><b>3</b><span><strong>Package</strong><small>Scan a published Product Identity barcode</small></span></li>
        <li className={barcode ? 'active' : ''}><b>4</b><span><strong>Count</strong><small>Add packages to the review batch</small></span></li>
      </ol>

      {error ? <div className="first-stocktake-error">{error}</div> : null}
      {notice ? <div className="first-stocktake-notice">{notice}</div> : null}

      <section className="first-stocktake-entry">
        <div className="first-stocktake-assist-field first-stocktake-location">
          <label htmlFor="first-stocktake-location"><span>1 · Warehouse location</span></label>
          <input
            id="first-stocktake-location"
            value={location}
            onChange={(event) => setLocation(event.target.value.toUpperCase())}
            onFocus={() => setLocationFocused(true)}
            onBlur={() => window.setTimeout(() => setLocationFocused(false), 140)}
            placeholder="Example A3-01-03A"
            autoCapitalize="characters"
            autoComplete="off"
          />
          {resolvedLocation ? <small className="first-stocktake-match-confirmed">Matched {resolvedLocation.baseCode}</small> : null}
          {locationSuggestions.length ? (
            <div className="first-stocktake-suggestions" role="listbox" aria-label="Matching warehouse locations">
              {locationSuggestions.map((choice) => (
                <button key={choice.baseCode} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => chooseLocation(choice)}>
                  <strong>{choice.baseCode}</strong>
                  <small>{choice.options.map((option) => facingLabel[option.side]).join(' · ')}</small>
                </button>
              ))}
            </div>
          ) : null}
          {locationAssistError ? <small className="first-stocktake-assist-warning">Location assistance unavailable: manual entry still works.</small> : null}
        </div>

        <div className="first-stocktake-facing-block">
          <span>Facing view</span>
          <div className="first-stocktake-facing-options" role="group" aria-label="Warehouse facing view">
            {availableFacings.map((side) => (
              <button key={side} className={facing === side ? 'active' : ''} type="button" onClick={() => setFacing(side)}>
                {facingLabel[side]}
              </button>
            ))}
          </div>
          <small>{availableFacings.includes('front') ? 'This rack is single-sided.' : 'Choose the side you are looking at. The printed location code remains unchanged.'}</small>
        </div>

        <div className="first-stocktake-assist-field">
          <label htmlFor="first-stocktake-sku"><span>2 · SKU / item code</span></label>
          <input
            id="first-stocktake-sku"
            value={sku}
            onChange={(event) => setSku(event.target.value.toUpperCase())}
            onFocus={() => setSkuFocused(true)}
            onBlur={() => window.setTimeout(() => setSkuFocused(false), 140)}
            placeholder="Type a few SKU letters"
            autoCapitalize="characters"
            autoComplete="off"
          />
          {skuSuggestions.length ? (
            <div className="first-stocktake-suggestions first-stocktake-sku-suggestions" role="listbox" aria-label="Matching Ordermentum SKUs">
              {skuSuggestions.map((option) => (
                <button key={option.sku} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setSku(option.sku); setSkuFocused(false); window.setTimeout(() => barcodeRef.current?.focus(), 0); }}>
                  <strong>{option.sku}</strong>
                  <small>{option.productName || 'Ordermentum SKU'}{option.orderCount ? ` · ${option.orderCount} orders` : ''}</small>
                </button>
              ))}
            </div>
          ) : null}
          {skuAssistError ? <small className="first-stocktake-assist-warning">SKU suggestions unavailable: the code can still be entered manually.</small> : null}
        </div>

        <div className="first-stocktake-assist-field">
          <label htmlFor={BARCODE_INPUT_ID}><span>3 · Published package barcode</span></label>
          <div className="first-stocktake-barcode-control">
            <input
              id={BARCODE_INPUT_ID}
              ref={barcodeRef}
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void addStocktakeLine(); }}
              placeholder="Scan carton / sleeve barcode"
              autoComplete="off"
            />
            <button type="button" onClick={openBarcodeCamera} aria-label="Open camera to scan package barcode">Scan</button>
          </div>
          <small>Package level and units-per-package come from published Product Identity. Stocktake cannot create or edit those facts.</small>
        </div>

        <div className="first-stocktake-count-row">
          <label><span>4 · Packages counted</span><input type="number" min="1" step="1" inputMode="numeric" value={packagesObserved} onChange={(event) => setPackagesObserved(event.target.value)} /></label>
        </div>
        <label><span>Optional note</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Damaged cartons, mixed packaging, count note" /></label>
        <button className="first-stocktake-primary" type="button" disabled={Boolean(busy)} onClick={() => void addStocktakeLine()}>{busy === 'add' ? 'Validating and adding…' : 'Validate barcode and add count'}</button>
        <small className="first-stocktake-safety">The warehouse location and facing remain selected after each add. The published barcode is validated first; this button stages one idempotent count line and stock changes only after final verification.</small>
      </section>

      <section className="first-stocktake-review">
        <header>
          <div><span>CONTROLLED BATCH</span><h3>{batch?.batch_no || 'No first-stocktake batch yet'}</h3></div>
          <strong>{checked}/{lines.length} verified · {totalUnits} units</strong>
        </header>
        <div className="first-stocktake-lines">
          {lines.map((line) => (
            <button key={line.id} type="button" className={line.confirmation_checked ? 'checked' : ''} disabled={Boolean(busy)} onClick={() => void toggleLine(line)}>
              <span className="first-stocktake-check">{line.confirmation_checked ? '✓' : ''}</span>
              <span><strong>{line.sku || 'Unknown SKU'}</strong><small>{line.product_name || line.barcode} · {line.suggested_location || location}</small></span>
              <span><b>{n(line.qty_packages)}</b><small>{line.package_level || 'packages'}</small></span>
              <span><b>{n(line.units_received)}</b><small>units</small></span>
            </button>
          ))}
          {!lines.length ? <div className="first-stocktake-empty">Start with one rack and one SKU. Added lines remain saved if the phone closes or loses connection.</div> : null}
        </div>

        <section className="first-stocktake-coverage-review">
          <header>
            <div><span>SKU COVERAGE REVIEW</span><h4>Check what the system knows but the warehouse count did not find</h4></div>
            <strong>{countedSkus.size} unique SKUs counted</strong>
          </header>
          <div className="first-stocktake-coverage-metrics">
            <div className="good"><strong>{countedSkus.size}</strong><span>counted</span></div>
            <div className={missingLive.length ? 'danger' : 'good'}><strong>{missingLive.length}</strong><span>system stock not found</span></div>
            <div className={missingWithOrders.length ? 'warn' : 'good'}><strong>{missingWithOrders.length}</strong><span>ordered SKU not found</span></div>
            <div><strong>{catalogOnlyMissing.length}</strong><span>catalog only / possibly old</span></div>
          </div>
          <div className="first-stocktake-coverage-rule">
            <strong>Missing does not mean zero or retired.</strong>
            <span>EcoFlow posts only the lines physically counted above. An uncounted SKU is not automatically zeroed, deleted or marked inactive. Use this list for a second warehouse sweep; old catalog SKUs may remain uncounted.</span>
          </div>
          {priorityMissing.length ? (
            <div className="first-stocktake-missing-list">
              {priorityMissing.map((option) => (
                <article key={option.sku} className={option.liveQuantity > 0 ? 'danger' : 'warn'}>
                  <div><strong>{option.sku}</strong><span>{option.productName || 'Product name unavailable'}</span></div>
                  <div><strong>{option.liveQuantity > 0 ? `${option.liveQuantity} system units` : `${option.orderCount} order references`}</strong><span>{option.liveQuantity > 0 ? option.liveLocations.join(', ') || 'location pending' : 'check whether this SKU is still stocked'}</span></div>
                </article>
              ))}
              {missingLive.length + missingWithOrders.length > priorityMissing.length ? <small>Showing the first {priorityMissing.length} priority SKUs. Search the SKU field above to count any item found during the second sweep.</small> : null}
            </div>
          ) : lines.length ? <div className="first-stocktake-coverage-clear">No positive-stock or previously ordered catalog SKU remains unmatched in the loaded system data.</div> : null}
          {skuAssistError ? <div className="first-stocktake-coverage-warning">Catalog comparison is unavailable: {skuAssistError}. Physical-location confirmation is still required.</div> : null}
          <label className="first-stocktake-coverage-confirm">
            <input type="checkbox" checked={coverageAcknowledged} disabled={!lines.length || Boolean(busy)} onChange={(event) => setCoverageConfirmation(event.target.checked)} />
            <span><strong>I have checked every physical warehouse location.</strong><small>I understand that catalog SKUs not counted today will remain unchanged and are not being declared zero.</small></span>
          </label>
        </section>

        <button className="first-stocktake-post" type="button" disabled={!allChecked || !coverageAcknowledged || Boolean(busy)} onClick={() => void postOpeningStock()}>{busy === 'post' ? 'Posting once…' : 'Post verified opening stock'}</button>
        <p>Posting requires every counted line to be checked and the physical-location coverage declaration above. The transaction writes only counted lines to the stock ledger and warehouse locations.</p>
      </section>
    </section>
  );
}