import { useState } from 'react';
import type { Role } from '@/domain/types';
import { readBatchNext2P3ResumeEvidence } from '@/data/repositories/batchNext2P3ResumeEvidence';
import {
  publishProductIdentityBatch,
  readCurrentProductIdentityBatch,
  type ProductIdentityBatch,
  type ProductIdentityPublishResult,
} from '@/data/repositories/productIdentity';
import {
  BATCH_NEXT2_P3_TARGET,
  assertBatchNext2P3Postflight,
  assertBatchNext2P3Preflight,
  assertBatchNext2P3PublishAcknowledgement,
  buildBatchNext2P3PublishInput,
  formatBatchNext2P3Failure,
  type BatchNext2P3Evidence,
} from './batchNext2P3ResumePublishContract';

type Props = { role: Role; onChanged: () => void };

export function BatchNext2P3ResumePublishCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState(false);
  const [commandAttempted, setCommandAttempted] = useState(false);
  const [preflight, setPreflight] = useState<ProductIdentityBatch | null>(null);
  const [preflightEvidence, setPreflightEvidence] = useState<BatchNext2P3Evidence | null>(null);
  const [postflightEvidence, setPostflightEvidence] = useState<BatchNext2P3Evidence | null>(null);
  const [result, setResult] = useState<ProductIdentityPublishResult | null>(null);
  const [message, setMessage] = useState('No Batch Next 2 P3 PUBLISH command has been sent.');

  if (!authorized) return null;

  async function resumeAndPublish() {
    let commandCrossedBoundary = false;
    setBusy(true);
    setPreflight(null);
    setPreflightEvidence(null);
    setPostflightEvidence(null);
    setMessage('Reading the exact authenticated ten-SKU PUBLISH gate…');

    try {
      const currentBatch = await readCurrentProductIdentityBatch();
      const serverEvidence = await readBatchNext2P3ResumeEvidence('PRE');
      assertBatchNext2P3Preflight(currentBatch, serverEvidence);
      setPreflight(currentBatch);
      setPreflightEvidence(serverEvidence);

      const input = buildBatchNext2P3PublishInput();
      commandCrossedBoundary = true;
      setCommandAttempted(true);
      const acknowledgement = await publishProductIdentityBatch(input);
      assertBatchNext2P3PublishAcknowledgement(acknowledgement);

      const postflight = await readBatchNext2P3ResumeEvidence('POST');
      assertBatchNext2P3Postflight(postflight);
      setPostflightEvidence(postflight);
      setResult(acknowledgement);
      setMessage('PUBLISHED rev12 with exact 10/10/10/10 acknowledgement and postflight — STOP.');
      onChanged();
    } catch (error) {
      setMessage(formatBatchNext2P3Failure(error, commandCrossedBoundary));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="survey-reconciliation-panel" aria-label="ECOFLOW-328 Batch Next 2 P3 publish-only carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · TEN-SKU PUBLISH-ONLY AUTHORITY</span>
          <h2>ECOFLOW-328 · Batch Next 2 P3 PUBLISH gate</h2>
          <p>Frozen to one SUBMITTED rev11 production batch. It re-reads the complete canonical DRAFT graph and quantity-isolation sentinels before exactly one incumbent PUBLISH attempt, then performs an authenticated postflight.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled={busy || commandAttempted || result !== null}>
          <legend>Exact server gate · one frozen PUBLISH</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Protected main</dt><dd>{BATCH_NEXT2_P3_TARGET.protectedMainSha}</dd></div>
            <div><dt>Batch ID</dt><dd>{BATCH_NEXT2_P3_TARGET.batchId}</dd></div>
            <div><dt>Required state</dt><dd>SUBMITTED revision 11</dd></div>
            <div><dt>Existing SUBMIT</dt><dd>{BATCH_NEXT2_P3_TARGET.submitCommandId}</dd></div>
            <div><dt>PUBLISH command</dt><dd>{BATCH_NEXT2_P3_TARGET.publishCommandId}</dd></div>
            <div><dt>Frozen scope</dt><dd>{Object.keys(BATCH_NEXT2_P3_TARGET.identities).join(' / ')}</dd></div>
            <div><dt>Expected result</dt><dd>PUBLISHED revision 12 · 10/10/10/10</dd></div>
          </dl>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void resumeAndPublish()}>
            {busy ? 'Reading exact gate and publishing…' : 'Read exact server gate, then PUBLISH ten-SKU batch'}
          </button>
        </fieldset>

        {preflight && preflightEvidence ? <fieldset className="survey-reconciliation-form" disabled>
          <legend>Verified preflight</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Status / revision</dt><dd>{preflight.batchStatus} / {preflight.revision}</dd></div>
            <div><dt>Can publish</dt><dd>{String(preflight.canPublish)}</dd></div>
            <div><dt>Tasks</dt><dd>{preflight.openTasks} open / {preflight.draftReadyTasks} draft-ready / {preflight.conflictTasks} conflict / {preflight.resolvedTasks} resolved</dd></div>
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

      <div className="unleashed-acceptance-warning" role="note">
        <strong>PUBLISH-only hard stop.</strong> This carrier imports no START, RECONCILE, SUBMIT, barcode-reassignment, inventory, stocktake, location or provider action.
      </div>
      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
