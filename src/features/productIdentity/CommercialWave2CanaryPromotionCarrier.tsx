import { useState } from 'react';
import type { Role } from '@/domain/types';
import {
  promoteCommercialWave2Canary,
  readCommercialWave2CanaryPromotionPreflight,
} from '@/data/repositories/commercialWave2CanaryPromotion';
import {
  COMMERCIAL_WAVE2_CANARY_PROMOTION_TARGET,
  assertCommercialWave2CanaryPromotionPreflight,
  assertCommercialWave2CanaryPromotionResult,
  formatCommercialWave2CanaryPromotionFailure,
  type CommercialWave2CanaryPromotionPreflight,
  type CommercialWave2CanaryPromotionResult,
} from './commercialWave2CanaryPromotionContract';

type Props = {
  role: Role;
  onChanged: () => void;
};

export function CommercialWave2CanaryPromotionCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState<'P2B_PREFLIGHT' | 'P2B_PROMOTION' | null>(null);
  const [promotionAttempted, setPromotionAttempted] = useState(false);
  const [preflight, setPreflight] = useState<CommercialWave2CanaryPromotionPreflight | null>(null);
  const [result, setResult] = useState<CommercialWave2CanaryPromotionResult | null>(null);
  const [message, setMessage] = useState('P2A is durably complete. No P2B promotion has been sent from this session.');

  if (!authorized) return null;

  async function runPreflight() {
    setBusy('P2B_PREFLIGHT');
    setPreflight(null);
    setMessage('Reading authenticated P2A completion and P2B canary evidence…');
    try {
      const evidence = await readCommercialWave2CanaryPromotionPreflight();
      assertCommercialWave2CanaryPromotionPreflight(evidence);
      setPreflight(evidence);
      setMessage('P2B preflight READY. Promotion remains a separate explicit command boundary.');
    } catch (error) {
      setMessage(formatCommercialWave2CanaryPromotionFailure(error, false));
    } finally {
      setBusy(null);
    }
  }

  async function runPromotion() {
    let commandCrossedBoundary = false;
    setBusy('P2B_PROMOTION');
    setMessage('Calling the single frozen canary promotion command…');
    try {
      if (!preflight) throw new Error('fresh post-P2A P2B preflight is required');
      assertCommercialWave2CanaryPromotionPreflight(preflight);
      commandCrossedBoundary = true;
      setPromotionAttempted(true);
      const acknowledgement = await promoteCommercialWave2Canary();
      assertCommercialWave2CanaryPromotionResult(acknowledgement);
      setResult(acknowledgement);
      setMessage('P2B CANARY PROMOTED. No Physical SKU or inventory authority was created. STOP before P3 verification.');
      onChanged();
    } catch (error) {
      setMessage(formatCommercialWave2CanaryPromotionFailure(error, commandCrossedBoundary));
    } finally {
      setBusy(null);
    }
  }

  const target = COMMERCIAL_WAVE2_CANARY_PROMOTION_TARGET;
  return (
    <section className="survey-reconciliation-panel" aria-label="Commercial Promotion Wave 2 P2B canary promotion carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · #338 COMMERCIAL PROMOTION WAVE 2</span>
          <h2>P2B canary promotion carrier</h2>
          <p>P2A eligibility is complete. This carrier can only promote frozen canary 140010; P3 and P4 remain locked.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled aria-label="P2A complete read-only">
          <legend>P2A · CANARY ELIGIBILITY · COMPLETE</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Unlock command</dt><dd>{target.unlockCommandId}</dd></div>
            <div><dt>Canary</dt><dd>{target.canaryExternalProductCode} · enabled</dd></div>
            <div><dt>Cohort</dt><dd>{target.candidateSetSha256}</dd></div>
          </dl>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || promotionAttempted}>
          <legend>P2B · SELECT-only post-P2A preflight</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Canary</dt><dd>{target.canaryExternalProductCode}</dd></div>
            <div><dt>Mapping</dt><dd>{target.canaryMappingId} · rev {target.canaryMappingRevision}</dd></div>
            <div><dt>Required current</dt><dd>1 unlock · 1 enabled · 0 promotion · 0 Commercial SKU 140010</dd></div>
          </dl>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void runPreflight()}>
            {busy === 'P2B_PREFLIGHT' ? 'Reading exact server evidence…' : 'Run P2B SELECT-only preflight'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || !preflight || promotionAttempted || result !== null}>
          <legend>P2B · CANARY PROMOTION · separate authorization boundary</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Frozen command</dt><dd>{target.promotionCommandId}</dd></div>
            <div><dt>Effect</dt><dd>Create Commercial SKU + Ordermentum external mapping for 140010 only</dd></div>
            <div><dt>Explicitly absent</dt><dd>No Physical SKU, family, package, barcode, image, inventory or expansion mutation</dd></div>
          </dl>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void runPromotion()}>
            {busy === 'P2B_PROMOTION' ? 'Calling frozen canary promotion…' : 'Execute separately authorized P2B canary promotion'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled aria-label="P3 verification locked">
          <legend>P3 · CANARY SELECT-only VERIFICATION · LOCKED</legend>
          <p>No P3 action exists in this carrier. P3 opens only after P2B is independently rehydrated and closed.</p>
        </fieldset>
        <fieldset className="survey-reconciliation-form" disabled aria-label="P4 expansion locked">
          <legend>P4 · 163-CANDIDATE EXPANSION · LOCKED</legend>
          <p>This carrier cannot unlock or promote any expansion candidate.</p>
        </fieldset>
      </div>

      {preflight ? <p className="survey-reconciliation-message">P2B preflight: {String(preflight.status)} · enabled {String(preflight.enabledCandidateCount)} · promotion {String(preflight.promotionCount)}</p> : null}
      {result ? <p className="survey-reconciliation-message">P2B: {String(result.status)} · command {String(result.commandId)} · promotion {String(result.promotionCount)}</p> : null}
      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
