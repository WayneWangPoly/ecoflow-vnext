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
  BATCH2_PRODUCT_IDENTITY_DEFAULTS,
  assertBatch2DraftProgress,
  assertBatch2PublishAcknowledgement,
  assertBatch2PublishPreflight,
  assertBatch2ReconcileAcknowledgement,
  assertBatch2StartAcknowledgement,
  assertBatch2SubmitAcknowledgement,
  assertBatch2SubmitPreflight,
  buildBatch2PublishInput,
  buildBatch2ReconcileInput,
  buildBatch2StartInput,
  buildBatch2SubmitInput,
  type Batch2LifecycleDraft,
  type Batch2ReconcileDraft,
  type Batch2StartDraft,
} from './batch2ProductIdentityCarrierContract';

type Props = {
  role: Role;
  onChanged: () => void;
};

type BusyCommand = 'START' | 'RECONCILE_FL' | 'RECONCILE_SB' | 'SUBMIT' | 'PUBLISH' | null;

export function Batch2ProductIdentityExecutionCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [startDraft, setStartDraft] = useState<Batch2StartDraft>(() => ({ ...BATCH2_PRODUCT_IDENTITY_DEFAULTS.start }));
  const [flDraft, setFlDraft] = useState<Batch2ReconcileDraft>(() => ({ ...BATCH2_PRODUCT_IDENTITY_DEFAULTS.reconciliations.FL115PLABOX }));
  const [sbDraft, setSbDraft] = useState<Batch2ReconcileDraft>(() => ({ ...BATCH2_PRODUCT_IDENTITY_DEFAULTS.reconciliations['SB24/32/40LBOX'] }));
  const [submitDraft, setSubmitDraft] = useState<Batch2LifecycleDraft>(() => ({ ...BATCH2_PRODUCT_IDENTITY_DEFAULTS.submit }));
  const [publishDraft, setPublishDraft] = useState<Batch2LifecycleDraft>(() => ({ ...BATCH2_PRODUCT_IDENTITY_DEFAULTS.publish }));
  const [startResult, setStartResult] = useState<BoundedProductIdentityBatchCommandResult | null>(null);
  const [flResult, setFlResult] = useState<BarcodeSurveyReconcileResult | null>(null);
  const [sbResult, setSbResult] = useState<BarcodeSurveyReconcileResult | null>(null);
  const [draftBatchAfterFl, setDraftBatchAfterFl] = useState<ProductIdentityBatch | null>(null);
  const [draftBatchAfterSb, setDraftBatchAfterSb] = useState<ProductIdentityBatch | null>(null);
  const [submitPreflight, setSubmitPreflight] = useState<ProductIdentityBatch | null>(null);
  const [submitResult, setSubmitResult] = useState<ProductIdentityBatchCommandResult | null>(null);
  const [publishPreflight, setPublishPreflight] = useState<ProductIdentityBatch | null>(null);
  const [publishResult, setPublishResult] = useState<ProductIdentityPublishResult | null>(null);
  const [busy, setBusy] = useState<BusyCommand>(null);
  const [message, setMessage] = useState('');

  if (!authorized) return null;

  function patchStart<K extends keyof Batch2StartDraft>(key: K, value: Batch2StartDraft[K]) {
    setStartDraft((current) => ({ ...current, [key]: value }));
  }

  function patchFl<K extends keyof Batch2ReconcileDraft>(key: K, value: Batch2ReconcileDraft[K]) {
    setFlDraft((current) => ({ ...current, [key]: value }));
  }

  function patchSb<K extends keyof Batch2ReconcileDraft>(key: K, value: Batch2ReconcileDraft[K]) {
    setSbDraft((current) => ({ ...current, [key]: value }));
  }

  function patchSubmit<K extends keyof Batch2LifecycleDraft>(key: K, value: Batch2LifecycleDraft[K]) {
    setSubmitDraft((current) => ({ ...current, [key]: value }));
  }

  function patchPublish<K extends keyof Batch2LifecycleDraft>(key: K, value: Batch2LifecycleDraft[K]) {
    setPublishDraft((current) => ({ ...current, [key]: value }));
  }

  async function startBatch2() {
    setBusy('START');
    setMessage('');
    try {
      const input = buildBatch2StartInput(startDraft);
      const result = await startBoundedProductIdentityBatch(input);
      assertBatch2StartAcknowledgement(result, input);
      setStartResult(result);
      setMessage(`Batch 2 START ${result.commandStatus}. Review batch ${result.batchId} before the first separate reconciliation.`);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function reconcileFl() {
    if (!startResult) {
      setMessage('The exact Batch 2 START acknowledgement is required first.');
      return;
    }
    setBusy('RECONCILE_FL');
    setMessage('');
    try {
      const input = buildBatch2ReconcileInput('FL115PLABOX', flDraft, startResult.batchId);
      const result = await reconcileBarcodeSurveyObservation(input);
      assertBatch2ReconcileAcknowledgement('FL115PLABOX', result, input);
      const currentBatch = await readCurrentProductIdentityBatch();
      assertBatch2DraftProgress({
        currentBatch,
        startResult,
        reconciliationResults: { FL115PLABOX: result },
        expectedRevision: 1,
      });
      setFlResult(result);
      setDraftBatchAfterFl(currentBatch);
      setMessage(`FL115PLABOX ${result.commandStatus}; the same Batch 2 batch is DRAFT revision 1.`);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function reconcileSb() {
    if (!startResult || !flResult || draftBatchAfterFl?.revision !== 1) {
      setMessage('The exact FL115PLABOX reconciliation and DRAFT revision 1 read are required first.');
      return;
    }
    setBusy('RECONCILE_SB');
    setMessage('');
    try {
      const input = buildBatch2ReconcileInput('SB24/32/40LBOX', sbDraft, startResult.batchId);
      const result = await reconcileBarcodeSurveyObservation(input);
      assertBatch2ReconcileAcknowledgement('SB24/32/40LBOX', result, input);
      const currentBatch = await readCurrentProductIdentityBatch();
      assertBatch2DraftProgress({
        currentBatch,
        startResult,
        reconciliationResults: { FL115PLABOX: flResult, 'SB24/32/40LBOX': result },
        expectedRevision: 2,
      });
      setSbResult(result);
      setDraftBatchAfterSb(currentBatch);
      setMessage(`SB24/32/40LBOX ${result.commandStatus}; both exact reconciliations are retained and the same batch is DRAFT revision 2.`);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function submitBatch2() {
    if (!startResult || !flResult || !sbResult || draftBatchAfterSb?.revision !== 2) {
      setMessage('Both exact Batch 2 reconciliations and DRAFT revision 2 are required before SUBMIT.');
      return;
    }
    setBusy('SUBMIT');
    setMessage('');
    setSubmitPreflight(null);
    try {
      const input = buildBatch2SubmitInput(submitDraft, startResult.batchId);
      const currentBatch = await readCurrentProductIdentityBatch();
      assertBatch2DraftProgress({
        currentBatch,
        startResult,
        reconciliationResults: { FL115PLABOX: flResult, 'SB24/32/40LBOX': sbResult },
        expectedRevision: 2,
      });
      assertBatch2SubmitPreflight(currentBatch, input);
      setSubmitPreflight(currentBatch);
      const result = await submitProductIdentityBatch(input);
      assertBatch2SubmitAcknowledgement(result, input);
      setSubmitResult(result);
      setMessage(`Batch 2 SUBMIT ${result.commandStatus}; the batch is SUBMITTED revision 3. Review before the separate publish action.`);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function publishBatch2() {
    if (!startResult || submitResult?.batchStatus !== 'SUBMITTED' || submitResult.revision !== 3) {
      setMessage('The exact Batch 2 SUBMITTED revision 3 acknowledgement is required before PUBLISH.');
      return;
    }
    setBusy('PUBLISH');
    setMessage('');
    setPublishPreflight(null);
    try {
      const input = buildBatch2PublishInput(publishDraft, startResult.batchId);
      const currentBatch = await readCurrentProductIdentityBatch();
      assertBatch2PublishPreflight(currentBatch, input);
      setPublishPreflight(currentBatch);
      const result = await publishProductIdentityBatch(input);
      assertBatch2PublishAcknowledgement(result, input);
      setPublishResult(result);
      setMessage(`Batch 2 PUBLISH ${result.commandStatus}; exact revision 4 and 2/2/2/2 acknowledgement received. Stop.`);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  const startReady = startResult?.batchStatus === 'DRAFT'
    && startResult.revision === 0
    && startResult.scopedSkuCount === 2
    && ['APPLIED', 'REPLAYED'].includes(startResult.commandStatus);
  const flReady = Boolean(flResult && draftBatchAfterFl?.batchId === startResult?.batchId && draftBatchAfterFl?.revision === 1);
  const sbReady = Boolean(sbResult && draftBatchAfterSb?.batchId === startResult?.batchId && draftBatchAfterSb?.revision === 2);
  const publishReady = submitResult?.batchId === startResult?.batchId && submitResult?.batchStatus === 'SUBMITTED' && submitResult?.revision === 3;

  return (
    <section className="survey-reconciliation-panel" aria-label="Batch 2 bounded Product Identity execution carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · BATCH 2 · EXPLICIT COMMANDS</span>
          <h2>Run the frozen two-SKU Product Identity lifecycle</h2>
          <p>Each action is separate. The actual bounded START batch and fresh server revision reads fence every later step.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled={busy !== null || startResult !== null}>
          <legend>1 · Bounded START · exactly two</legend>
          <label className="survey-reconciliation-note"><span>Batch name</span><input value={startDraft.batchName} onChange={(event) => patchStart('batchName', event.target.value)} /></label>
          <label className="survey-reconciliation-note"><span>Ordered Commercial SKU UUIDs</span><textarea value={startDraft.commercialSkuIdsText} onChange={(event) => patchStart('commercialSkuIdsText', event.target.value)} /></label>
          <label><span>START command ID</span><input value={startDraft.commandId} onChange={(event) => patchStart('commandId', event.target.value)} /></label>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void startBatch2()}>{busy === 'START' ? 'Starting Batch 2…' : 'Start exact two-SKU batch'}</button>
          {startResult ? <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Batch ID</dt><dd>{startResult.batchId}</dd></div><div><dt>Status</dt><dd>{startResult.batchStatus}</dd></div>
            <div><dt>Revision</dt><dd>{startResult.revision}</dd></div><div><dt>Command</dt><dd>{startResult.commandStatus}</dd></div>
            <div><dt>Scoped SKUs</dt><dd>{startResult.scopedSkuCount}</dd></div>
          </dl> : null}
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || !startReady || flResult !== null}>
          <legend>2 · FL115PLABOX RECONCILE</legend>
          <ReconcileFields draft={flDraft} patch={patchFl} batchId={startResult?.batchId || ''} />
          <button type="button" className="survey-reconciliation-primary" onClick={() => void reconcileFl()}>{busy === 'RECONCILE_FL' ? 'Reconciling FL115PLABOX…' : 'Reconcile FL115PLABOX only'}</button>
          {flResult ? <ReconcileEvidence result={flResult} batch={draftBatchAfterFl} /> : null}
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || !flReady || sbResult !== null}>
          <legend>3 · SB24/32/40LBOX RECONCILE</legend>
          <ReconcileFields draft={sbDraft} patch={patchSb} batchId={startResult?.batchId || ''} />
          <button type="button" className="survey-reconciliation-primary" onClick={() => void reconcileSb()}>{busy === 'RECONCILE_SB' ? 'Reconciling SB24/32/40LBOX…' : 'Reconcile SB24/32/40LBOX only'}</button>
          {sbResult ? <ReconcileEvidence result={sbResult} batch={draftBatchAfterSb} /> : null}
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || !sbReady || submitResult !== null}>
          <legend>4 · Explicit SUBMIT</legend>
          <p className="survey-reconciliation-note">Fresh read gate: the actual START batch must be DRAFT revision 2 with canSubmit=true.</p>
          <LifecycleFields draft={submitDraft} patch={patchSubmit} batchId={startResult?.batchId || ''} commandLabel="SUBMIT" />
          <button type="button" className="survey-reconciliation-primary" onClick={() => void submitBatch2()}>{busy === 'SUBMIT' ? 'Reading gate and submitting…' : 'Read gate, then submit Batch 2'}</button>
          {submitPreflight ? <BatchEvidence batch={submitPreflight} /> : null}
          {submitResult ? <dl className="survey-reconciliation-evidence survey-reconciliation-note"><div><dt>Status</dt><dd>{submitResult.batchStatus}</dd></div><div><dt>Revision</dt><dd>{submitResult.revision}</dd></div><div><dt>Command</dt><dd>{submitResult.commandStatus}</dd></div></dl> : null}
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || !publishReady || publishResult !== null}>
          <legend>5 · Explicit PUBLISH</legend>
          <p className="survey-reconciliation-note">Fresh read gate: the same batch must be SUBMITTED revision 3 with canPublish=true.</p>
          <LifecycleFields draft={publishDraft} patch={patchPublish} batchId={startResult?.batchId || ''} commandLabel="PUBLISH" />
          <button type="button" className="survey-reconciliation-primary" onClick={() => void publishBatch2()}>{busy === 'PUBLISH' ? 'Reading gate and publishing…' : 'Read gate, then publish Batch 2'}</button>
          {publishPreflight ? <BatchEvidence batch={publishPreflight} /> : null}
          {publishResult ? <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Status</dt><dd>{publishResult.batchStatus}</dd></div><div><dt>Revision</dt><dd>{publishResult.revision}</dd></div><div><dt>Command</dt><dd>{publishResult.commandStatus}</dd></div>
            <div><dt>Families</dt><dd>{publishResult.publishedFamilies}</dd></div><div><dt>Physical SKUs</dt><dd>{publishResult.publishedPhysicalSkus}</dd></div>
            <div><dt>Barcodes</dt><dd>{publishResult.publishedBarcodes}</dd></div><div><dt>Links</dt><dd>{publishResult.publishedLinks}</dd></div><div><dt>Published</dt><dd>{publishResult.publishedAt}</dd></div>
          </dl> : null}
        </fieldset>
      </div>
      <p className="survey-reconciliation-message" role="status">{message || 'No Batch 2 command has been sent.'}</p>
    </section>
  );
}

function ReconcileFields({ draft, patch, batchId }: {
  draft: Batch2ReconcileDraft;
  patch: <K extends keyof Batch2ReconcileDraft>(key: K, value: Batch2ReconcileDraft[K]) => void;
  batchId: string;
}) {
  return <>
    <label><span>Batch ID · from START</span><input value={batchId} readOnly /></label>
    <label><span>Survey observation ID</span><input value={draft.surveyObservationId} onChange={(event) => patch('surveyObservationId', event.target.value)} /></label>
    <label><span>RECONCILE command ID</span><input value={draft.commandId} onChange={(event) => patch('commandId', event.target.value)} /></label>
    <label><span>Physical SKU code</span><input value={draft.physicalSkuCode} onChange={(event) => patch('physicalSkuCode', event.target.value)} /></label>
    <label><span>Physical name</span><input value={draft.physicalName} onChange={(event) => patch('physicalName', event.target.value)} /></label>
    <label><span>Brand · blank sends NULL</span><input value={draft.brand} onChange={(event) => patch('brand', event.target.value)} /></label>
    <label><span>Supplier · blank sends NULL</span><input value={draft.supplierName} onChange={(event) => patch('supplierName', event.target.value)} /></label>
    <label><span>Family code</span><input value={draft.familyCode} onChange={(event) => patch('familyCode', event.target.value)} /></label>
    <label><span>Family name</span><input value={draft.familyName} onChange={(event) => patch('familyName', event.target.value)} /></label>
    <label><span>Package level</span><select value={draft.packageLevel} onChange={(event) => patch('packageLevel', event.target.value as Batch2ReconcileDraft['packageLevel'])}><option>CARTON</option><option>SLEEVE</option><option>INNER</option><option>EACH</option><option>PALLET</option></select></label>
    <label><span>Units in base unit</span><input value={draft.unitsInBaseUnit} inputMode="numeric" onChange={(event) => patch('unitsInBaseUnit', event.target.value)} /></label>
    <label><span>Substitution policy</span><select value={draft.substitutionPolicy} onChange={(event) => patch('substitutionPolicy', event.target.value as Batch2ReconcileDraft['substitutionPolicy'])}><option>ALLOWED</option><option>APPROVAL_REQUIRED</option><option>PROHIBITED</option></select></label>
    <label className="survey-reconciliation-checkbox"><input type="checkbox" checked={draft.isPreferred} onChange={(event) => patch('isPreferred', event.target.checked)} /><span>Preferred Physical SKU</span></label>
    <label className="survey-reconciliation-note"><span>Reconciliation note</span><textarea value={draft.note} onChange={(event) => patch('note', event.target.value)} /></label>
  </>;
}

function LifecycleFields({ draft, patch, batchId, commandLabel }: {
  draft: Batch2LifecycleDraft;
  patch: <K extends keyof Batch2LifecycleDraft>(key: K, value: Batch2LifecycleDraft[K]) => void;
  batchId: string;
  commandLabel: 'SUBMIT' | 'PUBLISH';
}) {
  return <>
    <label><span>Batch ID · from START</span><input value={batchId} readOnly /></label>
    <label><span>Expected revision</span><input value={draft.expectedRevision} inputMode="numeric" onChange={(event) => patch('expectedRevision', event.target.value)} /></label>
    <label><span>{commandLabel} command ID</span><input value={draft.commandId} onChange={(event) => patch('commandId', event.target.value)} /></label>
    <label className="survey-reconciliation-note"><span>{commandLabel} note</span><textarea value={draft.note} onChange={(event) => patch('note', event.target.value)} /></label>
  </>;
}

function ReconcileEvidence({ result, batch }: { result: BarcodeSurveyReconcileResult; batch: ProductIdentityBatch | null }) {
  return <dl className="survey-reconciliation-evidence survey-reconciliation-note">
    <div><dt>Commercial SKU</dt><dd>{result.commercialSkuId}</dd></div><div><dt>Barcode</dt><dd>{result.barcode}</dd></div>
    <div><dt>Reconciliation</dt><dd>{result.reconciliationStatus}</dd></div><div><dt>Command</dt><dd>{result.commandStatus}</dd></div>
    <div><dt>Server revision</dt><dd>{batch?.revision ?? 'Not read'}</dd></div>
  </dl>;
}

function BatchEvidence({ batch }: { batch: ProductIdentityBatch }) {
  return <dl className="survey-reconciliation-evidence survey-reconciliation-note">
    <div><dt>Batch ID</dt><dd>{batch.batchId}</dd></div><div><dt>Status</dt><dd>{batch.batchStatus}</dd></div>
    <div><dt>Revision</dt><dd>{batch.revision}</dd></div><div><dt>Can submit</dt><dd>{String(batch.canSubmit)}</dd></div><div><dt>Can publish</dt><dd>{String(batch.canPublish)}</dd></div>
  </dl>;
}
