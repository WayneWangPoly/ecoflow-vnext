import { useState } from 'react';
import type { Role } from '@/domain/types';
import { readBatch2P2ResumeEvidence } from '@/data/repositories/batch2P2ResumeEvidence';
import {
  readCurrentProductIdentityBatch,
  submitProductIdentityBatch,
  type ProductIdentityBatch,
  type ProductIdentityBatchCommandResult,
} from '@/data/repositories/productIdentity';
import {
  BATCH2_P2_RESUME_TARGET,
  assertBatch2P2ResumeEvidence,
  assertBatch2P2SubmitAcknowledgement,
  buildBatch2P2SubmitInput,
  formatBatch2P2ResumeFailure,
  type Batch2P2ResumeEvidence,
} from './batch2P2ResumeSubmitContract';

type Props = {
  role: Role;
  onChanged: () => void;
};

export function Batch2P2ResumeSubmitCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState(false);
  const [commandAttempted, setCommandAttempted] = useState(false);
  const [preflight, setPreflight] = useState<ProductIdentityBatch | null>(null);
  const [evidence, setEvidence] = useState<Batch2P2ResumeEvidence | null>(null);
  const [result, setResult] = useState<ProductIdentityBatchCommandResult | null>(null);
  const [message, setMessage] = useState('No Batch 2 P2 command has been sent.');

  if (!authorized) return null;

  async function resumeAndSubmitBatch2P2() {
    let commandCrossedBoundary = false;
    setBusy(true);
    setPreflight(null);
    setEvidence(null);
    setMessage('Reading the exact authenticated Batch 2 P2 server gate…');
    try {
      const currentBatch = await readCurrentProductIdentityBatch();
      const serverEvidence = await readBatch2P2ResumeEvidence();
      assertBatch2P2ResumeEvidence(currentBatch, serverEvidence);
      setPreflight(currentBatch);
      setEvidence(serverEvidence);

      const input = buildBatch2P2SubmitInput();
      commandCrossedBoundary = true;
      setCommandAttempted(true);
      const acknowledgement = await submitProductIdentityBatch(input);
      assertBatch2P2SubmitAcknowledgement(acknowledgement);
      setResult(acknowledgement);
      setMessage('SUBMITTED rev3 — STOP. PUBLISH requires separate execution.');
      onChanged();
    } catch (error) {
      setMessage(formatBatch2P2ResumeFailure(error, commandCrossedBoundary));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="survey-reconciliation-panel" aria-label="Batch 2 P2 resume and submit carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · BATCH 2 P2 · FRESH-SESSION RESUME</span>
          <h2>Resume the frozen Batch 2 at the SUBMIT boundary</h2>
          <p>This independent action re-reads every frozen canonical row from the authenticated server and fails closed before the incumbent revisioned command.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled={busy || commandAttempted || result !== null}>
          <legend>Exact server gate · one frozen SUBMIT</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Batch ID</dt><dd>{BATCH2_P2_RESUME_TARGET.batchId}</dd></div>
            <div><dt>Required state</dt><dd>DRAFT revision 2</dd></div>
            <div><dt>Required tasks</dt><dd>0 open / 2 draft-ready / 0 conflict</dd></div>
            <div><dt>Expected revision</dt><dd>{BATCH2_P2_RESUME_TARGET.expectedRevision}</dd></div>
            <div><dt>SUBMIT command</dt><dd>{BATCH2_P2_RESUME_TARGET.submitCommandId}</dd></div>
            <div><dt>Scope</dt><dd>FL115PLABOX + SB24/32/40LBOX only</dd></div>
          </dl>
          <button
            type="button"
            className="survey-reconciliation-primary"
            onClick={() => void resumeAndSubmitBatch2P2()}
          >
            {busy ? 'Reading exact gate and submitting…' : 'Read exact server gate, then submit Batch 2 P2'}
          </button>
        </fieldset>

        {preflight && evidence ? <fieldset className="survey-reconciliation-form" disabled>
          <legend>Verified server evidence</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Status</dt><dd>{preflight.batchStatus}</dd></div>
            <div><dt>Revision</dt><dd>{preflight.revision}</dd></div>
            <div><dt>Can submit</dt><dd>{String(preflight.canSubmit)}</dd></div>
            <div><dt>Tasks</dt><dd>{preflight.openTasks} / {preflight.draftReadyTasks} / {preflight.conflictTasks}</dd></div>
            <div><dt>Scope rows</dt><dd>{evidence.scopeItems.length}</dd></div>
            <div><dt>Reconciliations</dt><dd>{evidence.reconciliations.length}</dd></div>
            <div><dt>Observations</dt><dd>{evidence.observations.length}</dd></div>
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

      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
