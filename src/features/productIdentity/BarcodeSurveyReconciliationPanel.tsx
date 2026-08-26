import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Role } from '@/domain/types';
import {
  readBarcodeSurveyReconciliationQueue,
  reconcileBarcodeSurveyObservation,
  type BarcodeSurveyReconciliationRow,
} from '@/data/repositories/barcodeSurveyReconciliation';
import {
  createProductIdentityCommandId,
  readCurrentProductIdentityBatch,
  readProductIdentityReferences,
  startProductIdentityBatch,
  type ProductIdentityBatch,
  type ProductIdentityReferences,
} from '@/data/repositories/productIdentity';
import './barcodeSurveyReconciliation.css';

type Props = {
  role: Role;
  onChanged: () => void;
};

type Draft = {
  physicalSkuCode: string;
  physicalName: string;
  brand: string;
  supplierName: string;
  familyCode: string;
  familyName: string;
  packageLevel: 'CARTON' | 'SLEEVE' | 'INNER' | 'EACH' | 'PALLET';
  unitsInBaseUnit: string;
  substitutionPolicy: 'ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED';
  isPreferred: boolean;
  note: string;
};

const EMPTY_REFERENCES: ProductIdentityReferences = { families: [], physicalSkus: [], readAt: '' };

function emptyDraft(row?: BarcodeSurveyReconciliationRow | null): Draft {
  return {
    physicalSkuCode: '',
    physicalName: row?.skuProductName || row?.commercialName || '',
    brand: '',
    supplierName: '',
    familyCode: '',
    familyName: '',
    packageLevel: 'CARTON',
    unitsInBaseUnit: '1',
    substitutionPolicy: 'ALLOWED',
    isPreferred: true,
    note: row ? `Reconciled from Barcode Survey observation ${row.surveyObservationId}` : '',
  };
}

function statusLabel(value: string) {
  return value.replaceAll('_', ' ');
}

export function BarcodeSurveyReconciliationPanel({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [batch, setBatch] = useState<ProductIdentityBatch | null>(null);
  const [rows, setRows] = useState<BarcodeSurveyReconciliationRow[]>([]);
  const [references, setReferences] = useState<ProductIdentityReferences>(EMPTY_REFERENCES);
  const [selected, setSelected] = useState<BarcodeSurveyReconciliationRow | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [commandId, setCommandId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authorized) return;
    setLoading(true);
    try {
      const currentBatch = await readCurrentProductIdentityBatch();
      const [queue, refs] = await Promise.all([
        readBarcodeSurveyReconciliationQueue(250),
        readProductIdentityReferences(currentBatch?.batchId || null),
      ]);
      setBatch(currentBatch);
      setRows(queue);
      setReferences(refs);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [authorized]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    ready: rows.filter((row) => row.queueStatus === 'READY_TO_RECONCILE').length,
    needsReview: rows.filter((row) => row.queueStatus === 'NEEDS_IDENTITY_CONFIRMATION').length,
    conflicts: rows.filter((row) => row.queueStatus === 'DUPLICATE_CONFLICT').length,
    insufficient: rows.filter((row) => row.queueStatus === 'INSUFFICIENT_EVIDENCE').length,
    drafted: rows.filter((row) => row.queueStatus === 'DRAFT_CREATED').length,
    published: rows.filter((row) => row.queueStatus === 'ALREADY_RECONCILED_PUBLISHED').length,
  }), [rows]);

  if (!authorized) return null;

  function selectRow(row: BarcodeSurveyReconciliationRow) {
    setSelected(row);
    setDraft(emptyDraft(row));
    setCommandId(null);
    setMessage('');
  }

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function applyFamilyReference(code: string) {
    patch('familyCode', code);
    const family = references.families.find((item) => item.code.toLowerCase() === code.trim().toLowerCase());
    if (family) patch('familyName', family.name);
  }

  function applyPhysicalReference(code: string) {
    patch('physicalSkuCode', code);
    const physical = references.physicalSkus.find((item) => item.code.toLowerCase() === code.trim().toLowerCase());
    if (!physical) return;
    patch('physicalName', physical.name);
    patch('brand', physical.brand || '');
    const family = references.families.find((item) => item.id === physical.familyId);
    if (family) {
      patch('familyCode', family.code);
      patch('familyName', family.name);
    }
  }

  async function ensureBatch() {
    if (batch) return batch;
    const result = await startProductIdentityBatch('Barcode Survey reconciliation', createProductIdentityCommandId());
    const current = await readCurrentProductIdentityBatch();
    if (!current || current.batchId !== result.batchId) throw new Error('Product Identity batch authority did not return the started batch.');
    setBatch(current);
    setReferences(await readProductIdentityReferences(current.batchId));
    return current;
  }

  async function reconcile() {
    if (!selected || selected.queueStatus !== 'READY_TO_RECONCILE') return;
    const units = Number(draft.unitsInBaseUnit);
    if (!draft.physicalSkuCode.trim() || !draft.physicalName.trim() || !draft.familyCode.trim() || !draft.familyName.trim()) {
      setMessage('Physical SKU code/name and SKU Family code/name must be explicitly confirmed.');
      return;
    }
    if (!Number.isSafeInteger(units) || units <= 0) {
      setMessage('Units per package must be a positive whole number confirmed from the real package.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const currentBatch = await ensureBatch();
      if (currentBatch.batchStatus !== 'DRAFT') throw new Error('The current Product Identity batch is not editable. Reopen it before reconciling Survey evidence.');
      const id = commandId || createProductIdentityCommandId();
      if (!commandId) setCommandId(id);
      const result = await reconcileBarcodeSurveyObservation({
        surveyObservationId: selected.surveyObservationId,
        batchId: currentBatch.batchId,
        commandId: id,
        physicalSkuCode: draft.physicalSkuCode,
        physicalName: draft.physicalName,
        brand: draft.brand,
        supplierName: draft.supplierName,
        familyCode: draft.familyCode,
        familyName: draft.familyName,
        packageLevel: draft.packageLevel,
        unitsInBaseUnit: units,
        substitutionPolicy: draft.substitutionPolicy,
        isPreferred: draft.isPreferred,
        note: draft.note,
      });
      setCommandId(null);
      setSelected(null);
      setDraft(emptyDraft());
      setMessage(result.detail || 'Survey evidence created a Product Identity draft.');
      await load();
      onChanged();
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : String(error)}${commandId ? ' Retry keeps the same reconciliation command ID.' : ''}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="survey-reconciliation-panel" aria-label="Barcode Survey reconciliation">
      <header className="survey-reconciliation-header">
        <div>
          <span>WAREHOUSE SURVEY → PRODUCT IDENTITY</span>
          <h2>Use evidence already captured in the warehouse</h2>
          <p>Direct physical Survey evidence can prefill barcode and Commercial SKU context. Physical SKU, Family, package quantity and substitution policy still require Owner/Admin confirmation before a draft is created.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || busy}>{loading ? 'Loading…' : 'Refresh evidence'}</button>
      </header>

      <div className="survey-reconciliation-kpis">
        <article><span>Ready</span><strong>{counts.ready}</strong></article>
        <article><span>Needs identity</span><strong>{counts.needsReview}</strong></article>
        <article><span>Conflict</span><strong>{counts.conflicts}</strong></article>
        <article><span>Insufficient</span><strong>{counts.insufficient}</strong></article>
        <article><span>Drafted</span><strong>{counts.drafted}</strong></article>
        <article><span>Published</span><strong>{counts.published}</strong></article>
      </div>

      <div className="survey-reconciliation-layout">
        <div className="survey-reconciliation-list">
          {rows.length === 0 && !loading ? <p className="survey-reconciliation-empty">No Barcode Survey evidence is available yet.</p> : null}
          {rows.map((row) => (
            <button
              key={row.surveyObservationId}
              type="button"
              className={`survey-reconciliation-row status-${row.queueStatus.toLowerCase()} ${selected?.surveyObservationId === row.surveyObservationId ? 'selected' : ''}`}
              onClick={() => selectRow(row)}
            >
              <span className="survey-reconciliation-row-main">
                <strong>{row.skuContext || 'No validated SKU context'}</strong>
                <small>{row.skuProductName || row.commercialName || 'Unidentified product'}</small>
              </span>
              <span><strong>{row.cartonBarcode}</strong><small>carton barcode</small></span>
              <span><strong>{statusLabel(row.queueStatus)}</strong><small>{row.queueReason}</small></span>
            </button>
          ))}
        </div>

        <aside className="survey-reconciliation-editor">
          {!selected ? (
            <div className="survey-reconciliation-empty">
              <strong>Select Survey evidence</strong>
              <p>Start with READY TO RECONCILE. Other rows explain exactly what must be checked during the next warehouse visit.</p>
            </div>
          ) : (
            <>
              <header>
                <span>{statusLabel(selected.queueStatus)}</span>
                <h3>{selected.skuContext || 'Unknown SKU'} · {selected.cartonBarcode}</h3>
                <p>{selected.queueReason}</p>
              </header>

              <dl className="survey-reconciliation-evidence">
                <div><dt>Commercial SKU</dt><dd>{selected.commercialSkuCode || 'Not uniquely resolved'}</dd></div>
                <div><dt>Ordermentum SKU</dt><dd>{selected.ordermentumSku || '—'}</dd></div>
                <div><dt>Sleeve evidence</dt><dd>{selected.sleeveBarcode || selected.sleeveStatus}</dd></div>
                <div><dt>Evidence source</dt><dd>{selected.evidenceSource || 'Legacy'}</dd></div>
              </dl>

              {selected.queueStatus === 'READY_TO_RECONCILE' ? (
                <fieldset disabled={busy} className="survey-reconciliation-form">
                  <legend>Owner/Admin confirmation</legend>
                  <label><span>Physical SKU code</span><input list="survey-reconciliation-physical-codes" value={draft.physicalSkuCode} onChange={(event) => applyPhysicalReference(event.target.value)} /></label>
                  <label><span>Physical product name</span><input value={draft.physicalName} onChange={(event) => patch('physicalName', event.target.value)} /></label>
                  <label><span>Brand</span><input value={draft.brand} onChange={(event) => patch('brand', event.target.value)} /></label>
                  <label><span>Supplier</span><input value={draft.supplierName} onChange={(event) => patch('supplierName', event.target.value)} /></label>
                  <label><span>SKU Family code</span><input list="survey-reconciliation-family-codes" value={draft.familyCode} onChange={(event) => applyFamilyReference(event.target.value)} /></label>
                  <label><span>SKU Family name</span><input value={draft.familyName} onChange={(event) => patch('familyName', event.target.value)} /></label>
                  <label><span>Package level</span><select value={draft.packageLevel} onChange={(event) => patch('packageLevel', event.target.value as Draft['packageLevel'])}><option>CARTON</option><option>SLEEVE</option><option>INNER</option><option>EACH</option><option>PALLET</option></select></label>
                  <label><span>Units per package</span><input inputMode="numeric" value={draft.unitsInBaseUnit} onChange={(event) => patch('unitsInBaseUnit', event.target.value)} /></label>
                  <label><span>Substitution policy</span><select value={draft.substitutionPolicy} onChange={(event) => patch('substitutionPolicy', event.target.value as Draft['substitutionPolicy'])}><option value="ALLOWED">Allowed</option><option value="APPROVAL_REQUIRED">Approval required</option><option value="PROHIBITED">Prohibited</option></select></label>
                  <label className="survey-reconciliation-checkbox"><input type="checkbox" checked={draft.isPreferred} onChange={(event) => patch('isPreferred', event.target.checked)} /><span>Preferred physical SKU for this Commercial SKU</span></label>
                  <label className="survey-reconciliation-note"><span>Review note</span><textarea value={draft.note} onChange={(event) => patch('note', event.target.value)} /></label>
                  <button type="button" className="survey-reconciliation-primary" onClick={() => void reconcile()}>{busy ? 'Creating draft…' : 'Create Product Identity draft'}</button>
                </fieldset>
              ) : null}
            </>
          )}
        </aside>
      </div>

      <datalist id="survey-reconciliation-family-codes">{references.families.map((family) => <option key={family.id} value={family.code}>{family.name}</option>)}</datalist>
      <datalist id="survey-reconciliation-physical-codes">{references.physicalSkus.map((physical) => <option key={physical.id} value={physical.code}>{physical.name}</option>)}</datalist>
      {message ? <p className="survey-reconciliation-message" role="status">{message}</p> : null}
    </section>
  );
}
