import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createBarcodeSurveyCommandId,
  getBarcodeSurveyDeviceId,
  recordBarcodeSurveyObservation,
  searchBarcodeSurveySkus,
  type BarcodeSurveySkuSuggestion,
  type BarcodeSurveySleeveStatus,
} from '@/data/repositories/barcodeSurvey';

type SleeveChoice = BarcodeSurveySleeveStatus | '';

export function BarcodeSurveyWorkspace() {
  const skuRef = useRef<HTMLInputElement>(null);
  const cartonRef = useRef<HTMLInputElement>(null);
  const sleeveRef = useRef<HTMLInputElement>(null);
  const searchSequence = useRef(0);
  const [skuQuery, setSkuQuery] = useState('');
  const [selectedSku, setSelectedSku] = useState<BarcodeSurveySkuSuggestion | null>(null);
  const [skuSuggestions, setSkuSuggestions] = useState<BarcodeSurveySkuSuggestion[]>([]);
  const [skuSearching, setSkuSearching] = useState(false);
  const [skuSearchError, setSkuSearchError] = useState('');
  const [cartonBarcode, setCartonBarcode] = useState('');
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
    window.setTimeout(() => cartonRef.current?.focus(), 0);
  }

  function chooseSleeveStatus(next: BarcodeSurveySleeveStatus) {
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
    if (!sleeveStatus) {
      setError('Choose the sleeve result before saving.');
      return;
    }

    const commandId = pendingCommandId ?? createBarcodeSurveyCommandId();
    if (!pendingCommandId) setPendingCommandId(commandId);
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const result = await recordBarcodeSurveyObservation({
        commandId,
        skuContext: selectedSku.sku,
        cartonBarcode,
        sleeveStatus,
        sleeveBarcode: sleeveStatus === 'SCANNED' ? sleeveBarcode : null,
        note,
        deviceId: getBarcodeSurveyDeviceId(),
      });
      setMessage(result.replayed ? 'Recovered previous save. Ready for next item.' : 'Evidence saved. Ready for next item.');
      resetForNext();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = Boolean(selectedSku && cartonBarcode.trim() && sleeveStatus && (sleeveStatus !== 'SCANNED' || sleeveBarcode.trim()));
  const noSkuMatch = Boolean(skuQuery.trim() && !selectedSku && !skuSearching && !skuSearchError && skuSuggestions.length === 0);

  return (
    <section className="native-control-card barcode-survey-card" aria-labelledby="barcode-survey-title">
      <div>
        <p className="workspace-eyebrow">PHYSICAL EVIDENCE ONLY</p>
        <h2 id="barcode-survey-title">Barcode Survey</h2>
        <p>Choose an existing SKU for context, then capture physical barcode evidence. This does not change inventory, Commercial SKU mapping, or published Product Identity.</p>
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

        <label>
          <span>2. Scan carton barcode</span>
          <input
            ref={cartonRef}
            autoComplete="off"
            enterKeyHint="next"
            maxLength={128}
            name="cartonBarcode"
            value={cartonBarcode}
            onChange={(event) => { draftChanged(); setCartonBarcode(event.target.value); }}
            placeholder="Scan outer / carton barcode"
            required
          />
        </label>

        <fieldset>
          <legend>3. Sleeve barcode?</legend>
          <div className="row-actions barcode-survey-choices">
            <button className={sleeveStatus === 'SCANNED' ? 'primary-button' : ''} type="button" onClick={() => chooseSleeveStatus('SCANNED')}>Scan sleeve</button>
            <button className={sleeveStatus === 'NO_SEPARATE_BARCODE' ? 'primary-button' : ''} type="button" onClick={() => chooseSleeveStatus('NO_SEPARATE_BARCODE')}>No separate barcode</button>
            <button className={sleeveStatus === 'NOT_CHECKED' ? 'primary-button' : ''} type="button" onClick={() => chooseSleeveStatus('NOT_CHECKED')}>Not checked</button>
          </div>
        </fieldset>

        {sleeveStatus === 'SCANNED' ? (
          <label>
            <span>Scan sleeve barcode</span>
            <input
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
