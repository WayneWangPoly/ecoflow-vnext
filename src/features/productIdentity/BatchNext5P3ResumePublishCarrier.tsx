import { useState } from 'react';
import type { Role } from '@/domain/types';
import { readBatchNext5P3ResumeEvidence } from '@/data/repositories/batchNext5P3ResumeEvidence';
import {
  publishProductIdentityBatch,
  readCurrentProductIdentityBatch,
  type ProductIdentityBatch,
  type ProductIdentityPublishResult,
} from '@/data/repositories/productIdentity';
import {
  BATCH_NEXT5_P3_TARGET,
  assertBatchNext5P3Postflight,
  assertBatchNext5P3Preflight,
  assertBatchNext5P3PublishAcknowledgement,
  buildBatchNext5P3PublishInput,
  formatBatchNext5P3Failure,
  type BatchNext5P3Evidence,
} from './batchNext5P3ResumePublishContract';

type Props = { role: Role; onChanged: () => void };

export function BatchNext5P3ResumePublishCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState(false);
  const [commandAttempted, setCommandAttempted] = useState(false);
  const [preflight, setPreflight] = useState<ProductIdentityBatch | null>(null);
  const [preflightEvidence, setPreflightEvidence] = useState<BatchNext5P3Evidence | null>(null);
  const [postflightEvidence, setPostflightEvidence] = useState<BatchNext5P3Evidence | null>(null);
  const [result, setResult] = useState<ProductIdentityPublishResult | null>(null);
  const [message, setMessage] = useState('No Batch Next 5 P3 PUBLISH command has been sent.');

  if (!authorized) return null;

  async function resumeAndPublish() {
    let commandCrossedBoundary = false;
    setBusy(true);
    setPreflight(null);
    setPreflightEvidence(null);
    setPostflightEvidence(null);
    setMessage('Reading the exact authenticated eight-SKU PUBLISH gate…');

    try {
      const currentBatch = await readCurrentProductIdentityBatch();
      const serverEvidence = await readBatchNext5P3ResumeEvidence('PRE');
      assertBatchNext5P3Preflight(currentBatch, serverEvidence);
      setPreflight(currentBatch);
      setPreflightEvidence(serverEvidence);

      const input = buildBatchNext5P3PublishInput();
      commandCrossedBoundary = true;
      setCommandAttempted(true);
      const acknowledgement = await publishProductIdentityBatch(input);
      assertBatchNext5P3PublishAcknowledgement(acknowledgement);

      const postflight = await readBatchNext5P3ResumeEvidence('POST');
      assertBatchNext5P3Postflight(postflight);
      setPostflightEvidence(postflight);
      setResult(acknowledgement);
      setMessage('PUBLISHED rev10 with exact 8/8/8/8 acknowledgement and postflight — STOP.');
      onChanged();
    } catch (error) {
      setMessage(formatBatchNext5P3Failure(error, commandCrossedBoundary));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="survey-reconciliation-panel" aria-label="ECOFLOW-328 Batch Next 5 P3 publish-only carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · EIGHT-SKU PUBLISH-ONLY AUTHORITY</span>
          <h2>ECOFLOW-328 · Batch Next 5 P3 PUBLISH gate</h2>
          <p>Frozen to one SUBMITTED rev9 production batch. It re-reads the complete canonical DRAFT graph and quantity-isolation sentinels before exactly one incumbent PUBLISH attempt, then performs an authenticated postflight.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled={busy || commandAttempted || result !== null}>
          <legend>Exact server gate · one frozen PUBLISH</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Protected main</dt><dd>{BATCH_NEXT5_P3_TARGET.protectedMainSha}</dd></div>
            <div><dt>Batch ID</dt><dd>{BATCH_NEXT5_P3_TARGET.batchId}</dd></div>
            <div><dt>Required state</dt><dd>SUBMITTED revision 9</dd></div>
            <div><dt>Existing SUBMIT</dt><dd>{BATCH_NEXT5_P3_TARGET.submitCommandId}</dd></div>
            <div><dt>PUBLISH command</dt><dd>{BATCH_NEXT5_P3_TARGET.publishCommandId}</dd></div>
            <div><dt>Frozen scope</dt><dd>{Object.keys(BATCH_NEXT5_P3_TARGET.identities).join(' / ')}</dd></div>
            <div><dt>Expected result</dt><dd>PUBLISHED revision 10 · 8/8/8/8</dd></div>
          </dl>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void resumeAndPublish()}>
            {busy ? 'Reading exact gate and publishing…' : 'Read exact server gate, then PUBLISH eight-SKU batch'}
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
