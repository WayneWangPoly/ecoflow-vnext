import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ClipboardCheck, MapPin, PackageCheck, Play, RefreshCw } from 'lucide-react';
import {
  finalizeR5004CBpb8Canary,
  materializeR5004CBpb8InitialReview,
  readR5004CCanaryGate,
  recordR5004CBpb8Location,
  startR5004CBpb8Canary,
  type R5004CCanaryGate,
} from '../team/bpb8InitialOpeningBalanceCanary';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function Bpb8InitialOpeningBalanceCanaryPanel({ supabase }: { supabase: SupabaseClient }) {
  const [open, setOpen] = useState(false);
  const [gate, setGate] = useState<R5004CCanaryGate | null>(null);
  const [running, setRunning] = useState('');
  const [error, setError] = useState('');
  const [startAck, setStartAck] = useState(false);
  const [locationCode, setLocationCode] = useState('');
  const [referenceAllocatedQty, setReferenceAllocatedQty] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [locationCommandId, setLocationCommandId] = useState<string | null>(null);
  const [acceptVariance, setAcceptVariance] = useState(false);
  const [varianceReason, setVarianceReason] = useState('');
  const [materializeAck, setMaterializeAck] = useState(false);

  const referenceTotal = useMemo(
    () => gate?.locations.reduce((sum, item) => sum + item.referenceAllocatedQty, 0) ?? 0,
    [gate],
  );
  const physicalTotal = useMemo(
    () => gate?.locations.reduce((sum, item) => sum + item.countedQty, 0) ?? 0,
    [gate],
  );
  const hasVariance = physicalTotal !== 3;

  async function refresh() {
    setRunning('refresh');
    setError('');
    try {
      setGate(await readR5004CCanaryGate(supabase));
    } catch (readError) {
      setError(errorText(readError));
    } finally {
      setRunning('');
    }
  }

  async function start() {
    if (!startAck) return;
    setRunning('start');
    setError('');
    try {
      setGate(await startR5004CBpb8Canary(supabase));
      setStartAck(false);
    } catch (startError) {
      setError(errorText(startError));
    } finally {
      setRunning('');
    }
  }

  function changeLocationField(setter: (value: string) => void, value: string) {
    setter(value);
    setLocationCommandId(null);
  }

  async function recordLocation() {
    if (!gate?.commissioningId) return;
    const referenceQty = Number(referenceAllocatedQty);
    const countQty = Number(countedQty);
    const commandId = locationCommandId ?? crypto.randomUUID();
    setLocationCommandId(commandId);
    setRunning('location');
    setError('');
    try {
      setGate(await recordR5004CBpb8Location(supabase, gate.commissioningId, {
        locationCode,
        referenceAllocatedQty: referenceQty,
        countedQty: countQty,
        evidenceNote,
        commandId,
      }));
      setLocationCode('');
      setReferenceAllocatedQty('');
      setCountedQty('');
      setEvidenceNote('');
      setLocationCommandId(null);
    } catch (locationError) {
      setError(errorText(locationError));
    } finally {
      setRunning('');
    }
  }

  async function finalize() {
    if (!gate?.commissioningId) return;
    setRunning('finalize');
    setError('');
    try {
      setGate(await finalizeR5004CBpb8Canary(
        supabase,
        gate.commissioningId,
        acceptVariance,
        varianceReason,
      ));
    } catch (finalizeError) {
      setError(errorText(finalizeError));
    } finally {
      setRunning('');
    }
  }

  async function materialize() {
    if (!gate?.commissioningId || !materializeAck) return;
    setRunning('materialize');
    setError('');
    try {
      setGate(await materializeR5004CBpb8InitialReview(supabase, gate.commissioningId));
      setMaterializeAck(false);
    } catch (materializeError) {
      setError(errorText(materializeError));
    } finally {
      setRunning('');
    }
  }

  const locationReady = locationCode.trim().length > 0
    && Number.isInteger(Number(referenceAllocatedQty))
    && Number(referenceAllocatedQty) >= 0
    && Number.isInteger(Number(countedQty))
    && Number(countedQty) >= 0
    && evidenceNote.trim().length > 0;
  const finalizeReady = gate?.commissioningStatus === 'DRAFT'
    && gate.locations.length > 0
    && referenceTotal === 3
    && (!hasVariance || (acceptVariance && varianceReason.trim().length > 0));

  return (
    <div className="unleashed-r5-canary-carrier">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="unleashed-r5-004c-canary"
        onClick={() => setOpen((current) => !current)}
        disabled={Boolean(running)}
      >
        <ClipboardCheck aria-hidden="true" size={17} />
        {open ? 'Close BPB8 canary' : 'Review R5-004C BPB8 canary'}
      </button>

      {open ? (
        <div className="unleashed-acceptance unleashed-r5-canary" id="unleashed-r5-004c-canary">
          <div className="unleashed-acceptance-head">
            <div>
              <h3>R5-004C BPB8 INITIAL opening-balance canary</h3>
              <span>Real physical evidence only · materializes to REVIEW · approval deliberately unavailable</span>
            </div>
            <b className={`pill pill-${error ? 'danger' : gate ? 'good' : 'neutral'}`}>
              {running ? 'RUNNING' : gate?.commissioningStatus ?? gate?.referenceBatchStatus ?? 'NOT READ'}
            </b>
          </div>

          <p className="unleashed-acceptance-note">
            This carrier is bounded to BPB8 / ADL1 / immutable source quantity 3. A warehouse location must be physically verified;
            never infer a rack or bin from Unleashed. The final action creates an INITIAL stocktake in REVIEW only and cannot approve it.
          </p>

          <button type="button" onClick={() => void refresh()} disabled={Boolean(running)}>
            <RefreshCw aria-hidden="true" size={16} />
            Refresh production gate
          </button>

          {error ? <div className="error-message" role="alert">{error}</div> : null}

          {gate ? (
            <>
              <div className="unleashed-acceptance-summary" role="status">
                <span>Reference <strong>{gate.referenceBatchStatus} / rev{gate.referenceBatchRevision}</strong></span>
                <span>Source <strong>BPB8 · ADL1 · 3 cartons</strong></span>
                <span>Commissioning <strong>{gate.commissioningStatus ?? 'NOT STARTED'}</strong></span>
                <span>Authority <strong>NONE</strong></span>
              </div>

              {!gate.commissioningId ? (
                <div className="unleashed-acceptance-result">
                  <label className="unleashed-acceptance-confirm">
                    <input
                      type="checkbox"
                      checked={startAck}
                      onChange={(event) => setStartAck(event.target.checked)}
                      disabled={Boolean(running) || gate.referenceBatchStatus !== 'SEALED' || gate.referenceBatchRevision !== 1}
                    />
                    <span>I confirm START may create BPB8 commissioning provenance only. It creates no inventory authority.</span>
                  </label>
                  <button
                    type="button"
                    className="primary unleashed-acceptance-run"
                    disabled={Boolean(running) || !startAck || gate.referenceBatchStatus !== 'SEALED' || gate.referenceBatchRevision !== 1}
                    onClick={() => void start()}
                  >
                    <Play aria-hidden="true" size={16} />
                    Start bounded BPB8 commissioning
                  </button>
                  {gate.referenceBatchStatus !== 'SEALED' ? (
                    <div className="unleashed-acceptance-warning">R5-004B SEAL must complete first.</div>
                  ) : null}
                </div>
              ) : null}

              {gate.commissioningStatus === 'DRAFT' ? (
                <div className="unleashed-acceptance-result">
                  <h4>Record physically verified location</h4>
                  <p className="unleashed-acceptance-note">
                    Enter the exact active rack/bin you can physically verify. Reference allocation across all recorded locations must total 3.
                    Counted quantity is the current physical count, not an inferred system number.
                  </p>
                  <label>
                    Location code
                    <input value={locationCode} onChange={(event) => changeLocationField(setLocationCode, event.target.value)} placeholder="e.g. A1-01-01A" />
                  </label>
                  <label>
                    Reference allocation
                    <input type="number" min="0" step="1" value={referenceAllocatedQty} onChange={(event) => changeLocationField(setReferenceAllocatedQty, event.target.value)} />
                  </label>
                  <label>
                    Physical counted cartons
                    <input type="number" min="0" step="1" value={countedQty} onChange={(event) => changeLocationField(setCountedQty, event.target.value)} />
                  </label>
                  <label>
                    Physical evidence note
                    <textarea value={evidenceNote} onChange={(event) => changeLocationField(setEvidenceNote, event.target.value)} placeholder="Who/what physically verified this rack/bin and count?" />
                  </label>
                  <button type="button" disabled={Boolean(running) || !locationReady} onClick={() => void recordLocation()}>
                    <MapPin aria-hidden="true" size={16} />
                    {locationCommandId ? 'Retry exact location command' : 'Record physical location evidence'}
                  </button>

                  {gate.locations.length > 0 ? (
                    <ul className="unleashed-acceptance-scope">
                      {gate.locations.map((location) => (
                        <li key={location.locationId}>
                          {location.locationCode}: reference {location.referenceAllocatedQty}, counted {location.countedQty} — {location.evidenceNote}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="unleashed-acceptance-summary">
                    <span>Reference allocated <strong>{referenceTotal} / 3</strong></span>
                    <span>Physical counted <strong>{physicalTotal}</strong></span>
                    <span>Variance <strong>{physicalTotal - 3}</strong></span>
                  </div>

                  {hasVariance ? (
                    <>
                      <label className="unleashed-acceptance-confirm">
                        <input type="checkbox" checked={acceptVariance} onChange={(event) => setAcceptVariance(event.target.checked)} />
                        <span>I explicitly accept that the real physical count differs from the immutable reference quantity 3.</span>
                      </label>
                      <label>
                        Variance reason
                        <textarea value={varianceReason} onChange={(event) => setVarianceReason(event.target.value)} />
                      </label>
                    </>
                  ) : null}

                  <button type="button" disabled={Boolean(running) || !finalizeReady} onClick={() => void finalize()}>
                    <ClipboardCheck aria-hidden="true" size={16} />
                    Finalize frozen physical evidence
                  </button>
                </div>
              ) : null}

              {gate.commissioningStatus === 'FINALIZED' ? (
                <div className="unleashed-acceptance-result">
                  <h4>Materialize INITIAL stocktake into REVIEW</h4>
                  <p className="unleashed-acceptance-note">
                    This creates observations from the frozen location/count evidence and submits the INITIAL session to REVIEW.
                    It does not approve the session and does not create opening-balance authority.
                  </p>
                  <label className="unleashed-acceptance-confirm">
                    <input type="checkbox" checked={materializeAck} onChange={(event) => setMaterializeAck(event.target.checked)} />
                    <span>I confirm materialization may create an INITIAL stocktake in REVIEW only. APPROVAL remains a separate gate.</span>
                  </label>
                  <button type="button" className="primary" disabled={Boolean(running) || !materializeAck} onClick={() => void materialize()}>
                    <PackageCheck aria-hidden="true" size={16} />
                    Materialize BPB8 INITIAL to REVIEW
                  </button>
                </div>
              ) : null}

              {gate.commissioningStatus === 'MATERIALIZED' ? (
                <div className="unleashed-acceptance-result" role="status">
                  <h4>Canary materialized — STOP BEFORE APPROVAL</h4>
                  <div className="unleashed-acceptance-summary">
                    <span>Stocktake session <strong>{gate.stocktakeSessionId ?? 'missing'}</strong></span>
                    <span>Counted <strong>{gate.countedQtyTotal}</strong></span>
                    <span>Inventory authority <strong>NOT CREATED</strong></span>
                  </div>
                  <div className="unleashed-acceptance-warning">
                    No approval control is provided here. Owner/Admin approval is a separate inventory-authority boundary.
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
