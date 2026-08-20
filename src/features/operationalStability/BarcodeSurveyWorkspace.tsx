import { useEffect, useRef, useState, type FormEvent } from 'react';
import { WarehouseCameraScanner } from '@/WarehouseCameraScanner';
import {
  createBarcodeSurveyCommandId,
  getBarcodeSurveyDeviceId,
  getBarcodeSurveyPackagingEvidence,
  recordSmartBarcodeSurveyObservation,
  searchBarcodeSurveySkus,
  type BarcodeSurveyCaptureMode,
  type BarcodeSurveyObservedSleeveStatus,
  type BarcodeSurveyPackagingEvidence,
  type BarcodeSurveySkuSuggestion,
} from '@/data/repositories/barcodeSurvey';
import './barcodeSurveyCamera.css';

type SleeveChoice = BarcodeSurveyObservedSleeveStatus | '';
type CaptureChoice = BarcodeSurveyCaptureMode | '';

const CAMERA_SCAN_EVENT = 'ecoflow:warehouse-camera-scan';
const CARTON_INPUT_ID = 'barcode-survey-carton-input';
const SLEEVE_INPUT_ID = 'barcode-survey-sleeve-input';

function requestCameraScan(inputId: string) {
  window.dispatchEvent(new CustomEvent(CAMERA_SCAN_EVENT, { detail: { inputId } }));
}

function formatEvidenceTime(value: string | null) {
  if (!value) return 'time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'time unavailable';
  return date.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function BarcodeSurveyWorkspace() {
  const skuRef = useRef<HTMLInputElement>(null);
  const cartonRef = useRef<HTMLInputElement>(null);
  const sleeveRef = useRef<HTMLInputElement>(null);
  const searchSequence = useRef(0);
  const evidenceSequence = useRef(0);
  const [skuQuery, setSkuQuery] = useState('');
  const [selectedSku, setSelectedSku] = useState<BarcodeSurveySkuSuggestion | null>(null);
  const [skuSuggestions, setSkuSuggestions] = useState<BarcodeSurveySkuSuggestion[]>([]);
  const [skuSearching, setSkuSearching] = useState(false);
  const [skuSearchError, setSkuSearchError] = useState('');
  const [cartonBarcode, setCartonBarcode] = useState('');
  const [packagingEvidence, setPackagingEvidence] = useState<BarcodeSurveyPackagingEvidence | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceLookupError, setEvidenceLookupError] = useState('');
  const [captureMode, setCaptureMode] = useState<CaptureChoice>('');
  const [sleeveStatus, setSleeveStatus] = useState<SleeveChoice>('');
  const [sleeveBarcode, setSleeveBarcode] = useState('');
  const [note, setNote] = useState('');
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const query = skuQuery.trim();
    if (selectedSku && query.toLowerCase() === selectedSku.sku.toLowerCase()) {
      setSkuSuggestions([]);
      setSkuSearching(false);
      setSkuSearchError('');
      return;
    }
    if (!query) {
      setSkuSuggestions([]);
      setSkuSearching(false);
      setSkuSearchError('');
      return;
    }

    const sequence = ++searchSequence.current;
    setSkuSearching(true);
    setSkuSearchError('');
    const timer = window.setTimeout(() => {
      void searchBarcodeSurveySkus(query)
        .then((rows) => {
          if (searchSequence.current !== sequence) return;
          setSkuSuggestions(rows);
        })
        .catch((searchError) => {
          if (searchSequence.current !== sequence) return;
          setSkuSuggestions([]);
          setSkuSearchError(searchError instanceof Error ? searchError.message : String(searchError));
        })
        .finally(() => {
          if (searchSequence.current === sequence) setSkuSearching(false);
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [skuQuery, selectedSku]);

  useEffect(() => {
    const sku = selectedSku?.sku.trim() ?? '';
    const carton = cartonBarcode.trim();
    const sequence = ++evidenceSequence.current;

    setPackagingEvidence(null);
    setEvidenceLookupError('');
    setCaptureMode('');
    setSleeveStatus('');
    setSleeveBarcode('');

    if (!sku || !carton) {
      setEvidenceLoading(false);
      return;
    }

    setEvidenceLoading(true);
    const timer = window.setTimeout(() => {
      void getBarcodeSurveyPackagingEvidence(sku, carton)
        .then((evidence) => {
          if (evidenceSequence.current !== sequence) return;
          setPackagingEvidence(evidence);
          if (
            (evidence.status === 'VERIFIED_SCANNED' || evidence.status === 'VERIFIED_NO_SEPARATE_BARCODE')
            && evidence.sourceObservationId
          ) {
            setCaptureMode('REUSED_EXACT_PACKAGE');
          }
        })
        .catch((lookupError) => {
          if (evidenceSequence.current !== sequence) return;
          setPackagingEvidence(null);
          setEvidenceLookupError(lookupError instanceof Error ? lookupError.message : String(lookupError));
        })
        .finally(() => {
          if (evidenceSequence.current === sequence) setEvidenceLoading(false);
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [selectedSku?.sku, cartonBarcode]);

  function draftChanged() {
    setPendingCommandId(null);
    setMessage('');
    setError('');
  }

  function changeSkuQuery(value: string) {
    draftChanged();
    if (selectedSku && value.trim().toLowerCase() !== selectedSku.sku.toLowerCase()) setSelectedSku(null);
    setSkuQuery(value);
  }

  function chooseSku(suggestion: BarcodeSurveySkuSuggestion) {
    draftChanged();
    setSelectedSku(suggestion);
    setSkuQuery(suggestion.sku);
    setSkuSuggestions([]);
    setSkuSearchError('');
    setCartonBarcode('');
    setPackagingEvidence(null);
    setEvidenceLookupError('');
    setCaptureMode('');
    setSleeveStatus('');
    setSleeveBarcode('');
    window.setTimeout(() => cartonRef.current?.focus(), 0);
  }

  function changeCartonBarcode(value: string) {
    draftChanged();
    setCartonBarcode(value);
  }

  function chooseCheckNow() {
    draftChanged();
    setCaptureMode('OBSERVED_NOW');
    setSleeveStatus('');
    setSleeveBarcode('');
  }

  function chooseReuseEvidence() {
    if (!packagingEvidence?.sourceObservationId) return;
    if (packagingEvidence.status !== 'VERIFIED_SCANNED' && packagingEvidence.status !== 'VERIFIED_NO_SEPARATE_BARCODE') return;
    draftChanged();
    setCaptureMode('REUSED_EXACT_PACKAGE');
    setSleeveStatus('');
    setSleeveBarcode('');
  }

  function chooseDefer(next: 'DEFERRED_INACCESSIBLE' | 'DEFERRED_OPENING_REQUIRED') {
    draftChanged();
    setCaptureMode(next);
    setSleeveStatus('');
    setSleeveBarcode('');
  }

  function chooseSleeveStatus(next: BarcodeSurveyObservedSleeveStatus) {
    draftChanged();
    setSleeveStatus(next);
    if (next !== 'SCANNED') setSleeveBarcode('');
    if (next === 'SCANNED') window.setTimeout(() => sleeveRef.current?.focus(), 0);
  }

  function resetForNext() {
    setSkuQuery('');
    setSelectedSku(null);
    setSkuSuggestions([]);
    setSkuSearchError('');
    setCartonBarcode('');
    setPackagingEvidence(null);
    setEvidenceLoading(false);
    setEvidenceLookupError('');
    setCaptureMode('');
    setSleeveStatus('');
    setSleeveBarcode('');
    setNote('');
    setPendingCommandId(null);
    window.setTimeout(() => skuRef.current?.focus(), 0);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSku) {
      setError('Select an existing SKU from the suggestions before saving.');
      return;
    }
    if (!captureMode) {
      setError('Wait for the packaging evidence check, then choose how to handle this carton.');
      return;
    }
    if (captureMode === 'OBSERVED_NOW' && !sleeveStatus) {
      setError('Choose the physical sleeve result before saving.');
      return;
    }
    if (captureMode === 'REUSED_EXACT_PACKAGE' && !packagingEvidence?.sourceObservationId) {
      setError('Verified packaging evidence is missing its source observation. Check again or defer this carton.');
      return;
    }

    const commandId = pendingCommandId ?? createBarcodeSurveyCommandId();
    if (!pendingCommandId) setPendingCommandId(commandId);
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const result = await recordSmartBarcodeSurveyObservation({
        commandId,
        skuContext: selectedSku.sku,
        cartonBarcode,
        captureMode,
        sleeveStatus: captureMode === 'OBSERVED_NOW' ? sleeveStatus || null : null,
        sleeveBarcode: captureMode === 'OBSERVED_NOW' && sleeveStatus === 'SCANNED' ? sleeveBarcode : null,
        sourceObservationId: captureMode === 'REUSED_EXACT_PACKAGE' ? packagingEvidence?.sourceObservationId : null,
        note,
        deviceId: getBarcodeSurveyDeviceId(),
      });
      const savedLabel = result.evidenceSource === 'REUSED_EXACT_PACKAGE'
        ? 'Verified packaging evidence reused. Ready for next item.'
        : result.evidenceSource === 'DEFERRED_INACCESSIBLE'
          ? 'High-rack check deferred. Ready for next item.'
          : result.evidenceSource === 'DEFERRED_OPENING_REQUIRED'
            ? 'Opening-required check deferred. Ready for next item.'
            : 'Physical evidence saved. Ready for next item.';
      setMessage(result.replayed ? `Recovered previous save. ${savedLabel}` : savedLabel);
      resetForNext();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusy(false);
    }
  }

  const observedReady = captureMode === 'OBSERVED_NOW'
    && Boolean(sleeveStatus)
    && (sleeveStatus !== 'SCANNED' || Boolean(sleeveBarcode.trim()));
  const reusedReady = captureMode === 'REUSED_EXACT_PACKAGE'
    && Boolean(packagingEvidence?.sourceObservationId)
    && (packagingEvidence?.status === 'VERIFIED_SCANNED' || packagingEvidence?.status === 'VERIFIED_NO_SEPARATE_BARCODE');
  const deferredReady = captureMode === 'DEFERRED_INACCESSIBLE' || captureMode === 'DEFERRED_OPENING_REQUIRED';
  const canSubmit = Boolean(selectedSku && cartonBarcode.trim() && !evidenceLoading && (observedReady || reusedReady || deferredReady));
  const noSkuMatch = Boolean(skuQuery.trim() && !selectedSku && !skuSearching && !skuSearchError && skuSuggestions.length === 0);
  const showDecisionActions = Boolean(selectedSku && cartonBarcode.trim() && !evidenceLoading);

  return (
    <section className="native-control-card barcode-survey-card" aria-labelledby="barcode-survey-title">
      <WarehouseCameraScanner />

      <div>
        <p className="workspace-eyebrow">PHYSICAL EVIDENCE ONLY</p>
        <h2 id="barcode-survey-title">Barcode Survey</h2>
        <p>Choose an existing SKU, scan the carton, then let existing exact-package evidence decide whether opening is necessary. This does not change inventory, Commercial SKU mapping, or published Product Identity.</p>
      </div>

      <form onSubmit={(event) => void submit(event)}>
        <label>
          <span>1. Find existing SKU</span>
          <input
            ref={skuRef}
            autoFocus
            autoComplete="off"
            maxLength={128}
            name="skuSearch"
            value={skuQuery}
            onChange={(event) => changeSkuQuery(event.target.value)}
            placeholder="Type the first characters of the SKU"
            aria-autocomplete="list"
            aria-expanded={skuSuggestions.length > 0}
            aria-controls="barcode-survey-sku-suggestions"
          />
        </label>

        {skuSearching ? <div className="native-workspace-notice" role="status">Searching existing SKUs…</div> : null}
        {skuSearchError ? <div className="native-workspace-notice" role="alert">SKU lookup unavailable: {skuSearchError}</div> : null}
        {noSkuMatch ? <div className="native-workspace-notice" role="status">No existing SKU match. Keep typing or check the SKU code.</div> : null}

        {skuSuggestions.length > 0 ? (
          <div id="barcode-survey-sku-suggestions" role="listbox" aria-label="Existing SKU suggestions" className="native-workspace-notice">
            {skuSuggestions.map((suggestion) => (
              <button
                key={`${suggestion.sku}:${suggestion.productName ?? ''}`}
                type="button"
                role="option"
                aria-selected={selectedSku?.sku === suggestion.sku}
                onClick={() => chooseSku(suggestion)}
              >
                <strong>{suggestion.sku}</strong>
                {' — '}{suggestion.productName || 'Unnamed product'}
                {suggestion.category ? ` · ${suggestion.category}` : ''}
                {suggestion.fixedShelf ? ` · Shelf ${suggestion.fixedShelf}` : ''}
              </button>
            ))}
          </div>
        ) : null}

        {selectedSku ? (
          <div className="native-workspace-notice" role="status">
            Selected <strong>{selectedSku.sku}</strong> — {selectedSku.productName || 'Unnamed product'}
            {selectedSku.primaryBarcode ? ` · Existing barcode ${selectedSku.primaryBarcode} (read-only)` : ''}
          </div>
        ) : null}

        <div className="barcode-survey-scan-row">
          <label htmlFor={CARTON_INPUT_ID}>
            <span>2. Scan carton barcode</span>
            <input
              id={CARTON_INPUT_ID}
              ref={cartonRef}
              autoComplete="off"
              enterKeyHint="next"
              maxLength={128}
              name="cartonBarcode"
              value={cartonBarcode}
              onChange={(event) => changeCartonBarcode(event.target.value)}
              placeholder="Scan outer / carton barcode"
              required
            />
          </label>
          <button
            className="barcode-survey-camera-button"
            type="button"
            aria-label="Open camera to scan carton barcode"
            onClick={() => requestCameraScan(CARTON_INPUT_ID)}
          >
            Camera
          </button>
        </div>

        {evidenceLoading ? (
          <div className="native-workspace-notice" role="status">Checking exact SKU + carton packaging evidence…</div>
        ) : null}

        {packagingEvidence?.status === 'VERIFIED_SCANNED' ? (
          <div className="native-workspace-notice" role="status">
            <strong>Packaging already verified.</strong>{' '}
            Inner-pack barcode <strong>{packagingEvidence.sleeveBarcode}</strong>. Physically checked {formatEvidenceTime(packagingEvidence.sourceOccurredAt)}.
            {' '}Exact SKU + carton evidence only. <strong>No need to open this carton.</strong>
            <div className="row-actions barcode-survey-choices">
              <button
                className={captureMode === 'REUSED_EXACT_PACKAGE' ? 'primary-button' : ''}
                type="button"
                onClick={chooseReuseEvidence}
              >
                Use verified evidence
              </button>
              <button type="button" onClick={chooseCheckNow}>Check again</button>
            </div>
          </div>
        ) : null}

        {packagingEvidence?.status === 'VERIFIED_NO_SEPARATE_BARCODE' ? (
          <div className="native-workspace-notice" role="status">
            <strong>Packaging already verified: no separate inner-pack barcode.</strong>{' '}
            Physically checked {formatEvidenceTime(packagingEvidence.sourceOccurredAt)}. Exact SKU + carton evidence only. <strong>No need to open this carton.</strong>
            <div className="row-actions barcode-survey-choices">
              <button
                className={captureMode === 'REUSED_EXACT_PACKAGE' ? 'primary-button' : ''}
                type="button"
                onClick={chooseReuseEvidence}
              >
                Use verified evidence
              </button>
              <button type="button" onClick={chooseCheckNow}>Check again</button>
            </div>
          </div>
        ) : null}

        {packagingEvidence?.status === 'UNVERIFIED' ? (
          <div className="native-workspace-notice" role="status">
            <strong>New / unverified packaging.</strong> Only check the inner pack when it is safe and convenient.
            <div className="row-actions barcode-survey-choices">
              <button className={captureMode === 'OBSERVED_NOW' ? 'primary-button' : ''} type="button" onClick={chooseCheckNow}>Check now</button>
              <button className={captureMode === 'DEFERRED_INACCESSIBLE' ? 'primary-button' : ''} type="button" onClick={() => chooseDefer('DEFERRED_INACCESSIBLE')}>Defer — high rack / inaccessible</button>
              <button className={captureMode === 'DEFERRED_OPENING_REQUIRED' ? 'primary-button' : ''} type="button" onClick={() => chooseDefer('DEFERRED_OPENING_REQUIRED')}>Cannot check without opening stock</button>
            </div>
          </div>
        ) : null}

        {packagingEvidence?.status === 'CONFLICT' ? (
          <div className="native-workspace-notice" role="alert">
            <strong>Conflicting physical evidence.</strong> Existing observations disagree for this exact SKU + carton barcode, so history will not be reused. Recheck when accessible; never guess or use “latest wins”.
            <div className="row-actions barcode-survey-choices">
              <button className={captureMode === 'OBSERVED_NOW' ? 'primary-button' : ''} type="button" onClick={chooseCheckNow}>Check now</button>
              <button className={captureMode === 'DEFERRED_INACCESSIBLE' ? 'primary-button' : ''} type="button" onClick={() => chooseDefer('DEFERRED_INACCESSIBLE')}>Defer — high rack / inaccessible</button>
              <button className={captureMode === 'DEFERRED_OPENING_REQUIRED' ? 'primary-button' : ''} type="button" onClick={() => chooseDefer('DEFERRED_OPENING_REQUIRED')}>Cannot check without opening stock</button>
            </div>
          </div>
        ) : null}

        {evidenceLookupError && showDecisionActions ? (
          <div className="native-workspace-notice" role="alert">
            <strong>Packaging history unavailable.</strong> History will not be reused: {evidenceLookupError}. You can physically check now or defer safely.
            <div className="row-actions barcode-survey-choices">
              <button className={captureMode === 'OBSERVED_NOW' ? 'primary-button' : ''} type="button" onClick={chooseCheckNow}>Check now</button>
              <button className={captureMode === 'DEFERRED_INACCESSIBLE' ? 'primary-button' : ''} type="button" onClick={() => chooseDefer('DEFERRED_INACCESSIBLE')}>Defer — high rack / inaccessible</button>
              <button className={captureMode === 'DEFERRED_OPENING_REQUIRED' ? 'primary-button' : ''} type="button" onClick={() => chooseDefer('DEFERRED_OPENING_REQUIRED')}>Cannot check without opening stock</button>
            </div>
          </div>
        ) : null}

        {captureMode === 'OBSERVED_NOW' ? (
          <fieldset>
            <legend>3. Check now: sleeve barcode?</legend>
            <div className="row-actions barcode-survey-choices">
              <button className={sleeveStatus === 'SCANNED' ? 'primary-button' : ''} type="button" onClick={() => chooseSleeveStatus('SCANNED')}>Scan sleeve</button>
              <button className={sleeveStatus === 'NO_SEPARATE_BARCODE' ? 'primary-button' : ''} type="button" onClick={() => chooseSleeveStatus('NO_SEPARATE_BARCODE')}>No separate barcode</button>
            </div>
          </fieldset>
        ) : null}

        {captureMode === 'OBSERVED_NOW' && sleeveStatus === 'SCANNED' ? (
          <div className="barcode-survey-scan-row">
            <label htmlFor={SLEEVE_INPUT_ID}>
              <span>Scan sleeve barcode</span>
              <input
                id={SLEEVE_INPUT_ID}
                ref={sleeveRef}
                autoComplete="off"
                maxLength={128}
                name="sleeveBarcode"
                value={sleeveBarcode}
                onChange={(event) => { draftChanged(); setSleeveBarcode(event.target.value); }}
                placeholder="Scan the distinct sleeve barcode"
                required
              />
            </label>
            <button
              className="barcode-survey-camera-button"
              type="button"
              aria-label="Open camera to scan sleeve barcode"
              onClick={() => requestCameraScan(SLEEVE_INPUT_ID)}
            >
              Camera
            </button>
          </div>
        ) : null}

        {captureMode === 'DEFERRED_INACCESSIBLE' ? (
          <div className="native-workspace-notice" role="status"><strong>Deferred safely:</strong> high rack / inaccessible. Not checked is recorded as a defer reason, not as verified packaging evidence.</div>
        ) : null}

        {captureMode === 'DEFERRED_OPENING_REQUIRED' ? (
          <div className="native-workspace-notice" role="status"><strong>Deferred safely:</strong> checking would require opening stock. Not checked is recorded as a defer reason, not as verified packaging evidence.</div>
        ) : null}

        <label>
          <span>Note <small>(optional)</small></span>
          <input
            autoComplete="off"
            maxLength={2000}
            name="note"
            value={note}
            onChange={(event) => { draftChanged(); setNote(event.target.value); }}
            placeholder="Only if something needs follow-up"
          />
        </label>

        {error ? <div className="native-workspace-notice" role="alert">{error}</div> : null}
        {message ? <div className="native-workspace-notice" role="status">{message}</div> : null}

        <button className="primary-button" type="submit" disabled={busy || !canSubmit}>
          {busy ? 'Saving…' : 'Save & Next'}
        </button>
      </form>
    </section>
  );
}
