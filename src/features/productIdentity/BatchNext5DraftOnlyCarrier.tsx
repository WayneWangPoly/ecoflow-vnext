import { useMemo, useState } from 'react';
import type { Role } from '@/domain/types';
import {
  readBarcodeSurveyReconciliationQueue,
  reconcileBarcodeSurveyObservation,
} from '@/data/repositories/barcodeSurveyReconciliation';
import {
  readCurrentProductIdentityBatch,
  startBoundedProductIdentityBatch,
} from '@/data/repositories/productIdentity';
import { readBatchNext5ResumeEvidence } from '@/data/repositories/batchNext5DraftResumeEvidence';
import {
  ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET,
  buildBatchNext5ReconcileInput,
  buildBatchNext5StartInput,
  validateBatchNext5Queue,
  type BatchNext5QueueEvidence,
} from './batchNext5DraftOnlyContract';

type Props = {
  role: Role;
  onChanged: () => void;
};

type BusyState = 'PREFLIGHT' | 'START' | string | null;
type Mode = 'NEW' | 'RESUME' | null;

function text(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function normalized(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function assertExactResumeBatch(
  evidence: Awaited<ReturnType<typeof readBatchNext5ResumeEvidence>>,
  batchId: string,
  queueEvidence: BatchNext5QueueEvidence[],
) {
  const target = ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET;
  if (evidence.batchRows.length !== 1) throw new Error('Existing DRAFT batch evidence is not exactly one row.');
  const batch = evidence.batchRows[0];
  if (
    batch.id !== batchId
    || batch.batch_name !== target.batchName
    || batch.batch_status !== 'DRAFT'
    || batch.start_command_id !== target.startCommandId
    || batch.submit_command_id !== null
    || batch.publish_command_id !== null
  ) throw new Error('Existing DRAFT batch does not match the frozen Batch Next 5 authority.');

  if (evidence.scopeRows.length !== target.candidates.length) {
    throw new Error('Existing DRAFT batch scope count does not equal the frozen eight-SKU scope.');
  }
  const expectedScope = new Set<string>(target.candidates.map((candidate) => candidate.commercialSkuId));
  for (const row of evidence.scopeRows) {
    const commercialSkuId = text(row.commercial_sku_id);
    if (!commercialSkuId || !expectedScope.has(commercialSkuId)) {
      throw new Error('Existing DRAFT batch scope contains an unexpected Commercial SKU.');
    }
    if (row.start_command_id !== target.startCommandId) {
      throw new Error('Existing DRAFT batch scope start command drifted.');
    }
    expectedScope.delete(commercialSkuId);
  }
  if (expectedScope.size !== 0) throw new Error('Existing DRAFT batch is missing frozen Commercial SKUs.');

  const completed = new Set<string>();
  const seenCommands = new Set<string>();
  for (const row of evidence.reconciliationRows) {
    const commercialSkuId = text(row.commercial_sku_id);
    const candidate = target.candidates.find((item) => item.commercialSkuId === commercialSkuId);
    if (!candidate) throw new Error('Existing DRAFT reconciliation contains an unexpected Commercial SKU.');
    if (
      row.batch_id !== batchId
      || row.command_id !== candidate.reconcileCommandId
      || normalized(row.sku_context) !== candidate.code
      || row.carton_barcode !== candidate.cartonBarcode
      || row.reconciliation_status !== 'DRAFTED'
    ) throw new Error(`${candidate.code}: existing DRAFT reconciliation provenance drifted.`);

    const queue = queueEvidence.find((item) => item.candidate.code === candidate.code);
    if (
      !queue
      || !queue.alreadyDrafted
      || queue.row.surveyObservationId !== row.survey_observation_id
      || queue.row.reconciliationId !== row.id
      || queue.row.productIdentityObservationId !== row.product_identity_observation_id
    ) throw new Error(`${candidate.code}: authenticated queue and DRAFT provenance do not agree.`);

    const commandId = text(row.command_id);
    if (!commandId || seenCommands.has(commandId)) throw new Error('Existing DRAFT reconciliation command provenance is not unique.');
    seenCommands.add(commandId);
    completed.add(candidate.code);
  }

  const queueDrafted = queueEvidence.filter((item) => item.alreadyDrafted).map((item) => item.candidate.code);
  if (completed.size !== queueDrafted.length || queueDrafted.some((code) => !completed.has(code))) {
    throw new Error('Authenticated queue DRAFT_CREATED set does not equal exact batch reconciliation provenance.');
  }
  return completed;
}

export function BatchNext5DraftOnlyCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const target = ECOFLOW_328_BATCH_NEXT5_DRAFT_TARGET;
  const [busy, setBusy] = useState<BusyState>(null);
  const [message, setMessage] = useState('No Batch Next 5 command has been sent.');
  const [mode, setMode] = useState<Mode>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchRevision, setBatchRevision] = useState<number | null>(null);
  const [preflightEvidence, setPreflightEvidence] = useState<BatchNext5QueueEvidence[]>([]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>(() => Object.fromEntries(
    target.candidates.map((candidate) => [candidate.code, false]),
  ));
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState<Record<string, boolean>>({});
  const [startAttempted, setStartAttempted] = useState(false);

  const preflightPassed = preflightEvidence.length === target.candidates.length;
  const completeCount = useMemo(
    () => Object.values(completed).filter(Boolean).length,
    [completed],
  );
  const executionReady = Boolean(batchId) && preflightPassed;

  if (!authorized) return null;

  async function runPreflight() {
    if (busy) return;
    setBusy('PREFLIGHT');
    setMessage('');
    setMode(null);
    setBatchId(null);
    setBatchRevision(null);
    setPreflightEvidence([]);
    setCompleted({});
    setAttempted({});
    setStartAttempted(false);

    try {
      const [queue, currentBatch] = await Promise.all([
        readBarcodeSurveyReconciliationQueue(500),
        readCurrentProductIdentityBatch(),
      ]);

      if (currentBatch?.batchStatus === 'SUBMITTED') {
        throw new Error(`Existing Product Identity batch ${currentBatch.batchId} is SUBMITTED; stop before Batch Next 5.`);
      }

      if (currentBatch?.batchStatus === 'DRAFT') {
        const queueEvidence = validateBatchNext5Queue(queue, true);
        const resumeEvidence = await readBatchNext5ResumeEvidence(currentBatch.batchId);
        const completedCodes = assertExactResumeBatch(resumeEvidence, currentBatch.batchId, queueEvidence);
        const completedRows = Object.fromEntries([...completedCodes].map((code) => [code, true]));
        setPreflightEvidence(queueEvidence);
        setCompleted(completedRows);
        setMode('RESUME');
        setBatchId(currentBatch.batchId);
        setBatchRevision(currentBatch.revision);
        setMessage(
          `Preflight PASS / RESUME: exact authenticated eight-SKU batch ${currentBatch.batchId} is DRAFT rev${currentBatch.revision}; ${completedCodes.size}/8 reconciliations are exact DRAFTED provenance.`,
        );
        return;
      }

      const queueEvidence = validateBatchNext5Queue(queue, false);
      if (queueEvidence.some((item) => item.alreadyDrafted)) {
        throw new Error('Unexpected DRAFT reconciliation without an open exact Batch Next 5 batch.');
      }
      setPreflightEvidence(queueEvidence);
      setMode('NEW');
      setMessage('Preflight PASS / NEW: eight frozen SKU + carton barcode targets resolve to eight unique authenticated READY_TO_RECONCILE Survey observations and no open DRAFT/SUBMITTED Product Identity batch exists.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function startBatch() {
    if (busy || !preflightPassed || mode !== 'NEW' || batchId || startAttempted) return;
    setBusy('START');
    setMessage('');
    let crossedBoundary = false;
    try {
      crossedBoundary = true;
      setStartAttempted(true);
      const result = await startBoundedProductIdentityBatch(buildBatchNext5StartInput());
      if (
        result.batchName !== target.batchName
        || result.batchStatus !== 'DRAFT'
        || result.scopedSkuCount !== target.candidates.length
        || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
      ) {
        throw new Error(
          `Batch Next 5 START returned ${result.batchStatus}/${result.commandStatus} with scope ${result.scopedSkuCount}; stop before reconciliation.`,
        );
      }
      setBatchId(result.batchId);
      setBatchRevision(result.revision);
      onChanged();
      setMessage(`Eight-SKU bounded START ${result.commandStatus}. Batch ${result.batchId} remains DRAFT rev${result.revision}.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(crossedBoundary
        ? `${detail} START may have crossed the command boundary. Do not click START again; rerun authenticated preflight/resume first.`
        : detail);
    } finally {
      setBusy(null);
    }
  }

  async function reconcileOne(code: string) {
    if (busy || !executionReady || completed[code] || attempted[code] || !batchId) return;
    const candidate = target.candidates.find((item) => item.code === code);
    const frozenEvidence = preflightEvidence.find((item) => item.candidate.code === code);
    if (!candidate || !frozenEvidence) return;

    setBusy(`RECONCILE:${code}`);
    setMessage('');
    let crossedBoundary = false;
    try {
      const [freshQueue, currentBatch] = await Promise.all([
        readBarcodeSurveyReconciliationQueue(500),
        readCurrentProductIdentityBatch(),
      ]);
      if (!currentBatch || currentBatch.batchId !== batchId || currentBatch.batchStatus !== 'DRAFT') {
        throw new Error(`${code}: current Product Identity authority is no longer the exact DRAFT batch; stop.`);
      }

      const freshQueueEvidence = validateBatchNext5Queue(freshQueue, true);
      const resumeEvidence = await readBatchNext5ResumeEvidence(batchId);
      const serverCompleted = assertExactResumeBatch(resumeEvidence, batchId, freshQueueEvidence);
      if (serverCompleted.has(code)) {
        setCompleted((current) => ({ ...current, [code]: true }));
        setMessage(`${code}: server already contains the exact frozen DRAFT provenance. No reconciliation retry was sent.`);
        return;
      }

      const fresh = freshQueueEvidence.find((item) => item.candidate.code === code);
      if (!fresh) throw new Error(`${code}: fresh authenticated queue no longer contains the frozen target.`);
      if (fresh.row.surveyObservationId !== frozenEvidence.row.surveyObservationId) {
        throw new Error(`${code}: resolved Survey observation ID changed after preflight; stop and rerun preflight.`);
      }
      if (fresh.alreadyDrafted) {
        throw new Error(`${code}: queue reports DRAFT_CREATED without matching exact batch provenance; stop.`);
      }

      const input = buildBatchNext5ReconcileInput(candidate, fresh.row, batchId, confirmed[code] === true);
      crossedBoundary = true;
      setAttempted((current) => ({ ...current, [code]: true }));
      const result = await reconcileBarcodeSurveyObservation(input);
      if (
        result.reconciliationStatus !== 'DRAFTED'
        || !['APPLIED', 'REPLAYED', 'EXISTING'].includes(result.commandStatus)
        || result.commercialSkuId !== candidate.commercialSkuId
        || result.surveyObservationId !== fresh.row.surveyObservationId
        || result.barcode !== candidate.cartonBarcode
      ) {
        throw new Error(`${code}: reconciliation acknowledgement is not the exact authenticated DRAFT result.`);
      }
      setCompleted((current) => ({ ...current, [code]: true }));
      setBatchRevision((revision) => revision === null ? null : revision + (result.commandStatus === 'APPLIED' ? 1 : 0));
      onChanged();
      setMessage(`${code}: DRAFT reconciliation ${result.commandStatus}. Batch remains DRAFT; SUBMIT/PUBLISH are not available in this carrier.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(crossedBoundary
        ? `${detail} Reconciliation may have crossed the command boundary. Do not retry this row; rerun authenticated preflight/resume for read-only verification first.`
        : detail);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="survey-reconciliation-panel" aria-label="ECOFLOW-328 Batch Next 5 DRAFT-only carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · AUTHENTICATED EIGHT-SKU DRAFT-ONLY AUTHORITY</span>
          <h2>ECOFLOW-328 · Batch Next 5 Physical Identity DRAFT</h2>
          <p>
            Frozen engineering base <code>{target.protectedMainSha}</code>. Authenticated census found
            {' '}<strong>{target.authenticatedCensus.ready} READY</strong>; all eight remaining evidence-backed eligible SKUs cover
            {' '}<strong>{target.totalReferenceQty} reference cartons</strong>. This is the complete current READY_TO_RECONCILE cohort; no conflict or identity-confirmation row is included. Survey observation IDs are resolved only inside the authenticated Owner/Admin queue and must remain exact through each write.
          </p>
        </div>
      </header>

      <div className="survey-reconciliation-form">
        <h3>1 · Fresh authenticated preflight / exact resume</h3>
        <p className="survey-reconciliation-note">
          No provider call and no business write. Each frozen SKU + carton barcode must resolve to exactly one current authenticated READY_TO_RECONCILE observation. If the exact batch already exists as DRAFT, batch/scope/reconciliation provenance is independently verified before resume.
        </p>
        <button
          type="button"
          className="survey-reconciliation-primary"
          disabled={busy !== null}
          onClick={() => void runPreflight()}
        >
          {busy === 'PREFLIGHT' ? 'Resolving eight authenticated candidates…' : 'Run NEXT5 eight-SKU DRAFT preflight'}
        </button>

        {preflightEvidence.length ? (
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            {preflightEvidence.map(({ candidate, row, alreadyDrafted }) => (
              <div key={candidate.code}>
                <dt>{candidate.code} · {candidate.referenceQty} cartons</dt>
                <dd>
                  {alreadyDrafted ? 'DRAFT_CREATED' : row.queueStatus}
                  {' · '}Survey {row.surveyObservationId}
                  {' · '}{row.evidenceSource}
                  {' · '}{row.sleeveStatus}{row.sleeveBarcode ? `:${row.sleeveBarcode}` : ''}
                  {' · '}{candidate.cartonBarcode}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <div className="survey-reconciliation-form">
        <h3>2 · One bounded START</h3>
        <dl className="survey-reconciliation-evidence survey-reconciliation-note">
          <div><dt>Mode</dt><dd>{mode ?? 'NOT PREFLIGHTED'}</dd></div>
          <div><dt>Batch name</dt><dd>{target.batchName}</dd></div>
          <div><dt>START command</dt><dd>{target.startCommandId}</dd></div>
          <div><dt>Scope</dt><dd>{target.candidates.map((candidate) => candidate.code).join(' / ')}</dd></div>
          <div><dt>Current batch</dt><dd>{batchId ?? 'not started'}</dd></div>
          <div><dt>Revision</dt><dd>{batchRevision ?? '—'}</dd></div>
        </dl>
        <button
          type="button"
          className="survey-reconciliation-primary"
          disabled={busy !== null || !preflightPassed || mode !== 'NEW' || Boolean(batchId) || startAttempted}
          onClick={() => void startBatch()}
        >
          {busy === 'START' ? 'Starting NEXT5 DRAFT batch…' : 'Start frozen NEXT5 eight-SKU DRAFT batch'}
        </button>
      </div>

      <div className="survey-reconciliation-form">
        <h3>3 · Authenticated physical facts → DRAFT only</h3>
        <p className="survey-reconciliation-note">
          Each write first rereads the protected Owner/Admin queue and exact batch provenance.
          <strong> CARTON × 1 is the Product Identity operational base only; it does not claim pieces/carton or sleeve conversion.</strong>
          The Owner/Admin must explicitly confirm every row.
        </p>

        {target.candidates.map((candidate) => {
          const done = completed[candidate.code] === true;
          const rowBusy = busy === `RECONCILE:${candidate.code}`;
          const lockedAfterAttempt = attempted[candidate.code] === true && !done;
          const evidence = preflightEvidence.find((item) => item.candidate.code === candidate.code);
          return (
            <fieldset
              key={candidate.code}
              className="survey-reconciliation-form"
              disabled={busy !== null || !executionReady || done || lockedAfterAttempt}
            >
              <legend>{candidate.code} · {candidate.referenceQty} cartons · {done ? 'DRAFT COMPLETE' : lockedAfterAttempt ? 'VERIFY BEFORE RETRY' : 'PENDING CONFIRMATION'}</legend>
              <dl className="survey-reconciliation-evidence survey-reconciliation-note">
                <div><dt>Physical / Family code</dt><dd>{candidate.code}</dd></div>
                <div><dt>Name</dt><dd>{candidate.physicalName}</dd></div>
                <div><dt>Package</dt><dd>CARTON × 1 operational base</dd></div>
                <div><dt>Carton barcode</dt><dd>{candidate.cartonBarcode}</dd></div>
                <div><dt>Resolved Survey observation</dt><dd>{evidence?.row.surveyObservationId ?? 'preflight required'}</dd></div>
                <div><dt>Package verification</dt><dd>{evidence ? `${evidence.row.sleeveStatus}${evidence.row.sleeveBarcode ? ` · ${evidence.row.sleeveBarcode}` : ''}` : 'preflight required'}</dd></div>
                <div><dt>Substitution</dt><dd>PROHIBITED</dd></div>
                <div><dt>Preferred Physical</dt><dd>true</dd></div>
                <div><dt>Brand / supplier</dt><dd>blank / blank</dd></div>
                <div><dt>Reconcile command</dt><dd>{candidate.reconcileCommandId}</dd></div>
              </dl>

              {!done ? (
                <>
                  <label className="survey-reconciliation-confirmation">
                    <input
                      type="checkbox"
                      checked={confirmed[candidate.code] === true}
                      onChange={(event) => setConfirmed((current) => ({ ...current, [candidate.code]: event.target.checked }))}
                    />
                    <span>I confirm these authenticated physical facts for {candidate.code}; create DRAFT only.</span>
                  </label>
                  <button
                    type="button"
                    className="survey-reconciliation-primary"
                    disabled={!confirmed[candidate.code] || busy !== null || !executionReady || lockedAfterAttempt}
                    onClick={() => void reconcileOne(candidate.code)}
                  >
                    {rowBusy ? `Creating ${candidate.code} DRAFT…` : lockedAfterAttempt ? 'Rerun preflight before retry' : `Create ${candidate.code} DRAFT`}
                  </button>
                </>
              ) : null}
            </fieldset>
          );
        })}
      </div>

      <div className="unleashed-acceptance-warning" role="note">
        <strong>DRAFT-only hard stop.</strong> This carrier imports no SUBMIT or PUBLISH action and has no inventory, stocktake, location, barcode-reassignment/retirement or provider capability.
        Completed DRAFTs: {completeCount}/8.
      </div>

      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
