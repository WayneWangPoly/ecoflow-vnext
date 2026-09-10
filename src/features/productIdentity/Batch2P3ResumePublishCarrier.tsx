import { useState } from 'react';
import type { Role } from '@/domain/types';
import { readBatch2P3ResumeEvidence } from '@/data/repositories/batch2P3ResumeEvidence';
import {
  publishProductIdentityBatch,
  readCurrentProductIdentityBatch,
  type ProductIdentityBatch,
  type ProductIdentityPublishResult,
} from '@/data/repositories/productIdentity';
import {
  BATCH2_P3_RESUME_TARGET,
  assertBatch2P3Postflight,
  assertBatch2P3Preflight,
  assertBatch2P3PublishAcknowledgement,
  buildBatch2P3PublishInput,
  formatBatch2P3ResumeFailure,
  type Batch2P3ResumeEvidence,
} from './batch2P3ResumePublishContract';

type Props = {
  role: Role;
  onChanged: () => void;
};

export function Batch2P3ResumePublishCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState(false);
  const [commandAttempted, setCommandAttempted] = useState(false);
  const [preflight, setPreflight] = useState<ProductIdentityBatch | null>(null);
  const [preflightEvidence, setPreflightEvidence] = useState<Batch2P3ResumeEvidence | null>(null);
  const [postflightEvidence, setPostflightEvidence] = useState<Batch2P3ResumeEvidence | null>(null);
  const [result, setResult] = useState<ProductIdentityPublishResult | null>(null);
  const [message, setMessage] = useState('No Batch 2 P3 command has been sent.');

  if (!authorized) return null;

  async function resumeAndPublishBatch2P3() {
    let commandCrossedBoundary = false;
    setBusy(true);
    setPreflight(null);
    setPreflightEvidence(null);
    setPostflightEvidence(null);
    setMessage('Reading the exact authenticated Batch 2 P3 server gate…');
    try {
      const currentBatch = await readCurrentProductIdentityBatch();
      const serverEvidence = await readBatch2P3ResumeEvidence('PRE');
      assertBatch2P3Preflight(currentBatch, serverEvidence);
      setPreflight(currentBatch);
      setPreflightEvidence(serverEvidence);

      const input = buildBatch2P3PublishInput();
      commandCrossedBoundary = true;
      setCommandAttempted(true);
      const acknowledgement = await publishProductIdentityBatch(input);
      assertBatch2P3PublishAcknowledgement(acknowledgement);

      const serverPostflight = await readBatch2P3ResumeEvidence('POST');
      assertBatch2P3Postflight(serverPostflight);
      setPostflightEvidence(serverPostflight);
      setResult(acknowledgement);
      setMessage('PUBLISHED rev4 with exact 2/2/2/2 acknowledgement and postflight — STOP.');
      onChanged();
    } catch (error) {
      setMessage(formatBatch2P3ResumeFailure(error, commandCrossedBoundary));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="survey-reconciliation-panel" aria-label="Batch 2 P3 resume and publish carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · BATCH 2 P3 · FRESH-SESSION RESUME</span>
          <h2>Resume the frozen Batch 2 at the PUBLISH boundary</h2>
          <p>This independent action re-reads the frozen canonical graph and quantity-isolation sentinels from the authenticated server before one terminal command attempt.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled={busy || commandAttempted || result !== null}>
          <legend>Exact server gate · one frozen PUBLISH</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Batch ID</dt><dd>{BATCH2_P3_RESUME_TARGET.batchId}</dd></div>
            <div><dt>Required state</dt><dd>SUBMITTED revision 3</dd></div>
            <div><dt>Existing SUBMIT</dt><dd>{BATCH2_P3_RESUME_TARGET.submitCommandId}</dd></div>
            <div><dt>PUBLISH command</dt><dd>{BATCH2_P3_RESUME_TARGET.publishCommandId}</dd></div>
            <div><dt>Scope</dt><dd>FL115PLABOX + SB24/32/40LBOX only</dd></div>
            <div><dt>Expected result</dt><dd>PUBLISHED revision 4 · 2/2/2/2</dd></div>
          </dl>
          <button
            type="button"
            className="survey-reconciliation-primary"
            onClick={() => void resumeAndPublishBatch2P3()}
          >
            {busy ? 'Reading exact gate and publishing…' : 'Read exact server gate, then publish Batch 2 P3'}
          </button>
        </fieldset>

        {preflight && preflightEvidence ? <fieldset className="survey-reconciliation-form" disabled>
          <legend>Verified preflight</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Status</dt><dd>{preflight.batchStatus}</dd></div>
            <div><dt>Revision</dt><dd>{preflight.revision}</dd></div>
            <div><dt>Can publish</dt><dd>{String(preflight.canPublish)}</dd></div>
            <div><dt>Scope / observations</dt><dd>{preflightEvidence.scopeItems.length} / {preflightEvidence.observations.length}</dd></div>
            <div><dt>DRAFT graph</dt><dd>{preflightEvidence.families.length} families / {preflightEvidence.physicalSkus.length} Physical / {preflightEvidence.packages.length} packages / {preflightEvidence.barcodeBindings.length} barcodes / {preflightEvidence.commercialFamilyLinks.length} links</dd></div>
            <div><dt>Quantity sentinels</dt><dd>0 / 0 / 0 / 0 / 0</dd></div>
          </dl>
        </fieldset> : null}

        {result && postflightEvidence ? <fieldset className="survey-reconciliation-form" disabled>
          <legend>PUBLISH acknowledgement and postflight</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Batch ID</dt><dd>{result.batchId}</dd></div>
            <div><dt>Status / revision</dt><dd>{result.batchStatus} / {result.revision}</dd></div>
            <div><dt>Command</dt><dd>{result.commandStatus}</dd></div>
            <div><dt>Published graph</dt><dd>{result.publishedFamilies} / {result.publishedPhysicalSkus} / {result.publishedBarcodes} / {result.publishedLinks}</dd></div>
            <div><dt>Resolved tasks</dt><dd>{postflightEvidence.tasks.length}</dd></div>
            <div><dt>Published at</dt><dd>{result.publishedAt}</dd></div>
          </dl>
        </fieldset> : null}
      </div>

      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
