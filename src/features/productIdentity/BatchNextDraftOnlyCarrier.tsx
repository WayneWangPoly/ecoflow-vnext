import { useMemo, useState } from 'react';
import type { Role } from '@/domain/types';
import {
  readBarcodeSurveyReconciliationQueue,
  reconcileBarcodeSurveyObservation,
  type BarcodeSurveyReconcileResult,
} from '@/data/repositories/barcodeSurveyReconciliation';
import {
  readCurrentProductIdentityBatch,
  startBoundedProductIdentityBatch,
  type BoundedProductIdentityBatchCommandResult,
  type ProductIdentityBatch,
} from '@/data/repositories/productIdentity';
import {
  ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET,
  buildBatchNextReconcileInput,
  buildBatchNextStartInput,
  emptyBatchNextPhysicalFacts,
  validateBatchNextQueue,
  type BatchNextPhysicalFactsDraft,
  type BatchNextQueueEvidence,
} from './batchNextDraftOnlyContract';

type Props = {
  role: Role;
  onChanged: () => void;
};

type BusyState = 'PREFLIGHT' | 'START' | string | null;

export function BatchNextDraftOnlyCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState<BusyState>(null);
  const [message, setMessage] = useState('');
  const [preflightEvidence, setPreflightEvidence] = useState<BatchNextQueueEvidence[]>([]);
  const [currentBatch, setCurrentBatch] = useState<ProductIdentityBatch | null>(null);
  const [startResult, setStartResult] = useState<BoundedProductIdentityBatchCommandResult | null>(null);
  const [facts, setFacts] = useState<Record<string, BatchNextPhysicalFactsDraft>>(() => Object.fromEntries(
    ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates.map((candidate) => [
      candidate.code,
      emptyBatchNextPhysicalFacts(candidate),
    ]),
  ));
  const [results, setResults] = useState<Record<string, BarcodeSurveyReconcileResult>>({});

  const preflightPassed = preflightEvidence.length === ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates.length;
  const startReady = startResult?.batchStatus === 'DRAFT'
    && startResult.scopedSkuCount === ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates.length
    && ['APPLIED', 'REPLAYED'].includes(startResult.commandStatus);

  const completeCount = useMemo(
    () => Object.keys(results).length,
    [results],
  );

  if (!authorized) return null;

  function patchFact<K extends keyof BatchNextPhysicalFactsDraft>(
    code: string,
    key: K,
    value: BatchNextPhysicalFactsDraft[K],
  ) {
    setFacts((current) => ({
      ...current,
      [code]: {
        ...current[code],
        [key]: value,
      },
    }));
  }

  async function runPreflight() {
    if (busy) return;
    setBusy('PREFLIGHT');
    setMessage('');
    setPreflightEvidence([]);
    setCurrentBatch(null);
    try {
      const [queue, activeBatch] = await Promise.all([
        readBarcodeSurveyReconciliationQueue(500),
        readCurrentProductIdentityBatch(),
      ]);

      if (activeBatch && ['DRAFT', 'SUBMITTED'].includes(activeBatch.batchStatus)) {
        throw new Error(
          `Existing Product Identity batch ${activeBatch.batchId} is ${activeBatch.batchStatus}; stop before Batch Next START.`,
        );
      }

      const evidence = validateBatchNextQueue(queue);
      setCurrentBatch(activeBatch);
      setPreflightEvidence(evidence);
      setMessage(
        `Preflight PASS: five frozen Survey observations remain READY_TO_RECONCILE; no open DRAFT/SUBMITTED batch detected.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function startBatch() {
    if (busy || !preflightPassed || startResult) return;
    setBusy('START');
    setMessage('');
    try {
      const result = await startBoundedProductIdentityBatch(buildBatchNextStartInput());
      if (
        result.batchStatus !== 'DRAFT'
        || result.scopedSkuCount !== ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates.length
        || !['APPLIED', 'REPLAYED'].includes(result.commandStatus)
      ) {
        throw new Error(
          `Batch Next START returned ${result.batchStatus}/${result.commandStatus} with scope ${result.scopedSkuCount}; stop before reconciliation.`,
        );
      }
      setStartResult(result);
      onChanged();
      setMessage(
        `Five-SKU bounded START ${result.commandStatus}. Batch remains DRAFT. Physical facts must be confirmed independently for each reconciliation.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function reconcileOne(code: string) {
    if (busy || !startReady || results[code]) return;
    const candidate = ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates.find((item) => item.code === code);
    if (!candidate || !startResult) return;

    setBusy(`RECONCILE:${code}`);
    setMessage('');
    try {
      const input = buildBatchNextReconcileInput(candidate, startResult.batchId, facts[code]);
      const result = await reconcileBarcodeSurveyObservation(input);
      if (
        result.reconciliationStatus !== 'DRAFTED'
        || !['APPLIED', 'REPLAYED', 'EXISTING'].includes(result.commandStatus)
        || result.commercialSkuId !== candidate.commercialSkuId
      ) {
        throw new Error(
          `${code}: reconciliation acknowledgement was not the expected DRAFT for the frozen Commercial SKU.`,
        );
      }
      setResults((current) => ({ ...current, [code]: result }));
      onChanged();
      setMessage(
        `${code}: DRAFT reconciliation ${result.commandStatus}. Batch remains DRAFT; SUBMIT/PUBLISH are not available in this carrier.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="survey-reconciliation-panel" aria-label="ECOFLOW-328 Batch Next DRAFT-only carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · FIVE-SKU DRAFT-ONLY AUTHORITY</span>
          <h2>ECOFLOW-328 · Batch Next Physical Identity DRAFT</h2>
          <p>
            Frozen production base <code>{ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.protectedMainSha}</code>.
            This carrier can only preflight, START one five-SKU bounded batch and reconcile the five frozen Survey observations into DRAFT.
          </p>
        </div>
      </header>

      <div className="survey-reconciliation-form">
        <h3>1 · Fresh authenticated preflight</h3>
        <p className="survey-reconciliation-note">
          Reads the live Owner/Admin Survey queue and current Product Identity batch. It sends no provider request and performs no business write.
        </p>
        <button
          type="button"
          className="survey-reconciliation-primary"
          disabled={busy !== null || startResult !== null}
          onClick={() => void runPreflight()}
        >
          {busy === 'PREFLIGHT' ? 'Checking five frozen candidates…' : 'Run five-SKU DRAFT preflight'}
        </button>

        {preflightEvidence.length ? (
          <div className="survey-reconciliation-evidence survey-reconciliation-note">
            {preflightEvidence.map(({ candidate, row }) => (
              <div key={candidate.code}>
                <dt>{candidate.code}</dt>
                <dd>{row.queueStatus} · {row.evidenceSource} · {row.sleeveStatus} · Commercial match {row.commercialMatchCount}</dd>
              </div>
            ))}
          </div>
        ) : null}

        {currentBatch ? (
          <p className="survey-reconciliation-note">
            Latest readable batch: <code>{currentBatch.batchId}</code> · {currentBatch.batchStatus} · revision {currentBatch.revision}.
          </p>
        ) : null}
      </div>

      <div className="survey-reconciliation-form">
        <h3>2 · One bounded START for all five SKUs</h3>
        <p className="survey-reconciliation-note">
          Scope and command are frozen. This prevents one-by-one START calls from creating an open-batch conflict.
        </p>
        <dl className="survey-reconciliation-evidence survey-reconciliation-note">
          <div><dt>Batch name</dt><dd>{ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.batchName}</dd></div>
          <div><dt>START command</dt><dd>{ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.startCommandId}</dd></div>
          <div><dt>Frozen scope</dt><dd>{ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates.map((candidate) => candidate.code).join(' / ')}</dd></div>
        </dl>
        <button
          type="button"
          className="survey-reconciliation-primary"
          disabled={busy !== null || !preflightPassed || startResult !== null}
          onClick={() => void startBatch()}
        >
          {busy === 'START' ? 'Starting five-SKU DRAFT batch…' : 'Start frozen five-SKU DRAFT batch'}
        </button>

        {startResult ? (
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Batch ID</dt><dd>{startResult.batchId}</dd></div>
            <div><dt>Status</dt><dd>{startResult.batchStatus}</dd></div>
            <div><dt>Revision</dt><dd>{startResult.revision}</dd></div>
            <div><dt>Command</dt><dd>{startResult.commandStatus}</dd></div>
            <div><dt>Scoped SKUs</dt><dd>{startResult.scopedSkuCount}</dd></div>
          </dl>
        ) : null}
      </div>

      <div className="survey-reconciliation-form">
        <h3>3 · Explicit physical facts → DRAFT only</h3>
        <p className="survey-reconciliation-note">
          Nothing below is inferred from Commercial SKU names. Physical SKU, Family, package conversion and substitution policy must be confirmed from real physical/source authority.
          Leave a candidate untouched until those facts are known.
        </p>

        {ECOFLOW_328_BATCH_NEXT_DRAFT_TARGET.candidates.map((candidate) => {
          const draft = facts[candidate.code];
          const result = results[candidate.code];
          const rowBusy = busy === `RECONCILE:${candidate.code}`;
          return (
            <fieldset
              key={candidate.code}
              className="survey-reconciliation-form"
              disabled={busy !== null || !startReady || Boolean(result)}
            >
              <legend>{candidate.code} · DRAFT {result ? 'COMPLETE' : 'PENDING FACTS'}</legend>
              <label><span>Physical SKU code</span><input value={draft.physicalSkuCode} onChange={(event) => patchFact(candidate.code, 'physicalSkuCode', event.target.value)} /></label>
              <label><span>Physical name</span><input value={draft.physicalName} onChange={(event) => patchFact(candidate.code, 'physicalName', event.target.value)} /></label>
              <label><span>Brand · optional</span><input value={draft.brand} onChange={(event) => patchFact(candidate.code, 'brand', event.target.value)} /></label>
              <label><span>Supplier · optional</span><input value={draft.supplierName} onChange={(event) => patchFact(candidate.code, 'supplierName', event.target.value)} /></label>
              <label><span>Family code</span><input value={draft.familyCode} onChange={(event) => patchFact(candidate.code, 'familyCode', event.target.value)} /></label>
              <label><span>Family name</span><input value={draft.familyName} onChange={(event) => patchFact(candidate.code, 'familyName', event.target.value)} /></label>
              <label>
                <span>Package level · explicitly confirm</span>
                <select value={draft.packageLevel} onChange={(event) => patchFact(candidate.code, 'packageLevel', event.target.value as BatchNextPhysicalFactsDraft['packageLevel'])}>
                  <option value="">Select…</option>
                  <option value="CARTON">CARTON</option>
                  <option value="SLEEVE">SLEEVE</option>
                  <option value="INNER">INNER</option>
                  <option value="EACH">EACH</option>
                  <option value="PALLET">PALLET</option>
                </select>
              </label>
              <label><span>Units in base unit · explicitly confirm</span><input inputMode="decimal" value={draft.unitsInBaseUnit} onChange={(event) => patchFact(candidate.code, 'unitsInBaseUnit', event.target.value)} /></label>
              <label>
                <span>Substitution policy · explicitly confirm</span>
                <select value={draft.substitutionPolicy} onChange={(event) => patchFact(candidate.code, 'substitutionPolicy', event.target.value as BatchNextPhysicalFactsDraft['substitutionPolicy'])}>
                  <option value="">Select…</option>
                  <option value="ALLOWED">ALLOWED</option>
                  <option value="APPROVAL_REQUIRED">APPROVAL_REQUIRED</option>
                  <option value="PROHIBITED">PROHIBITED</option>
                </select>
              </label>
              <label className="survey-reconciliation-checkbox">
                <input type="checkbox" checked={draft.isPreferred} onChange={(event) => patchFact(candidate.code, 'isPreferred', event.target.checked)} />
                <span>Preferred Physical SKU · explicitly choose</span>
              </label>
              <label className="survey-reconciliation-note"><span>Provenance note</span><textarea value={draft.note} onChange={(event) => patchFact(candidate.code, 'note', event.target.value)} /></label>
              <label className="survey-reconciliation-checkbox">
                <input type="checkbox" checked={draft.confirmed} onChange={(event) => patchFact(candidate.code, 'confirmed', event.target.checked)} />
                <span>I confirm these physical facts from real warehouse/source authority; they were not inferred from the product name.</span>
              </label>
              <button
                type="button"
                className="survey-reconciliation-primary"
                onClick={() => void reconcileOne(candidate.code)}
              >
                {rowBusy ? `Reconciling ${candidate.code}…` : `Create ${candidate.code} DRAFT`}
              </button>

              {result ? (
                <dl className="survey-reconciliation-evidence survey-reconciliation-note">
                  <div><dt>Reconciliation</dt><dd>{result.reconciliationId}</dd></div>
                  <div><dt>Observation</dt><dd>{result.productIdentityObservationId}</dd></div>
                  <div><dt>Status</dt><dd>{result.reconciliationStatus}</dd></div>
                  <div><dt>Command</dt><dd>{result.commandStatus}</dd></div>
                </dl>
              ) : null}
            </fieldset>
          );
        })}
      </div>

      <div className="unleashed-acceptance-warning" role="note">
        <strong>DRAFT-only hard stop.</strong> This carrier imports no SUBMIT or PUBLISH action and has no inventory, stocktake, location, barcode-reassignment or provider capability.
        Completed DRAFTs: {completeCount}/5.
      </div>

      <p className="survey-reconciliation-message" role="status">{message || 'No Batch Next command has been sent.'}</p>
    </section>
  );
}
