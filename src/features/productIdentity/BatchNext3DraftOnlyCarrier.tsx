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
import { readBatchNext3ResumeEvidence } from '@/data/repositories/batchNext3DraftResumeEvidence';
import {
  ECOFLOW_328_BATCH_NEXT3_DRAFT_TARGET,
  buildBatchNext3ReconcileInput,
  buildBatchNext3StartInput,
  validateBatchNext3Queue,
  type BatchNext3QueueEvidence,
} from './batchNext3DraftOnlyContract';

type Props = {
  role: Role;
  onChanged: () => void;
};

type BusyState = 'PREFLIGHT' | 'START' | string | null;
type Mode = 'NEW' | 'RESUME' | null;

function text(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function assertExactResumeBatch(
  evidence: Awaited<ReturnType<typeof readBatchNext3ResumeEvidence>>,
  batchId: string,
) {
  const target = ECOFLOW_328_BATCH_NEXT3_DRAFT_TARGET;
  if (evidence.batchRows.length !== 1) throw new Error('Existing DRAFT batch evidence is not exactly one row.');
  const batch = evidence.batchRows[0];
  if (
    batch.id !== batchId
    || batch.batch_name !== target.batchName
    || batch.batch_status !== 'DRAFT'
    || batch.start_command_id !== target.startCommandId
    || batch.submit_command_id !== null
    || batch.publish_command_id !== null
  ) throw new Error('Existing DRAFT batch does not match the frozen Batch Next 3 authority.');

  if (evidence.scopeRows.length !== target.candidates.length) {
    throw new Error('Existing DRAFT batch scope count does not equal the frozen ten-SKU scope.');
  }
  const expected = new Set<string>(target.candidates.map((candidate) => candidate.commercialSkuId));
  for (const row of evidence.scopeRows) {
    const commercialSkuId = text(row.commercial_sku_id);
    if (!commercialSkuId || !expected.has(commercialSkuId)) {
      throw new Error('Existing DRAFT batch scope contains an unexpected Commercial SKU.');
    }
    if (row.start_command_id !== target.startCommandId) {
      throw new Error('Existing DRAFT batch scope start command drifted.');
    }
    expected.delete(commercialSkuId);
  }
  if (expected.size !== 0) throw new Error('Existing DRAFT batch is missing frozen Commercial SKUs.');
}

export function BatchNext3DraftOnlyCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const target = ECOFLOW_328_BATCH_NEXT3_DRAFT_TARGET;
  const [busy, setBusy] = useState<BusyState>(null);
  const [message, setMessage] = useState('No Batch Next 3 command has been sent.');
  const [mode, setMode] = useState<Mode>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchRevision, setBatchRevision] = useState<number | null>(null);
  const [preflightEvidence, setPreflightEvidence] = useState<BatchNext3QueueEvidence[]>([]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>(() => Object.fromEntries(
    target.candidates.map((candidate) => [candidate.code, false]),
  ));
  const [completed, setCompleted] = useState<Record<string, boolean>>({});

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

    try {
      const [queue, currentBatch] = await Promise.all([
        readBarcodeSurveyReconciliationQueue(500),
        readCurrentProductIdentityBatch(),
      ]);

      if (currentBatch?.batchStatus === 'SUBMITTED') {
        throw new Error(`Existing Product Identity batch ${currentBatch.batchId} is SUBMITTED; stop before Batch Next 3.`);
      }

      if (currentBatch?.batchStatus === 'DRAFT') {
        const resumeEvidence = await readBatchNext3ResumeEvidence(currentBatch.batchId);
        assertExactResumeBatch(resumeEvidence, currentBatch.batchId);
        const evidence = validateBatchNext3Queue(queue, true);
        const completedRows = Object.fromEntries(
          evidence.filter((item) => item.alreadyDrafted).map((item) => [item.candidate.code, true]),
        );
        setPreflightEvidence(evidence);
        setCompleted(completedRows);
        setMode('RESUME');
        setBatchId(currentBatch.batchId);
        setBatchRevision(currentBatch.revision);
        setMessage(
          `Preflight PASS / RESUME: exact frozen ten-SKU batch ${currentBatch.batchId} is DRAFT rev${currentBatch.revision}; ${Object.keys(completedRows).length}/10 reconciliations already DRAFTED.`,
        );
        return;
      }

      const evidence = validateBatchNext3Queue(queue, false);
      if (evidence.some((item) => item.alreadyDrafted)) {
        throw new Error('Unexpected existing DRAFT reconciliation without an open exact Batch Next 3 batch.');
      }
      setPreflightEvidence(evidence);
      setMode('NEW');
      setMessage('Preflight PASS / NEW: ten frozen Survey observations remain READY_TO_RECONCILE and no open DRAFT/SUBMITTED Product Identity batch exists.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function startBatch() {
    if (busy || !preflightPassed || mode !== 'NEW' || batchId) return;
    setBusy('START');
    setMessage('');
    try {
      const result = await startBoundedProductIdentityBatch(buildBatchNext3StartInput());
      if (
        result.batchName !== target.batchName
        || result.batchStatus !== 'DRAFT'
        || result.scopedSkuCount !== target.candidates.length
        || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
      ) {
        throw new Error(
          `Batch Next 3 START returned ${result.batchStatus}/${result.commandStatus} with scope ${result.scopedSkuCount}; stop before reconciliation.`,
        );
      }
      setBatchId(result.batchId);
      setBatchRevision(result.revision);
      onChanged();
      setMessage(`Ten-SKU bounded START ${result.commandStatus}. Batch ${result.batchId} remains DRAFT rev${result.revision}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function reconcileOne(code: string) {
    if (busy || !executionReady || completed[code] || !batchId) return;
    const candidate = target.candidates.find((item) => item.code === code);
    if (!candidate) return;

    setBusy(`RECONCILE:${code}`);
    setMessage('');
    try {
      const input = buildBatchNext3ReconcileInput(candidate, batchId, confirmed[code] === true);
      const result = await reconcileBarcodeSurveyObservation(input);
      if (
        result.reconciliationStatus !== 'DRAFTED'
        || !['APPLIED', 'REPLAYED', 'EXISTING'].includes(result.commandStatus)
        || result.commercialSkuId !== candidate.commercialSkuId
        || result.surveyObservationId !== candidate.surveyObservationId
        || result.barcode !== candidate.cartonBarcode
      ) {
        throw new Error(`${code}: reconciliation acknowledgement is not the exact frozen DRAFT result.`);
      }
      setCompleted((current) => ({ ...current, [code]: true }));
      setBatchRevision((revision) => revision === null ? null : revision + (result.commandStatus === 'APPLIED' ? 1 : 0));
      onChanged();
      setMessage(`${code}: DRAFT reconciliation ${result.commandStatus}. Batch remains DRAFT; SUBMIT/PUBLISH are not available in this carrier.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="survey-reconciliation-panel" aria-label="ECOFLOW-328 Batch Next 3 DRAFT-only carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · TEN-SKU DRAFT-ONLY AUTHORITY</span>
          <h2>ECOFLOW-328 · Batch Next 3 Physical Identity DRAFT</h2>
          <p>
            Frozen engineering base <code>{target.protectedMainSha}</code>. Ten evidence-backed SKUs cover
            {' '}<strong>{target.totalReferenceQty} reference cartons</strong>. The carrier can only preflight,
            START one bounded ten-SKU batch, resume that exact DRAFT after refresh, and create DRAFT reconciliations.
          </p>
        </div>
      </header>

      <div className="survey-reconciliation-form">
        <h3>1 · Fresh authenticated preflight / exact resume</h3>
        <p className="survey-reconciliation-note">
          No provider call and no business write. If the exact frozen batch already exists as DRAFT, the carrier verifies its start command and exact ten-SKU scope before resuming.
        </p>
        <button
          type="button"
          className="survey-reconciliation-primary"
          disabled={busy !== null}
          onClick={() => void runPreflight()}
        >
          {busy === 'PREFLIGHT' ? 'Checking ten frozen candidates…' : 'Run ten-SKU DRAFT preflight'}
        </button>

        {preflightEvidence.length ? (
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            {preflightEvidence.map(({ candidate, row, alreadyDrafted }) => (
              <div key={candidate.code}>
                <dt>{candidate.code} · {candidate.referenceQty} cartons</dt>
                <dd>{alreadyDrafted ? 'DRAFT_CREATED' : row.queueStatus} · {row.evidenceSource} · {row.sleeveStatus} · {candidate.cartonBarcode}</dd>
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
          disabled={busy !== null || !preflightPassed || mode !== 'NEW' || Boolean(batchId)}
          onClick={() => void startBatch()}
        >
          {busy === 'START' ? 'Starting ten-SKU DRAFT batch…' : 'Start frozen ten-SKU DRAFT batch'}
        </button>
      </div>

      <div className="survey-reconciliation-form">
        <h3>3 · Frozen physical facts → DRAFT only</h3>
        <p className="survey-reconciliation-note">
          Each row was independently audited against the exact Survey observation, canonical Commercial SKU and collision state.
          <strong> CARTON × 1 is the Product Identity operational base only; it does not claim pieces/carton or sleeve conversion.</strong>
          The Owner/Admin must explicitly confirm each row before the DRAFT write.
        </p>

        {target.candidates.map((candidate) => {
          const done = completed[candidate.code] === true;
          const rowBusy = busy === `RECONCILE:${candidate.code}`;
          return (
            <fieldset
              key={candidate.code}
              className="survey-reconciliation-form"
              disabled={busy !== null || !executionReady || done}
            >
              <legend>{candidate.code} · {candidate.referenceQty} cartons · {done ? 'DRAFT COMPLETE' : 'PENDING CONFIRMATION'}</legend>
              <dl className="survey-reconciliation-evidence survey-reconciliation-note">
                <div><dt>Physical / Family code</dt><dd>{candidate.code}</dd></div>
                <div><dt>Name</dt><dd>{candidate.physicalName}</dd></div>
                <div><dt>Package</dt><dd>CARTON × 1 operational base</dd></div>
                <div><dt>Carton barcode</dt><dd>{candidate.cartonBarcode}</dd></div>
                <div><dt>Sleeve scan evidence</dt><dd>{candidate.sleeveBarcode} · evidence only, no conversion inferred</dd></div>
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
                    <span>I confirm these frozen physical facts for {candidate.code}; create DRAFT only.</span>
                  </label>
                  <button
                    type="button"
                    className="survey-reconciliation-primary"
                    disabled={!confirmed[candidate.code] || busy !== null || !executionReady}
                    onClick={() => void reconcileOne(candidate.code)}
                  >
                    {rowBusy ? `Creating ${candidate.code} DRAFT…` : `Create ${candidate.code} DRAFT`}
                  </button>
                </>
              ) : null}
            </fieldset>
          );
        })}
      </div>

      <div className="unleashed-acceptance-warning" role="note">
        <strong>DRAFT-only hard stop.</strong> This carrier imports no SUBMIT or PUBLISH action and has no inventory, stocktake, location, barcode-reassignment/retirement or provider capability.
        Completed DRAFTs: {completeCount}/10.
      </div>

      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
