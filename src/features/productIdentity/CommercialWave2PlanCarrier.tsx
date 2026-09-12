import { useState } from 'react';
import type { Role } from '@/domain/types';
import {
  planCommercialWave2,
  readCommercialWave2PlanPreflight,
} from '@/data/repositories/commercialWave2Plan';
import {
  COMMERCIAL_WAVE2_PLAN_TARGET,
  assertCommercialWave2PlanPreflight,
  assertCommercialWave2PlanResult,
  formatCommercialWave2PlanFailure,
  type CommercialWave2PlanPreflight,
  type CommercialWave2PlanResult,
} from './commercialWave2PlanContract';

type Props = {
  role: Role;
  onChanged: () => void;
};

export function CommercialWave2PlanCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState<'P0' | 'P1' | null>(null);
  const [planAttempted, setPlanAttempted] = useState(false);
  const [preflight, setPreflight] = useState<CommercialWave2PlanPreflight | null>(null);
  const [result, setResult] = useState<CommercialWave2PlanResult | null>(null);
  const [message, setMessage] = useState('No Wave-2 PLAN command has been sent.');

  if (!authorized) return null;

  async function runP0() {
    setBusy('P0');
    setPreflight(null);
    setMessage('Running authenticated SELECT-only Wave-2 P0…');
    try {
      const evidence = await readCommercialWave2PlanPreflight();
      assertCommercialWave2PlanPreflight(evidence);
      setPreflight(evidence);
      setMessage('P0 READY. P1 remains a separate, explicitly authorized command boundary.');
    } catch (error) {
      setMessage(formatCommercialWave2PlanFailure(error, false));
    } finally {
      setBusy(null);
    }
  }

  async function runP1() {
    let commandCrossedBoundary = false;
    setBusy('P1');
    setMessage('Calling the single frozen Wave-2 PLAN command…');
    try {
      if (!preflight) throw new Error('fresh P0 preflight is required');
      assertCommercialWave2PlanPreflight(preflight);
      commandCrossedBoundary = true;
      setPlanAttempted(true);
      const acknowledgement = await planCommercialWave2();
      assertCommercialWave2PlanResult(acknowledgement);
      setResult(acknowledgement);
      setMessage('P1 PLANNED. STOP before canary unlock or promotion.');
      onChanged();
    } catch (error) {
      setMessage(formatCommercialWave2PlanFailure(error, commandCrossedBoundary));
    } finally {
      setBusy(null);
    }
  }

  const target = COMMERCIAL_WAVE2_PLAN_TARGET;
  return (
    <section className="survey-reconciliation-panel" aria-label="Commercial Promotion Wave 2 staged execution carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · #338 COMMERCIAL PROMOTION WAVE 2</span>
          <h2>Fresh-session staged command carrier</h2>
          <p>P0–P4 are separate boundaries. P0 is SELECT-only; P1 never unlocks or promotes; P2–P4 remain locked for later packages.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled={busy !== null || planAttempted}>
          <legend>P0 · SELECT-only preflight</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Protected main</dt><dd>{target.protectedMainSha}</dd></div>
            <div><dt>Cohort</dt><dd>{target.candidateCount} · {target.candidateSetSha256}</dd></div>
            <div><dt>Canary</dt><dd>{target.canaryExternalProductCode}</dd></div>
            <div><dt>Required gate</dt><dd>164 eligible · 0 enabled · 0 PLAN/unlock/promotion commands</dd></div>
          </dl>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void runP0()}>
            {busy === 'P0' ? 'Reading exact server evidence…' : 'Run P0 SELECT-only preflight'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || !preflight || planAttempted || result !== null}>
          <legend>P1 · PLAN · separate authorization required</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Frozen command</dt><dd>{target.planCommandId}</dd></div>
            <div><dt>Expected current</dt><dd>all 164 UNMATCHED and disabled</dd></div>
            <div><dt>Expected result</dt><dd>PLANNED · 0 enabled · 0 promoted</dd></div>
            <div><dt>Side effects</dt><dd>No image, Physical, package, barcode, inventory, SOH or location authority</dd></div>
          </dl>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void runP1()}>
            {busy === 'P1' ? 'Calling frozen PLAN…' : 'Execute separately authorized P1 PLAN'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled aria-label="P2 locked">
          <legend>P2 · CANARY UNLOCK / PROMOTION</legend>
          <p>LOCKED. Separate commands and a later explicit authorization are required for canary {target.canaryExternalProductCode}.</p>
        </fieldset>
        <fieldset className="survey-reconciliation-form" disabled aria-label="P3 locked">
          <legend>P3 · CANARY SELECT-only verification</legend>
          <p>LOCKED until P2 completes. This stage must not issue a mutation command.</p>
        </fieldset>
        <fieldset className="survey-reconciliation-form" disabled aria-label="P4 locked">
          <legend>P4 · 163-candidate expansion</legend>
          <p>LOCKED until exact canary promotion and fresh exact-match PLAN evidence pass the server gate.</p>
        </fieldset>
      </div>

      {preflight ? <p className="survey-reconciliation-message">P0: {String(preflight.status)} · eligible {String(preflight.eligibleCandidateCount)} · enabled {String(preflight.enabledCandidateCount)}</p> : null}
      {result ? <p className="survey-reconciliation-message">P1: {String(result.status)} · command {String(result.commandId)}</p> : null}
      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
