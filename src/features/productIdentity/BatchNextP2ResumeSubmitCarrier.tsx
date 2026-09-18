import { useState } from 'react';
import type { Role } from '@/domain/types';
import { readBatchNextP2ResumeEvidence } from '@/data/repositories/batchNextP2ResumeEvidence';
import {
  readCurrentProductIdentityBatch,
  submitProductIdentityBatch,
  type ProductIdentityBatch,
  type ProductIdentityBatchCommandResult,
} from '@/data/repositories/productIdentity';
import {
  BATCH_NEXT_P2_TARGET,
  assertBatchNextP2ResumeEvidence,
  assertBatchNextP2SubmitAcknowledgement,
  buildBatchNextP2SubmitInput,
  formatBatchNextP2Failure,
  type BatchNextP2Evidence,
} from './batchNextP2ResumeSubmitContract';

type Props = { role: Role; onChanged: () => void };

export function BatchNextP2ResumeSubmitCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState(false);
  const [commandAttempted, setCommandAttempted] = useState(false);
  const [preflight, setPreflight] = useState<ProductIdentityBatch | null>(null);
  const [evidence, setEvidence] = useState<BatchNextP2Evidence | null>(null);
  const [result, setResult] = useState<ProductIdentityBatchCommandResult | null>(null);
  const [message, setMessage] = useState('No Batch Next P2 SUBMIT command has been sent.');

  if (!authorized) return null;

  async function resumeAndSubmit() {
    let commandCrossedBoundary = false;
    setBusy(true);
    setPreflight(null);
    setEvidence(null);
    setMessage('Reading the exact five-SKU authenticated SUBMIT gate…');
    try {
      const currentBatch = await readCurrentProductIdentityBatch();
      const serverEvidence = await readBatchNextP2ResumeEvidence();
      assertBatchNextP2ResumeEvidence(currentBatch, serverEvidence);
      setPreflight(currentBatch);
      setEvidence(serverEvidence);

      const input = buildBatchNextP2SubmitInput();
      commandCrossedBoundary = true;
      setCommandAttempted(true);
      const acknowledgement = await submitProductIdentityBatch(input);
      assertBatchNextP2SubmitAcknowledgement(acknowledgement);
      setResult(acknowledgement);
      setMessage('SUBMITTED rev6 — STOP. PUBLISH is not available in this carrier and requires separate authority.');
      onChanged();
    } catch (error) {
      setMessage(formatBatchNextP2Failure(error, commandCrossedBoundary));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="survey-reconciliation-panel" aria-label="ECOFLOW-328 Batch Next P2 submit-only carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · FIVE-SKU SUBMIT-ONLY AUTHORITY</span>
          <h2>ECOFLOW-328 · Batch Next P2 SUBMIT gate</h2>
          <p>Frozen to one production batch at DRAFT revision 5. It performs nine authenticated SELECT-only evidence reads, then exactly one incumbent SUBMIT call if every canonical row matches.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled={busy || commandAttempted || result !== null}>
          <legend>Exact server gate · one frozen SUBMIT</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Protected main</dt><dd>{BATCH_NEXT_P2_TARGET.protectedMainSha}</dd></div>
            <div><dt>Batch ID</dt><dd>{BATCH_NEXT_P2_TARGET.batchId}</dd></div>
            <div><dt>Required state</dt><dd>DRAFT revision 5</dd></div>
            <div><dt>Required tasks</dt><dd>0 open / 5 draft-ready / 0 conflict</dd></div>
            <div><dt>Expected revision</dt><dd>{BATCH_NEXT_P2_TARGET.expectedRevision}</dd></div>
            <div><dt>SUBMIT command</dt><dd>{BATCH_NEXT_P2_TARGET.submitCommandId}</dd></div>
            <div><dt>Frozen scope</dt><dd>{Object.keys(BATCH_NEXT_P2_TARGET.identities).join(' / ')}</dd></div>
          </dl>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void resumeAndSubmit()}>
            {busy ? 'Reading exact gate and submitting…' : 'Read exact server gate, then SUBMIT five-SKU batch'}
          </button>
        </fieldset>

        {preflight && evidence ? <fieldset className="survey-reconciliation-form" disabled>
          <legend>Verified server evidence</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Status</dt><dd>{preflight.batchStatus}</dd></div>
            <div><dt>Revision</dt><dd>{preflight.revision}</dd></div>
            <div><dt>Can submit</dt><dd>{String(preflight.canSubmit)}</dd></div>
            <div><dt>Tasks</dt><dd>{preflight.openTasks} / {preflight.draftReadyTasks} / {preflight.conflictTasks}</dd></div>
            <div><dt>Scope</dt><dd>{evidence.scopeItems.length}</dd></div>
            <div><dt>Reconciliations</dt><dd>{evidence.reconciliations.length}</dd></div>
            <div><dt>DRAFT graph</dt><dd>{evidence.families.length} families / {evidence.physicalSkus.length} Physical / {evidence.packages.length} packages / {evidence.barcodeBindings.length} barcodes / {evidence.commercialFamilyLinks.length} links</dd></div>
          </dl>
        </fieldset> : null}

        {result ? <fieldset className="survey-reconciliation-form" disabled>
          <legend>SUBMIT acknowledgement</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Batch ID</dt><dd>{result.batchId}</dd></div>
            <div><dt>Status</dt><dd>{result.batchStatus}</dd></div>
            <div><dt>Revision</dt><dd>{result.revision}</dd></div>
            <div><dt>Command</dt><dd>{result.commandStatus}</dd></div>
          </dl>
        </fieldset> : null}
      </div>

      <div className="unleashed-acceptance-warning" role="note">
        <strong>SUBMIT-only hard stop.</strong> This carrier imports no START, RECONCILE or PUBLISH action and has no barcode-reassignment, inventory, stocktake, location or provider capability.
      </div>
      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
