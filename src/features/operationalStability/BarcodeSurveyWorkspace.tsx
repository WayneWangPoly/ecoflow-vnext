import { useRef, useState, type FormEvent } from 'react';
import {
  createBarcodeSurveyCommandId,
  getBarcodeSurveyDeviceId,
  recordBarcodeSurveyObservation,
  type BarcodeSurveySleeveStatus,
} from '@/data/repositories/barcodeSurvey';

type SleeveChoice = BarcodeSurveySleeveStatus | '';

export function BarcodeSurveyWorkspace() {
  const cartonRef = useRef<HTMLInputElement>(null);
  const sleeveRef = useRef<HTMLInputElement>(null);
  const [cartonBarcode, setCartonBarcode] = useState('');
  const [sleeveStatus, setSleeveStatus] = useState<SleeveChoice>('');
  const [sleeveBarcode, setSleeveBarcode] = useState('');
  const [note, setNote] = useState('');
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function draftChanged() {
    setPendingCommandId(null);
    setMessage('');
    setError('');
  }

  function chooseSleeveStatus(next: BarcodeSurveySleeveStatus) {
    draftChanged();
    setSleeveStatus(next);
    if (next !== 'SCANNED') setSleeveBarcode('');
    if (next === 'SCANNED') window.setTimeout(() => sleeveRef.current?.focus(), 0);
  }

  function resetForNext() {
    setCartonBarcode('');
    setSleeveStatus('');
    setSleeveBarcode('');
    setNote('');
    setPendingCommandId(null);
    window.setTimeout(() => cartonRef.current?.focus(), 0);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  const canSubmit = Boolean(cartonBarcode.trim() && sleeveStatus && (sleeveStatus !== 'SCANNED' || sleeveBarcode.trim()));

  return (
    <section className="native-control-card barcode-survey-card" aria-labelledby="barcode-survey-title">
      <div>
        <p className="workspace-eyebrow">PHYSICAL EVIDENCE ONLY</p>
        <h2 id="barcode-survey-title">Barcode Survey</h2>
        <p>Fast warehouse capture only. This does not change inventory, Commercial SKU mapping, or published Product Identity.</p>
      </div>

      <form onSubmit={(event) => void submit(event)}>
        <label>
          <span>1. Scan carton barcode</span>
          <input
            ref={cartonRef}
            autoFocus
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
          <legend>2. Sleeve barcode?</legend>
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
