import { useState } from 'react';
import type { Role } from '@/domain/types';
import { reconcileBarcodeSurveyObservation, type BarcodeSurveyReconcileResult } from '@/data/repositories/barcodeSurveyReconciliation';
import {
  publishProductIdentityBatch,
  readCurrentProductIdentityBatch,
  startBoundedProductIdentityBatch,
  submitProductIdentityBatch,
  type BoundedProductIdentityBatchCommandResult,
  type ProductIdentityBatch,
  type ProductIdentityBatchCommandResult,
  type ProductIdentityPublishResult,
} from '@/data/repositories/productIdentity';
import {
  BPB8_DRAFT_CANARY_DEFAULTS,
  BPB8_P2_SUBMIT_DEFAULTS,
  BPB8_P3_PUBLISH_DEFAULTS,
  assertBoundedPublishAcknowledgement,
  assertBoundedPublishPreflight,
  assertBoundedSubmitAcknowledgement,
  assertBoundedSubmitPreflight,
  buildBoundedPublishInput,
  buildBoundedReconcileInput,
  buildBoundedStartInput,
  buildBoundedSubmitInput,
  type BoundedReconcileDraft,
  type BoundedPublishDraft,
  type BoundedStartDraft,
  type BoundedSubmitDraft,
} from './boundedProductIdentityCarrierContract';

type Props = {
  role: Role;
  onChanged: () => void;
};

type BusyCommand = 'START' | 'RECONCILE' | 'SUBMIT' | 'PUBLISH' | null;

export function BoundedProductIdentityExecutionCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [startDraft, setStartDraft] = useState<BoundedStartDraft>(() => ({ ...BPB8_DRAFT_CANARY_DEFAULTS.start }));
  const [reconcileDraft, setReconcileDraft] = useState<BoundedReconcileDraft>(() => ({ ...BPB8_DRAFT_CANARY_DEFAULTS.reconcile }));
  const [submitDraft, setSubmitDraft] = useState<BoundedSubmitDraft>(() => ({ ...BPB8_P2_SUBMIT_DEFAULTS }));
  const [publishDraft, setPublishDraft] = useState<BoundedPublishDraft>(() => ({ ...BPB8_P3_PUBLISH_DEFAULTS }));
  const [startResult, setStartResult] = useState<BoundedProductIdentityBatchCommandResult | null>(null);
  const [reconcileResult, setReconcileResult] = useState<BarcodeSurveyReconcileResult | null>(null);
  const [submitPreflight, setSubmitPreflight] = useState<ProductIdentityBatch | null>(null);
  const [submitResult, setSubmitResult] = useState<ProductIdentityBatchCommandResult | null>(null);
  const [publishPreflight, setPublishPreflight] = useState<ProductIdentityBatch | null>(null);
  const [publishResult, setPublishResult] = useState<ProductIdentityPublishResult | null>(null);
  const [busy, setBusy] = useState<BusyCommand>(null);
  const [message, setMessage] = useState('');

  if (!authorized) return null;

  function patchStart<K extends keyof BoundedStartDraft>(key: K, value: BoundedStartDraft[K]) {
    setStartDraft((current) => ({ ...current, [key]: value }));
  }

  function patchReconcile<K extends keyof BoundedReconcileDraft>(key: K, value: BoundedReconcileDraft[K]) {
    setReconcileDraft((current) => ({ ...current, [key]: value }));
  }

  function patchSubmit<K extends keyof BoundedSubmitDraft>(key: K, value: BoundedSubmitDraft[K]) {
    setSubmitDraft((current) => ({ ...current, [key]: value }));
  }

  function patchPublish<K extends keyof BoundedPublishDraft>(key: K, value: BoundedPublishDraft[K]) {
    setPublishDraft((current) => ({ ...current, [key]: value }));
  }

  async function startBoundedBatch() {
    setBusy('START');
    setMessage('');
    try {
      const input = buildBoundedStartInput(startDraft);
      const result = await startBoundedProductIdentityBatch(input);
      setStartResult(result);
      onChanged();
      if (
        result.batchStatus !== 'DRAFT'
        || result.scopedSkuCount !== 1
        || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
      ) {
        throw new Error(`Bounded START returned ${result.batchStatus}/${result.commandStatus} with scope ${result.scopedSkuCount}; stop before reconciliation.`);
      }
      setMessage(`Bounded START ${result.commandStatus}. Review the returned batch before creating one DRAFT reconciliation.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function reconcileToDraft() {
    if (
      !startResult
      || startResult.batchStatus !== 'DRAFT'
      || startResult.scopedSkuCount !== 1
      || !['APPLIED', 'REPLAYED'].includes(startResult.commandStatus)
    ) {
      setMessage('A successful one-SKU bounded START result is required before reconciliation.');
      return;
    }

    setBusy('RECONCILE');
    setMessage('');
    try {
      const input = buildBoundedReconcileInput(reconcileDraft, startResult.batchId);
      const result = await reconcileBarcodeSurveyObservation(input);
      setReconcileResult(result);
      setMessage(result.detail || `RECONCILE ${result.commandStatus}; batch remains DRAFT.`);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function submitBoundedBatch() {
    setBusy('SUBMIT');
    setMessage('');
    setSubmitPreflight(null);
    setSubmitResult(null);
    try {
      const input = buildBoundedSubmitInput(submitDraft);
      const currentBatch = await readCurrentProductIdentityBatch();
      assertBoundedSubmitPreflight(currentBatch, input);
      setSubmitPreflight(currentBatch);

      const result = await submitProductIdentityBatch(input);
      assertBoundedSubmitAcknowledgement(result, input);
      setSubmitResult(result);
      setMessage(`Bounded SUBMIT ${result.commandStatus}. Batch is SUBMITTED revision ${result.revision}; stop before publish.`);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function publishBoundedBatch() {
    setBusy('PUBLISH');
    setMessage('');
    setPublishPreflight(null);
    setPublishResult(null);
    try {
      const input = buildBoundedPublishInput(publishDraft);
      const currentBatch = await readCurrentProductIdentityBatch();
      assertBoundedPublishPreflight(currentBatch, input);
      setPublishPreflight(currentBatch);

      const result = await publishProductIdentityBatch(input);
      assertBoundedPublishAcknowledgement(result, input);
      setPublishResult(result);
      setMessage(`Bounded PUBLISH ${result.commandStatus}. Batch is PUBLISHED revision ${result.revision}; stop.`);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  const startReady = startResult?.batchStatus === 'DRAFT'
    && startResult.scopedSkuCount === 1
    && ['APPLIED', 'REPLAYED'].includes(startResult.commandStatus);

  return (
    <section className="survey-reconciliation-panel" aria-label="Bounded Product Identity execution carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · EXPLICIT BOUNDED COMMAND</span>
          <h2>Run one frozen Product Identity canary command</h2>
          <p>Every scope and command identifier below is operator supplied. The server remains the role, replay and Product Identity authority.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled={busy !== null || startResult !== null}>
          <legend>1 · Bounded START</legend>
          <label className="survey-reconciliation-note">
            <span>Batch name</span>
            <input value={startDraft.batchName} onChange={(event) => patchStart('batchName', event.target.value)} />
          </label>
          <label className="survey-reconciliation-note">
            <span>Commercial SKU UUID list · exactly one</span>
            <textarea value={startDraft.commercialSkuIdsText} onChange={(event) => patchStart('commercialSkuIdsText', event.target.value)} />
          </label>
          <label className="survey-reconciliation-note">
            <span>START command ID</span>
            <input value={startDraft.commandId} onChange={(event) => patchStart('commandId', event.target.value)} />
          </label>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void startBoundedBatch()}>
            {busy === 'START' ? 'Starting bounded batch…' : 'Start exactly one SKU'}
          </button>

          {startResult ? (
            <dl className="survey-reconciliation-evidence survey-reconciliation-note">
              <div><dt>Batch ID</dt><dd>{startResult.batchId}</dd></div>
              <div><dt>Status</dt><dd>{startResult.batchStatus}</dd></div>
              <div><dt>Revision</dt><dd>{startResult.revision}</dd></div>
              <div><dt>Command</dt><dd>{startResult.commandStatus}</dd></div>
              <div><dt>Scoped SKUs</dt><dd>{startResult.scopedSkuCount}</dd></div>
              <div><dt>Created</dt><dd>{startResult.createdAt || 'Not returned'}</dd></div>
            </dl>
          ) : null}
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || !startReady || reconcileResult !== null}>
          <legend>2 · RECONCILE to DRAFT</legend>
          <label className="survey-reconciliation-note"><span>Batch ID · returned by START</span><input value={startResult?.batchId || ''} readOnly /></label>
          <label><span>Survey observation ID</span><input value={reconcileDraft.surveyObservationId} onChange={(event) => patchReconcile('surveyObservationId', event.target.value)} /></label>
          <label><span>RECONCILE command ID</span><input value={reconcileDraft.commandId} onChange={(event) => patchReconcile('commandId', event.target.value)} /></label>
          <label><span>Physical SKU code</span><input value={reconcileDraft.physicalSkuCode} onChange={(event) => patchReconcile('physicalSkuCode', event.target.value)} /></label>
          <label><span>Physical name</span><input value={reconcileDraft.physicalName} onChange={(event) => patchReconcile('physicalName', event.target.value)} /></label>
          <label><span>Brand · blank sends NULL</span><input value={reconcileDraft.brand} onChange={(event) => patchReconcile('brand', event.target.value)} /></label>
          <label><span>Supplier · blank sends NULL</span><input value={reconcileDraft.supplierName} onChange={(event) => patchReconcile('supplierName', event.target.value)} /></label>
          <label><span>Family code</span><input value={reconcileDraft.familyCode} onChange={(event) => patchReconcile('familyCode', event.target.value)} /></label>
          <label><span>Family name</span><input value={reconcileDraft.familyName} onChange={(event) => patchReconcile('familyName', event.target.value)} /></label>
          <label><span>Package level</span><select value={reconcileDraft.packageLevel} onChange={(event) => patchReconcile('packageLevel', event.target.value as BoundedReconcileDraft['packageLevel'])}><option>CARTON</option><option>SLEEVE</option><option>INNER</option><option>EACH</option><option>PALLET</option></select></label>
          <label><span>Units in base unit</span><input inputMode="numeric" value={reconcileDraft.unitsInBaseUnit} onChange={(event) => patchReconcile('unitsInBaseUnit', event.target.value)} /></label>
          <label><span>Substitution policy</span><select value={reconcileDraft.substitutionPolicy} onChange={(event) => patchReconcile('substitutionPolicy', event.target.value as BoundedReconcileDraft['substitutionPolicy'])}><option value="ALLOWED">Allowed</option><option value="APPROVAL_REQUIRED">Approval required</option><option value="PROHIBITED">Prohibited</option></select></label>
          <label className="survey-reconciliation-checkbox"><input type="checkbox" checked={reconcileDraft.isPreferred} onChange={(event) => patchReconcile('isPreferred', event.target.checked)} /><span>Preferred Physical SKU</span></label>
          <label className="survey-reconciliation-note"><span>Provenance note</span><textarea value={reconcileDraft.note} onChange={(event) => patchReconcile('note', event.target.value)} /></label>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void reconcileToDraft()}>
            {busy === 'RECONCILE' ? 'Reconciling to DRAFT…' : 'Reconcile one DRAFT'}
          </button>

          {reconcileResult ? (
            <dl className="survey-reconciliation-evidence survey-reconciliation-note">
              <div><dt>Reconciliation ID</dt><dd>{reconcileResult.reconciliationId}</dd></div>
              <div><dt>Observation ID</dt><dd>{reconcileResult.productIdentityObservationId}</dd></div>
              <div><dt>Status</dt><dd>{reconcileResult.reconciliationStatus}</dd></div>
              <div><dt>Command</dt><dd>{reconcileResult.commandStatus}</dd></div>
              <div><dt>Reconciled</dt><dd>{reconcileResult.reconciledAt}</dd></div>
            </dl>
          ) : null}
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || submitResult !== null}>
          <legend>3 · Explicit P2 SUBMIT</legend>
          <p className="survey-reconciliation-note">This action first reads the current server batch and stops unless the exact BPB8 batch is DRAFT revision 1 with canSubmit=true.</p>
          <label><span>Batch ID</span><input value={submitDraft.batchId} onChange={(event) => patchSubmit('batchId', event.target.value)} /></label>
          <label><span>Expected revision · BPB8 P2 requires 1</span><input inputMode="numeric" value={submitDraft.expectedRevision} onChange={(event) => patchSubmit('expectedRevision', event.target.value)} /></label>
          <label><span>SUBMIT command ID</span><input value={submitDraft.commandId} onChange={(event) => patchSubmit('commandId', event.target.value)} /></label>
          <label className="survey-reconciliation-note"><span>Submit note</span><textarea value={submitDraft.note} onChange={(event) => patchSubmit('note', event.target.value)} /></label>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void submitBoundedBatch()}>
            {busy === 'SUBMIT' ? 'Reading gate and submitting…' : 'Read gate, then submit P2'}
          </button>

          {submitPreflight ? (
            <dl className="survey-reconciliation-evidence survey-reconciliation-note">
              <div><dt>Read batch</dt><dd>{submitPreflight.batchId}</dd></div>
              <div><dt>Read status</dt><dd>{submitPreflight.batchStatus}</dd></div>
              <div><dt>Read revision</dt><dd>{submitPreflight.revision}</dd></div>
              <div><dt>Can submit</dt><dd>{String(submitPreflight.canSubmit)}</dd></div>
            </dl>
          ) : null}

          {submitResult ? (
            <dl className="survey-reconciliation-evidence survey-reconciliation-note">
              <div><dt>Batch ID</dt><dd>{submitResult.batchId}</dd></div>
              <div><dt>Status</dt><dd>{submitResult.batchStatus}</dd></div>
              <div><dt>Revision</dt><dd>{submitResult.revision}</dd></div>
              <div><dt>Command</dt><dd>{submitResult.commandStatus}</dd></div>
            </dl>
          ) : null}
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || publishResult !== null}>
          <legend>4 · Explicit P3 PUBLISH</legend>
          <p className="survey-reconciliation-note">This action first reads the current server batch and stops unless the exact BPB8 batch is SUBMITTED revision 2 with canPublish=true.</p>
          <label><span>Batch ID</span><input value={publishDraft.batchId} onChange={(event) => patchPublish('batchId', event.target.value)} /></label>
          <label><span>Expected revision · BPB8 P3 requires 2</span><input inputMode="numeric" value={publishDraft.expectedRevision} onChange={(event) => patchPublish('expectedRevision', event.target.value)} /></label>
          <label><span>PUBLISH command ID</span><input value={publishDraft.commandId} onChange={(event) => patchPublish('commandId', event.target.value)} /></label>
          <label className="survey-reconciliation-note"><span>Publish note</span><textarea value={publishDraft.note} onChange={(event) => patchPublish('note', event.target.value)} /></label>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void publishBoundedBatch()}>
            {busy === 'PUBLISH' ? 'Reading gate and publishing…' : 'Read gate, then publish P3'}
          </button>

          {publishPreflight ? (
            <dl className="survey-reconciliation-evidence survey-reconciliation-note">
              <div><dt>Read batch</dt><dd>{publishPreflight.batchId}</dd></div>
              <div><dt>Read status</dt><dd>{publishPreflight.batchStatus}</dd></div>
              <div><dt>Read revision</dt><dd>{publishPreflight.revision}</dd></div>
              <div><dt>Can publish</dt><dd>{String(publishPreflight.canPublish)}</dd></div>
            </dl>
          ) : null}

          {publishResult ? (
            <dl className="survey-reconciliation-evidence survey-reconciliation-note">
              <div><dt>Batch ID</dt><dd>{publishResult.batchId}</dd></div>
              <div><dt>Status</dt><dd>{publishResult.batchStatus}</dd></div>
              <div><dt>Revision</dt><dd>{publishResult.revision}</dd></div>
              <div><dt>Command</dt><dd>{publishResult.commandStatus}</dd></div>
              <div><dt>Families</dt><dd>{publishResult.publishedFamilies}</dd></div>
              <div><dt>Physical SKUs</dt><dd>{publishResult.publishedPhysicalSkus}</dd></div>
              <div><dt>Barcodes</dt><dd>{publishResult.publishedBarcodes}</dd></div>
              <div><dt>Links</dt><dd>{publishResult.publishedLinks}</dd></div>
              <div><dt>Published</dt><dd>{publishResult.publishedAt}</dd></div>
            </dl>
          ) : null}
        </fieldset>
      </div>

      <p className="survey-reconciliation-message" role="status">{message || 'No command has been sent.'}</p>
    </section>
  );
}
