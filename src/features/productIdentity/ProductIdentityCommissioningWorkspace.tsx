import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Role } from '@/domain/types';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import {
  NativePager,
  NativeWorkspaceEmpty,
  NativeWorkspaceFrame,
  NativeWorkspaceLoading,
  NativeWorkspaceUnavailable,
} from '@/features/navigation/NativeWorkspaceFrame';
import { useWorkspaceQueryState } from '@/features/navigation/useWorkspaceQueryState';
import {
  captureProductIdentity,
  createProductIdentityCommandId,
  publishProductIdentityBatch,
  readCurrentProductIdentityBatch,
  readProductIdentityPage,
  readProductIdentityReferences,
  reopenProductIdentityBatch,
  retireProductIdentityBarcode,
  startProductIdentityBatch,
  submitProductIdentityBatch,
  type ProductIdentityBatch,
  type ProductIdentityCaptureResult,
  type ProductIdentityFamilyReference,
  type ProductIdentityPage,
  type ProductIdentityPhysicalReference,
  type ProductIdentityReferences,
  type ProductIdentityRow,
} from '@/data/repositories/productIdentity';
import {
  resolvePublishedPhysicalBarcode,
  type PublishedPhysicalBarcodeResolution,
} from '@/data/repositories/productIdentityBarcodeResolution';
import './productIdentityCommissioning.css';

type Props = {
  role: Role;
  profile: EcoFlowAuthProfile;
};

type CaptureDraft = {
  physicalSkuCode: string;
  physicalName: string;
  brand: string;
  supplierName: string;
  familyCode: string;
  familyName: string;
  barcode: string;
  packageLevel: 'CARTON' | 'SLEEVE' | 'INNER' | 'EACH' | 'PALLET';
  unitsInBaseUnit: string;
  substitutionPolicy: 'ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED';
  isPreferred: boolean;
  note: string;
};

const PAGE_SIZES = [10, 25, 50, 100] as const;
const EMPTY_PAGE: ProductIdentityPage = { rows: [], totalCount: 0 };
const EMPTY_REFERENCES: ProductIdentityReferences = { families: [], physicalSkus: [], readAt: '' };

function emptyDraft(): CaptureDraft {
  return {
    physicalSkuCode: '',
    physicalName: '',
    brand: '',
    supplierName: '',
    familyCode: '',
    familyName: '',
    barcode: '',
    packageLevel: 'CARTON',
    unitsInBaseUnit: '1',
    substitutionPolicy: 'ALLOWED',
    isPreferred: true,
    note: '',
  };
}

function displayDate(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === 'CONFLICT') return 'danger';
  if (status === 'OPEN' || status === 'NEEDS_MAPPING') return 'warning';
  if (status === 'DRAFT' || status === 'DRAFT_READY' || status === 'SUBMITTED') return 'information';
  return 'ready';
}

function StatusPill({ value }: { value: string }) {
  return <span className={`identity-status tone-${statusTone(value)}`}>{value.replaceAll('_', ' ')}</span>;
}

function BatchSummary({ batch }: { batch: ProductIdentityBatch | null }) {
  return (
    <section className="identity-kpi-grid" aria-label="Commissioning readiness">
      <article><span>Batch</span><strong>{batch?.batchStatus || 'NOT STARTED'}</strong><small>{batch ? `rev ${batch.revision}` : 'Start a governed commissioning batch'}</small></article>
      <article><span>Open</span><strong>{batch?.openTasks.toLocaleString() || '0'}</strong><small>physical mappings still required</small></article>
      <article><span>Draft ready</span><strong>{batch?.draftReadyTasks.toLocaleString() || '0'}</strong><small>captured, not published</small></article>
      <article className={batch?.conflictTasks ? 'danger' : ''}><span>Conflicts</span><strong>{batch?.conflictTasks.toLocaleString() || '0'}</strong><small>must be explicitly resolved</small></article>
      <article><span>Resolved</span><strong>{batch?.resolvedTasks.toLocaleString() || '0'}</strong><small>published canonical identities</small></article>
    </section>
  );
}

function CommissioningRow({ row, onOpen }: { row: ProductIdentityRow; onOpen: (row: ProductIdentityRow) => void }) {
  return (
    <button className="identity-row" type="button" onClick={() => onOpen(row)}>
      <span className="identity-row-main">
        <strong>{row.commercialSkuCode}</strong>
        <span>{row.commercialName || row.ordermentumSku || 'Unnamed commercial SKU'}</span>
        <small>Ordermentum {row.ordermentumSku || '—'}</small>
      </span>
      <span className="identity-row-status"><StatusPill value={row.taskStatus} /><small>{row.taskDetail}</small></span>
      <span className="identity-row-family"><strong>{row.familyName || 'No family'}</strong><small>{row.familyCode || 'Family required'}</small></span>
      <span className="identity-row-physical"><strong>{row.preferredPhysicalName || 'No physical item'}</strong><small>{[row.brand, row.preferredPhysicalCode].filter(Boolean).join(' · ') || 'Physical SKU required'}</small></span>
      <span className="identity-row-evidence">
        <strong>{row.publishedBarcodeCount + row.draftBarcodeCount}</strong>
        <small>canonical barcode{row.publishedBarcodeCount + row.draftBarcodeCount === 1 ? '' : 's'}</small>
        {row.legacyBarcodeCount > 0 ? <em>{row.legacyBarcodeCount} legacy evidence</em> : null}
      </span>
      <span className="identity-row-policy"><strong>{row.substitutionPolicy?.replaceAll('_', ' ') || '—'}</strong><small>{row.identityStatus}</small></span>
    </button>
  );
}

function ReferenceHints({ references }: { references: ProductIdentityReferences }) {
  return (
    <>
      <datalist id="identity-family-codes">{references.families.map((family) => <option key={family.id} value={family.code}>{family.name}</option>)}</datalist>
      <datalist id="identity-physical-codes">{references.physicalSkus.map((physical) => <option key={physical.id} value={physical.code}>{physical.name}</option>)}</datalist>
    </>
  );
}

function IdentityDrawer({
  row,
  batch,
  role,
  references,
  onClose,
  onChanged,
}: {
  row: ProductIdentityRow;
  batch: ProductIdentityBatch | null;
  role: Role;
  references: ProductIdentityReferences;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const canCapture = ['owner', 'admin', 'warehouse'].includes(role);
  const canRetire = role === 'owner' || role === 'admin';
  const [draft, setDraft] = useState<CaptureDraft>(() => ({
    ...emptyDraft(),
    physicalSkuCode: row.preferredPhysicalCode || '',
    physicalName: row.preferredPhysicalName || '',
    brand: row.brand || '',
    familyCode: row.familyCode || '',
    familyName: row.familyName || '',
    substitutionPolicy: row.substitutionPolicy || 'ALLOWED',
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [captureCommandId, setCaptureCommandId] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<ProductIdentityCaptureResult | null>(null);
  const [resolution, setResolution] = useState<PublishedPhysicalBarcodeResolution | null>(null);
  const [retirementReason, setRetirementReason] = useState('Barcode reassigned after physical packaging verification');
  const barcodeRef = useRef<HTMLInputElement | null>(null);
  const editable = canCapture && batch?.batchStatus === 'DRAFT';

  useEffect(() => {
    if (editable) window.setTimeout(() => barcodeRef.current?.focus(), 50);
  }, [editable, row.commercialSkuId]);

  function patch<K extends keyof CaptureDraft>(key: K, value: CaptureDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function applyFamilyReference(code: string) {
    patch('familyCode', code);
    const found = references.families.find((item) => item.code.toLowerCase() === code.trim().toLowerCase());
    if (found) patch('familyName', found.name);
  }

  function applyPhysicalReference(code: string) {
    patch('physicalSkuCode', code);
    const found = references.physicalSkus.find((item) => item.code.toLowerCase() === code.trim().toLowerCase());
    if (!found) return;
    patch('physicalName', found.name);
    patch('brand', found.brand || '');
    const family = references.families.find((item) => item.id === found.familyId);
    if (family) {
      patch('familyCode', family.code);
      patch('familyName', family.name);
    }
  }

  async function capture() {
    if (!batch || !editable) return;
    const units = Number(draft.unitsInBaseUnit);
    if (!draft.barcode.trim() || !draft.physicalSkuCode.trim() || !draft.physicalName.trim() || !draft.familyCode.trim() || !draft.familyName.trim()) {
      setMessage('Barcode, Physical SKU, Physical name, Family code and Family name are required.');
      return;
    }
    if (!Number.isSafeInteger(units) || units <= 0) {
      setMessage('Units per package must be a positive whole number.');
      return;
    }
    const commandId = captureCommandId || createProductIdentityCommandId();
    if (!captureCommandId) setCaptureCommandId(commandId);
    setBusy(true); setMessage(''); setResolution(null);
    try {
      const result = await captureProductIdentity({
        batchId: batch.batchId,
        commandId,
        commercialSkuId: row.commercialSkuId,
        physicalSkuCode: draft.physicalSkuCode,
        physicalName: draft.physicalName,
        brand: draft.brand,
        supplierName: draft.supplierName,
        familyCode: draft.familyCode,
        familyName: draft.familyName,
        barcode: draft.barcode,
        packageLevel: draft.packageLevel,
        unitsInBaseUnit: units,
        substitutionPolicy: draft.substitutionPolicy,
        isPreferred: draft.isPreferred,
        note: draft.note,
      });
      setLastCapture(result);
      setCaptureCommandId(null);
      setMessage(result.detail);
      if (result.captureStatus === 'CONFLICT') {
        try { setResolution(await resolvePublishedPhysicalBarcode(draft.barcode)); } catch { setResolution(null); }
      } else {
        await onChanged(result.detail);
      }
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : String(error)} Retry keeps the same capture command ID.`);
    } finally { setBusy(false); }
  }

  async function retireConflict() {
    if (!canRetire || !resolution || resolution.resolutionStatus !== 'RESOLVED' || resolution.bindingRevision === null) return;
    if (!retirementReason.trim()) { setMessage('Retirement reason is required.'); return; }
    setBusy(true);
    try {
      const result = await retireProductIdentityBarcode({
        barcode: resolution.barcode,
        reason: retirementReason,
        expectedRevision: resolution.bindingRevision,
      });
      if (result.retirementStatus === 'CONFLICT') {
        setMessage('Barcode retirement conflicted with newer server state. Resolve the barcode again before retrying.');
      } else {
        setMessage('Old published barcode binding retired. Re-submit the capture to create a new append-only mapping.');
        setResolution(await resolvePublishedPhysicalBarcode(draft.barcode));
        await onChanged('Old barcode binding retired; replacement capture still required.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  return (
    <div className="identity-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="identity-drawer" aria-label={`Commission ${row.commercialSkuCode}`}>
        <header className="identity-drawer-header">
          <div><span className="section-eyebrow">COMMERCIAL → PHYSICAL IDENTITY</span><h2>{row.commercialSkuCode}</h2><p>{row.commercialName || row.ordermentumSku}</p></div>
          <button type="button" onClick={onClose}>Close</button>
        </header>

        <section className="identity-evidence-card">
          <div><span>Current</span><StatusPill value={row.identityStatus} /></div>
          <dl>
            <div><dt>Published family</dt><dd>{row.familyName || 'Not published'}</dd></div>
            <div><dt>Preferred physical</dt><dd>{row.preferredPhysicalName || 'Not published'}</dd></div>
            <div><dt>Canonical barcodes</dt><dd>{row.publishedBarcodeCount} active · {row.draftBarcodeCount} draft</dd></div>
            <div><dt>Legacy evidence</dt><dd>{row.legacyBarcodeCount ? `${row.legacyBarcodeCount} · ${row.legacyBarcodeExample || 'available'}` : 'None'}</dd></div>
          </dl>
          {row.legacyBarcodeCount > 0 ? <p className="identity-warning">Legacy barcode evidence is reference only. It will not become Physical SKU truth until you physically verify and capture it here.</p> : null}
        </section>

        {!batch ? <section className="identity-drawer-state"><strong>No open commissioning batch</strong><span>Start a batch before capturing physical evidence.</span></section> : null}
        {batch?.batchStatus === 'SUBMITTED' ? <section className="identity-drawer-state"><strong>Batch submitted for review</strong><span>Reopen it before changing mappings.</span></section> : null}
        {!canCapture ? <section className="identity-drawer-state"><strong>Read-only role</strong><span>Your role can inspect identity evidence but cannot create mapping drafts.</span></section> : null}

        <fieldset className="identity-capture-form" disabled={!editable || busy || Boolean(captureCommandId && !busy)}>
          <legend>Physical evidence</legend>
          <label className="identity-scan-field"><span>Scan barcode</span><input ref={barcodeRef} value={draft.barcode} inputMode="numeric" autoComplete="off" placeholder="Scan carton / sleeve / each barcode" onChange={(event) => patch('barcode', event.target.value.trim())} /></label>
          <div className="identity-form-grid">
            <label><span>Physical SKU code</span><input list="identity-physical-codes" value={draft.physicalSkuCode} placeholder="e.g. PHY-GLOVE-BLU-M" onChange={(event) => applyPhysicalReference(event.target.value)} /></label>
            <label><span>Physical product name</span><input value={draft.physicalName} placeholder="Actual brand/product on the shelf" onChange={(event) => patch('physicalName', event.target.value)} /></label>
            <label><span>Brand</span><input value={draft.brand} placeholder="Actual brand" onChange={(event) => patch('brand', event.target.value)} /></label>
            <label><span>Supplier</span><input value={draft.supplierName} placeholder="Optional supplier" onChange={(event) => patch('supplierName', event.target.value)} /></label>
            <label><span>SKU Family code</span><input list="identity-family-codes" value={draft.familyCode} placeholder="e.g. FAM-GLOVE-NITRILE-M" onChange={(event) => applyFamilyReference(event.target.value)} /></label>
            <label><span>SKU Family name</span><input value={draft.familyName} placeholder="Business-equivalent product family" onChange={(event) => patch('familyName', event.target.value)} /></label>
            <label><span>Package level</span><select value={draft.packageLevel} onChange={(event) => patch('packageLevel', event.target.value as CaptureDraft['packageLevel'])}><option>CARTON</option><option>SLEEVE</option><option>INNER</option><option>EACH</option><option>PALLET</option></select></label>
            <label><span>Base units in package</span><input type="number" min="1" step="1" value={draft.unitsInBaseUnit} onChange={(event) => patch('unitsInBaseUnit', event.target.value)} /></label>
            <label><span>Family substitution</span><select value={draft.substitutionPolicy} onChange={(event) => patch('substitutionPolicy', event.target.value as CaptureDraft['substitutionPolicy'])}><option value="ALLOWED">Allowed</option><option value="APPROVAL_REQUIRED">Approval required</option><option value="PROHIBITED">Prohibited — preferred item only</option></select></label>
            <label className="identity-checkbox"><input type="checkbox" checked={draft.isPreferred} onChange={(event) => patch('isPreferred', event.target.checked)} /><span>Make this the preferred Physical SKU for the Commercial SKU</span></label>
          </div>
          <label><span>Commissioning note</span><textarea value={draft.note} placeholder="Optional evidence / packaging note" onChange={(event) => patch('note', event.target.value)} /></label>
          <div className="identity-drawer-actions"><button className="primary-button" type="button" onClick={() => void capture()}>{captureCommandId ? 'Retry same capture' : draft.isPreferred ? 'Save draft mapping' : 'Add family alternative'}</button></div>
        </fieldset>

        {message ? <div className={`identity-command-message ${lastCapture?.captureStatus === 'CONFLICT' ? 'danger' : ''}`} role="status">{message}</div> : null}

        {lastCapture?.captureStatus === 'CONFLICT' ? (
          <section className="identity-conflict-card">
            <span className="section-eyebrow">EXPLICIT CONFLICT RESOLUTION</span>
            <h3>Do not overwrite this barcode</h3>
            {resolution?.resolutionStatus === 'RESOLVED' ? (
              <>
                <p>The current published owner is <strong>{resolution.physicalSkuCode}</strong> · {resolution.physicalName || 'Unnamed'} · {resolution.packageLevel}.</p>
                {canRetire ? <><label><span>Retirement reason</span><textarea value={retirementReason} onChange={(event) => setRetirementReason(event.target.value)} /></label><button type="button" disabled={busy || !retirementReason.trim()} onClick={() => void retireConflict()}>Retire current binding</button></> : <p>Owner/Admin must review and retire the old binding before this barcode can be reassigned.</p>}
              </>
            ) : <p>The canonical resolver does not expose an active owner. Refresh the row before attempting another mapping.</p>}
          </section>
        ) : null}
        <ReferenceHints references={references} />
      </aside>
    </div>
  );
}

export function ProductIdentityCommissioningWorkspace({ role, profile }: Props) {
  const canCapture = ['owner', 'admin', 'warehouse'].includes(role);
  const canPublish = role === 'owner' || role === 'admin';
  const query = useWorkspaceQueryState({
    tab: 'queue', search: '', filter: 'ALL', sort: 'priority', page: 1, pageSize: 25,
    allowedTabs: ['queue'], allowedFilters: ['ALL', 'OPEN', 'DRAFT_READY', 'CONFLICT', 'READY'],
    allowedSorts: ['priority'], allowedPageSizes: PAGE_SIZES,
  });
  const [batch, setBatch] = useState<ProductIdentityBatch | null>(null);
  const [page, setPage] = useState<ProductIdentityPage>(EMPTY_PAGE);
  const [references, setReferences] = useState<ProductIdentityReferences>(EMPTY_REFERENCES);
  const [selectedRow, setSelectedRow] = useState<ProductIdentityRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [startCommandId, setStartCommandId] = useState<string | null>(null);
  const [submitCommandId, setSubmitCommandId] = useState<string | null>(null);
  const [publishCommandId, setPublishCommandId] = useState<string | null>(null);
  const [batchNote, setBatchNote] = useState('Physical identity checked against warehouse packaging.');

  const load = useCallback(async (message?: string) => {
    setLoading(true);
    try {
      const nextBatch = await readCurrentProductIdentityBatch();
      const [nextPage, nextReferences] = await Promise.all([
        readProductIdentityPage({
          batchId: nextBatch?.batchId || null,
          search: query.state.search,
          filter: query.state.filter,
          page: query.state.page,
          pageSize: query.state.pageSize,
        }),
        readProductIdentityReferences(nextBatch?.batchId || null),
      ]);
      setBatch(nextBatch);
      setPage(nextPage);
      setReferences(nextReferences);
      setError('');
      if (message) setNotice(message);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally { setLoading(false); }
  }, [query.state.filter, query.state.page, query.state.pageSize, query.state.search]);

  useEffect(() => { void load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(page.totalCount / query.state.pageSize));
  const blockers = (batch?.openTasks || 0) + (batch?.conflictTasks || 0);

  const batchAction = useMemo(() => {
    if (!batch) return 'START';
    if (batch.batchStatus === 'DRAFT') return 'SUBMIT';
    if (batch.batchStatus === 'SUBMITTED') return canPublish ? 'PUBLISH' : 'WAIT';
    return 'NONE';
  }, [batch, canPublish]);

  async function startBatch() {
    const commandId = startCommandId || createProductIdentityCommandId();
    if (!startCommandId) setStartCommandId(commandId);
    setBusy(true);
    try {
      const result = await startProductIdentityBatch(`Warehouse commissioning · ${new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Adelaide', dateStyle: 'medium' }).format(new Date())}`, commandId);
      setStartCommandId(null);
      await load(`Commissioning batch ${result.commandStatus.toLowerCase()}. Physical mapping can begin; inventory quantities are unchanged.`);
    } catch (commandError) {
      setNotice(`${commandError instanceof Error ? commandError.message : String(commandError)} Retry keeps the same batch command ID.`);
    } finally { setBusy(false); }
  }

  async function submitBatch() {
    if (!batch) return;
    const commandId = submitCommandId || createProductIdentityCommandId();
    if (!submitCommandId) setSubmitCommandId(commandId);
    setBusy(true);
    try {
      const result = await submitProductIdentityBatch({ batchId: batch.batchId, expectedRevision: batch.revision, commandId, note: batchNote });
      if (result.commandStatus === 'CONFLICT') {
        setSubmitCommandId(null);
        await load('Submit conflict detected. Server-authoritative batch state was refreshed; no publication occurred.');
      } else {
        setSubmitCommandId(null);
        await load('Batch submitted for review. Mapping is still draft and cannot affect warehouse execution yet.');
      }
    } catch (commandError) {
      setNotice(`${commandError instanceof Error ? commandError.message : String(commandError)} Retry keeps the same submit command ID.`);
    } finally { setBusy(false); }
  }

  async function publishBatch() {
    if (!batch || !canPublish) return;
    const commandId = publishCommandId || createProductIdentityCommandId();
    if (!publishCommandId) setPublishCommandId(commandId);
    setBusy(true);
    try {
      const result = await publishProductIdentityBatch({ batchId: batch.batchId, expectedRevision: batch.revision, commandId, note: batchNote });
      if (result.commandStatus === 'CONFLICT') {
        setPublishCommandId(null);
        await load('Publish conflict detected. Nothing was partially published; server state was refreshed.');
      } else {
        setPublishCommandId(null);
        setSelectedRow(null);
        await load(`Published ${result.publishedPhysicalSkus} Physical SKUs, ${result.publishedBarcodes} barcodes and ${result.publishedLinks} Commercial SKU contracts. Inventory quantities were not changed.`);
      }
    } catch (commandError) {
      setNotice(`${commandError instanceof Error ? commandError.message : String(commandError)} Retry keeps the same publish command ID.`);
    } finally { setBusy(false); }
  }

  async function reopenBatch() {
    if (!batch || !canPublish) return;
    setBusy(true);
    try {
      await reopenProductIdentityBatch({ batchId: batch.batchId, expectedRevision: batch.revision, reason: 'Returned from review for commissioning correction' });
      setSubmitCommandId(null); setPublishCommandId(null);
      await load('Batch reopened as Draft. Changes can be captured again before resubmission.');
    } catch (commandError) {
      setNotice(commandError instanceof Error ? commandError.message : String(commandError));
    } finally { setBusy(false); }
  }

  const actions = (
    <>
      <span className="status-chip">{profile.app_role}</span>
      <button type="button" disabled={busy} onClick={() => void load()}>Refresh authority</button>
      {batchAction === 'START' && canCapture ? <button className="primary-button" type="button" disabled={busy} onClick={() => void startBatch()}>{startCommandId ? 'Retry batch start' : 'Start commissioning'}</button> : null}
      {batchAction === 'SUBMIT' && canCapture ? <button className="primary-button" type="button" disabled={busy || !batch?.canSubmit} onClick={() => void submitBatch()}>{submitCommandId ? 'Retry same submit' : 'Submit for review'}</button> : null}
      {batchAction === 'PUBLISH' ? <><button type="button" disabled={busy} onClick={() => void reopenBatch()}>Reopen draft</button><button className="primary-button" type="button" disabled={busy || !batch?.canPublish} onClick={() => void publishBatch()}>{publishCommandId ? 'Retry same publish' : 'Publish identity batch'}</button></> : null}
    </>
  );

  return (
    <NativeWorkspaceFrame
      eyebrow="PHASE 3 · PHYSICAL PRODUCT AUTHORITY"
      title="Product Identity Commissioning"
      detail="Commercial SKU stays as the customer/order identity. Capture the actual Physical SKU, SKU Family, package barcode and substitution policy here before warehouse go-live."
      actions={actions}
      notice={notice || undefined}
      noticeTone={notice.toLowerCase().includes('conflict') || notice.toLowerCase().includes('error') ? 'danger' : 'information'}
    >
      <BatchSummary batch={batch} />

      {batch ? (
        <section className="panel identity-batch-strip">
          <div><span className="section-eyebrow">CURRENT BATCH</span><strong>{batch.batchName}</strong><small>Created {displayDate(batch.createdAt)} · rev {batch.revision}</small></div>
          <div><StatusPill value={batch.batchStatus} /><small>{blockers ? `${blockers} blocking task${blockers === 1 ? '' : 's'} remain` : batch.batchStatus === 'DRAFT' ? 'No blockers detected' : 'Review state is server-authoritative'}</small></div>
          {(batch.batchStatus === 'DRAFT' || batch.batchStatus === 'SUBMITTED') ? <label><span>Review / publication note</span><input value={batchNote} disabled={busy || batch.batchStatus === 'SUBMITTED' && !canPublish} onChange={(event) => setBatchNote(event.target.value)} /></label> : null}
        </section>
      ) : (
        <section className="panel identity-batch-strip identity-no-batch"><div><strong>No open commissioning batch</strong><small>Published identities remain readable. Start a new batch only when physical evidence needs to be added or corrected.</small></div></section>
      )}

      <section className="panel identity-queue-panel">
        <header className="identity-queue-header"><div><span className="section-eyebrow">SITE TASK QUEUE</span><h2>Commercial SKUs requiring physical truth</h2></div><span>{page.totalCount.toLocaleString()} records</span></header>
        <div className="native-workspace-toolbar identity-toolbar">
          <label><span>Search</span><input value={query.state.search} placeholder="Commercial SKU, product, family, physical item, legacy barcode" onChange={(event) => query.update({ search: event.target.value })} /></label>
          <label><span>Status</span><select value={query.state.filter} onChange={(event) => query.update({ filter: event.target.value })}><option value="ALL">All</option><option value="OPEN">Needs mapping</option><option value="DRAFT_READY">Draft ready</option><option value="CONFLICT">Conflict</option><option value="READY">Published ready</option></select></label>
          <button type="button" onClick={query.clear}>Clear</button>
        </div>

        {loading ? <NativeWorkspaceLoading label="Product Identity authority" /> : null}
        {!loading && error ? <NativeWorkspaceUnavailable label="Product Identity Commissioning" detail={error} onRetry={() => void load()} /> : null}
        {!loading && !error && page.rows.length === 0 ? <NativeWorkspaceEmpty title="No matching identity tasks" detail="The server-authoritative queue returned no Commercial SKUs for this filter." /> : null}
        {!loading && !error && page.rows.length > 0 ? (
          <div className="identity-table" role="table" aria-label="Product identity commissioning queue">
            <div className="identity-table-head" role="row"><span>Commercial SKU</span><span>Status / task</span><span>SKU Family</span><span>Preferred Physical SKU</span><span>Barcode evidence</span><span>Substitution</span></div>
            {page.rows.map((row) => <CommissioningRow key={row.commercialSkuId} row={row} onOpen={setSelectedRow} />)}
          </div>
        ) : null}
        {!loading && !error ? <div className="identity-pager-row"><label>Rows <select value={query.state.pageSize} onChange={(event) => query.update({ pageSize: Number(event.target.value) })}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label><NativePager page={Math.min(query.state.page, totalPages)} totalPages={totalPages} totalRows={page.totalCount} onPage={(next) => query.update({ page: next }, { preservePage: true })} /></div> : null}
      </section>

      <section className="panel identity-rules-panel">
        <span className="section-eyebrow">COMMISSIONING RULES</span>
        <div><article><strong>Commercial ≠ Physical</strong><p>Ordermentum SKU remains pricing/order identity. The package physically picked is recorded separately.</p></article><article><strong>Legacy evidence is not truth</strong><p>Old barcode records help you locate packaging, but cannot publish a brand/Physical SKU without physical verification.</p></article><article><strong>No quantity side effects</strong><p>Mapping capture and publication never change Receiving, Stocktake, Pick or inventory quantities.</p></article><article><strong>Conflicts fail closed</strong><p>A published barcode cannot silently move to another Physical SKU. Owner/Admin must retire the old binding first.</p></article></div>
      </section>

      {selectedRow ? <IdentityDrawer row={selectedRow} batch={batch} role={role} references={references} onClose={() => setSelectedRow(null)} onChanged={async (message) => { await load(message); }} /> : null}
    </NativeWorkspaceFrame>
  );
}
