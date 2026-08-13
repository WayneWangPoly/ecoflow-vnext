import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { EcoFlowAppRole } from '@/features/auth/authTypes';
import {
  closeReturn,
  readReturnAuthorityState,
  recordReturnDisposition,
  type ReturnAuthorityState,
  type ReturnDisposition,
} from '@/data/repositories/returnCommandAuthority';
import { getOperationalDeviceId } from '@/operational/operationalDeviceIdentity';
import './ReturnCommandPanel.css';

const COMMAND_ROLES = new Set<EcoFlowAppRole>(['OWNER', 'ADMIN', 'WAREHOUSE']);

type DispositionIntent = {
  kind: 'DISPOSITION';
  idempotencyKey: string;
  expectedRevision: number;
  disposition: ReturnDisposition;
  barcode: string;
  quantityPackages: number;
  targetLocation: string;
  manualItem: string;
  note: string;
  evidence: string;
};

type CloseIntent = {
  kind: 'CLOSE';
  idempotencyKey: string;
  expectedRevision: number;
  note: string;
  evidence: string;
};

type RetryIntent = DispositionIntent | CloseIntent;

function commandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestamp(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function evidenceObject(detail: string) {
  return { source: 'returns-native-ui', detail: detail.trim() };
}

function sameDispositionIntent(
  retry: RetryIntent | null,
  input: Omit<DispositionIntent, 'idempotencyKey' | 'expectedRevision' | 'kind'>,
) {
  return retry?.kind === 'DISPOSITION'
    && retry.disposition === input.disposition
    && retry.barcode === input.barcode
    && retry.quantityPackages === input.quantityPackages
    && retry.targetLocation === input.targetLocation
    && retry.manualItem === input.manualItem
    && retry.note === input.note
    && retry.evidence === input.evidence;
}

function sameCloseIntent(retry: RetryIntent | null, note: string, evidence: string) {
  return retry?.kind === 'CLOSE' && retry.note === note && retry.evidence === evidence;
}

export function ReturnCommandPanel({
  returnId,
  role,
  onAuthorityChanged,
}: {
  returnId: string;
  role: EcoFlowAppRole;
  onAuthorityChanged: () => void;
}) {
  const canCommand = COMMAND_ROLES.has(role);
  const [state, setState] = useState<ReturnAuthorityState | null>(null);
  const [loading, setLoading] = useState(canCommand);
  const [pending, setPending] = useState(false);
  const [retryIntent, setRetryIntent] = useState<RetryIntent | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const [disposition, setDisposition] = useState<ReturnDisposition>('RESTOCK');
  const [barcode, setBarcode] = useState('');
  const [quantityPackages, setQuantityPackages] = useState('1');
  const [targetLocation, setTargetLocation] = useState('');
  const [manualItem, setManualItem] = useState('');
  const [dispositionNote, setDispositionNote] = useState('');
  const [dispositionEvidence, setDispositionEvidence] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [closeEvidence, setCloseEvidence] = useState('');

  const load = useCallback(async () => {
    if (!canCommand) return;
    setLoading(true);
    setError('');
    try {
      setState(await readReturnAuthorityState(returnId));
    } catch (loadError) {
      setState(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [canCommand, returnId]);

  useEffect(() => {
    setRetryIntent(null);
    setNotice('');
    setError('');
    setBarcode('');
    setTargetLocation('');
    setManualItem('');
    setDispositionNote('');
    setDispositionEvidence('');
    setCloseNote('');
    setCloseEvidence('');
    void load();
  }, [load]);

  const dispositionInput = useMemo(() => ({
    disposition,
    barcode: barcode.trim(),
    quantityPackages: Number(quantityPackages),
    targetLocation: targetLocation.trim(),
    manualItem: manualItem.trim(),
    note: dispositionNote.trim(),
    evidence: dispositionEvidence.trim(),
  }), [barcode, disposition, dispositionEvidence, dispositionNote, manualItem, quantityPackages, targetLocation]);

  const retryMatchesDisposition = sameDispositionIntent(retryIntent, dispositionInput);
  const retryMatchesClose = sameCloseIntent(retryIntent, closeNote.trim(), closeEvidence.trim());
  const dispositionAllowed = Boolean(state?.physicallyReceived && state.lifecycleStage !== 'CLOSED');
  const closeObviouslyReady = Boolean(
    state?.physicallyReceived
    && state.lifecycleStage !== 'CLOSED'
    && state.inspectionLineCount > 0
    && state.inventoryConsequenceStatus === 'EXPLICIT',
  );

  async function refreshAfterCommand(status: string) {
    const authoritative = await readReturnAuthorityState(returnId);
    setState(authoritative);
    setRetryIntent(null);
    if (status === 'CONFLICT') {
      setNotice(`State changed on the server. Refreshed to revision ${authoritative.revision}; review it before issuing a new intent.`);
      return authoritative;
    }
    setNotice(`${status === 'REPLAYED' ? 'Recovered' : 'Applied'} by server · revision ${authoritative.revision}.`);
    onAuthorityChanged();
    return authoritative;
  }

  async function submitDisposition(event: FormEvent) {
    event.preventDefault();
    if (!state || pending) return;
    if (!dispositionInput.note || !dispositionInput.evidence) {
      setError('Disposition note and evidence are both required.');
      return;
    }
    if (!Number.isFinite(dispositionInput.quantityPackages) || dispositionInput.quantityPackages <= 0) {
      setError('Quantity packages must be greater than zero.');
      return;
    }
    if (disposition === 'RESTOCK' && (!dispositionInput.barcode || !dispositionInput.targetLocation)) {
      setError('RESTOCK requires barcode and target location.');
      return;
    }
    if (disposition !== 'RESTOCK' && !dispositionInput.barcode && !dispositionInput.manualItem) {
      setError('Supplier claim or dispose requires a barcode or manual item description.');
      return;
    }

    const reusable = retryMatchesDisposition && retryIntent?.kind === 'DISPOSITION' ? retryIntent : null;
    const intent: DispositionIntent = reusable ?? {
      kind: 'DISPOSITION',
      idempotencyKey: commandId(),
      expectedRevision: state.revision,
      ...dispositionInput,
    };

    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await recordReturnDisposition({
        returnId,
        disposition: intent.disposition,
        barcode: intent.barcode || null,
        quantityPackages: intent.quantityPackages,
        targetLocation: intent.targetLocation || null,
        manualItem: intent.manualItem || null,
        expectedRevision: intent.expectedRevision,
        idempotencyKey: intent.idempotencyKey,
        deviceId: getOperationalDeviceId(),
        note: intent.note,
        evidence: evidenceObject(intent.evidence),
      });
      await refreshAfterCommand(result.status);
      if (result.status !== 'CONFLICT') {
        setDispositionNote('');
        setDispositionEvidence('');
      }
    } catch (commandError) {
      try { setState(await readReturnAuthorityState(returnId)); } catch { /* original command error remains primary */ }
      setRetryIntent(intent);
      const message = commandError instanceof Error ? commandError.message : String(commandError);
      setError(`${message} · Server acknowledgement is unresolved. Retrying the unchanged intent will reuse command ${intent.idempotencyKey}.`);
    } finally {
      setPending(false);
    }
  }

  async function submitClose(event: FormEvent) {
    event.preventDefault();
    if (!state || pending) return;
    const note = closeNote.trim();
    const evidence = closeEvidence.trim();
    if (!note || !evidence) {
      setError('Close note and evidence are both required.');
      return;
    }

    const reusable = retryMatchesClose && retryIntent?.kind === 'CLOSE' ? retryIntent : null;
    const intent: CloseIntent = reusable ?? {
      kind: 'CLOSE',
      idempotencyKey: commandId(),
      expectedRevision: state.revision,
      note,
      evidence,
    };

    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await closeReturn({
        returnId,
        expectedRevision: intent.expectedRevision,
        idempotencyKey: intent.idempotencyKey,
        deviceId: getOperationalDeviceId(),
        note: intent.note,
        evidence: evidenceObject(intent.evidence),
      });
      await refreshAfterCommand(result.status);
      if (result.status !== 'CONFLICT') {
        setCloseNote('');
        setCloseEvidence('');
      }
    } catch (commandError) {
      try { setState(await readReturnAuthorityState(returnId)); } catch { /* original command error remains primary */ }
      setRetryIntent(intent);
      const message = commandError instanceof Error ? commandError.message : String(commandError);
      setError(`${message} · Server acknowledgement is unresolved. Retrying the unchanged intent will reuse command ${intent.idempotencyKey}.`);
    } finally {
      setPending(false);
    }
  }

  if (!canCommand) {
    return <section className="operational-record-command-panel is-readonly" aria-label="Return command authority">
      <span className="section-eyebrow">RETURN COMMAND AUTHORITY</span>
      <p>Your role is read-only for return disposition and close commands.</p>
    </section>;
  }

  return <section className="operational-record-command-panel return-command-panel" aria-label="Return command authority">
    <div className="operational-record-command-heading">
      <div><span className="section-eyebrow">RETURN COMMAND AUTHORITY</span><h3>Disposition & closure</h3></div>
      <button type="button" disabled={loading || pending} onClick={() => void load()}>Refresh authority</button>
    </div>

    {loading ? <p>Reading authoritative return state…</p> : null}
    {!loading && state ? <div className="operational-record-command-state">
      <div><span>Lifecycle</span><strong>{state.lifecycleStage}</strong></div>
      <div><span>Revision</span><strong>{state.revision}</strong></div>
      <div><span>Physical receipt</span><strong>{state.physicallyReceived ? 'RECEIVED' : 'NOT RECEIVED'}</strong></div>
      <div><span>Inspection lines</span><strong>{state.inspectionLineCount}</strong></div>
      <div><span>Dispositions</span><strong>{state.dispositions.join(', ') || '—'}</strong></div>
      <div><span>Inventory consequence</span><strong>{state.inventoryConsequenceStatus}</strong></div>
      <div><span>Latest movement</span><strong>{state.latestInventoryMovementId || '—'}</strong></div>
      <div><span>Updated</span><strong>{timestamp(state.updatedAt)}</strong></div>
    </div> : null}

    {state ? <form onSubmit={submitDisposition} className="operational-record-command-form return-command-form">
      <h4>Record inspected disposition</h4>
      <div className="return-command-grid">
        <label><span>Disposition *</span><select disabled={pending} value={disposition} onChange={(event) => setDisposition(event.target.value as ReturnDisposition)}><option value="RESTOCK">Restock</option><option value="SUPPLIER_CLAIM">Supplier claim</option><option value="DISPOSE">Dispose</option></select></label>
        <label><span>Quantity packages *</span><input type="number" min="0.0001" step="any" disabled={pending} value={quantityPackages} onChange={(event) => setQuantityPackages(event.target.value)}/></label>
        <label><span>Barcode {disposition === 'RESTOCK' ? '*' : ''}</span><input disabled={pending} value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Scanned or verified barcode"/></label>
        {disposition === 'RESTOCK' ? <label><span>Target location *</span><input disabled={pending} value={targetLocation} onChange={(event) => setTargetLocation(event.target.value)} placeholder={state.warehouseLocation || 'Warehouse location'}/></label> : <label><span>Manual item</span><input disabled={pending} value={manualItem} onChange={(event) => setManualItem(event.target.value)} placeholder="Required when no barcode is available"/></label>}
      </div>
      <label><span>Disposition note *</span><textarea rows={3} maxLength={1000} disabled={pending} value={dispositionNote} onChange={(event) => setDispositionNote(event.target.value)} placeholder="What was inspected and why this disposition is correct?"/></label>
      <label><span>Evidence *</span><textarea rows={3} maxLength={4000} disabled={pending} value={dispositionEvidence} onChange={(event) => setDispositionEvidence(event.target.value)} placeholder="Record the observable evidence supporting this disposition."/></label>
      <p className="operational-record-command-help">Server CAS uses revision {state.revision}. RESTOCK must create and return a governed inventory movement; non-restock consequence remains explicit. No local success is shown before authoritative readback.</p>
      <button type="submit" disabled={pending || !dispositionAllowed || !dispositionInput.note || !dispositionInput.evidence}>{pending ? 'Waiting for server…' : retryMatchesDisposition ? 'Retry same disposition command' : 'Record disposition'}</button>
      {!dispositionAllowed ? <p className="operational-record-command-help">Disposition is unavailable until the return is physically received and not closed.</p> : null}
    </form> : null}

    {state ? <form onSubmit={submitClose} className="operational-record-command-form return-command-form return-command-close">
      <h4>Close return</h4>
      <label><span>Close note *</span><textarea rows={3} maxLength={1000} disabled={pending} value={closeNote} onChange={(event) => setCloseNote(event.target.value)} placeholder="Why is this return ready to close?"/></label>
      <label><span>Closure evidence *</span><textarea rows={3} maxLength={4000} disabled={pending} value={closeEvidence} onChange={(event) => setCloseEvidence(event.target.value)} placeholder="Record the evidence that every inspected item has an explicit consequence."/></label>
      <p className="operational-record-command-help">The UI only blocks obvious illegal states. The server remains authoritative and will reject incomplete inspection, missing consequence, stale revision or unsupported transition.</p>
      <button type="submit" disabled={pending || !closeObviouslyReady || !closeNote.trim() || !closeEvidence.trim()}>{pending ? 'Waiting for server…' : retryMatchesClose ? 'Retry same close command' : 'Close return'}</button>
      {!closeObviouslyReady ? <p className="operational-record-command-help">Close requires physical receipt, at least one inspected disposition and EXPLICIT inventory consequence.</p> : null}
    </form> : null}

    {retryIntent ? <div className="operational-record-command-notice">Unresolved command evidence is retained. Keep the intent unchanged to reuse command ID <code>{retryIntent.idempotencyKey}</code>; changing the intent creates a new command only after review.</div> : null}
    {notice ? <div className="operational-record-command-notice" role="status">{notice}</div> : null}
    {error ? <div className="operational-record-command-error" role="alert">{error}</div> : null}
  </section>;
}
