import { useState } from 'react';
import type { Role } from '@/domain/types';
import {
  readCommercialWave2CanaryUnlockPreflight,
  unlockCommercialWave2Canary,
} from '@/data/repositories/commercialWave2CanaryUnlock';
import {
  COMMERCIAL_WAVE2_CANARY_UNLOCK_TARGET,
  assertCommercialWave2CanaryUnlockPreflight,
  assertCommercialWave2CanaryUnlockResult,
  formatCommercialWave2CanaryUnlockFailure,
  type CommercialWave2CanaryUnlockPreflight,
  type CommercialWave2CanaryUnlockResult,
} from './commercialWave2CanaryUnlockContract';

type Props = {
  role: Role;
  onChanged: () => void;
};

export function CommercialWave2PlanCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState<'P2A_PREFLIGHT' | 'P2A_UNLOCK' | null>(null);
  const [unlockAttempted, setUnlockAttempted] = useState(false);
  const [preflight, setPreflight] = useState<CommercialWave2CanaryUnlockPreflight | null>(null);
  const [result, setResult] = useState<CommercialWave2CanaryUnlockResult | null>(null);
  const [message, setMessage] = useState('P0 and P1 are complete. No P2A command has been sent from this session.');

  if (!authorized) return null;

  async function runP2APreflight() {
    setBusy('P2A_PREFLIGHT');
    setPreflight(null);
    setMessage('Reading authenticated post-P1 P2A evidence…');
    try {
      const evidence = await readCommercialWave2CanaryUnlockPreflight();
      assertCommercialWave2CanaryUnlockPreflight(evidence);
      setPreflight(evidence);
      setMessage('P2A preflight READY. Unlock remains a separate explicit command boundary.');
    } catch (error) {
      setMessage(formatCommercialWave2CanaryUnlockFailure(error, false));
    } finally {
      setBusy(null);
    }
  }

  async function runP2AUnlock() {
    let commandCrossedBoundary = false;
    setBusy('P2A_UNLOCK');
    setMessage('Calling the single frozen canary-eligibility unlock command…');
    try {
      if (!preflight) throw new Error('fresh post-P1 P2A preflight is required');
      assertCommercialWave2CanaryUnlockPreflight(preflight);
      commandCrossedBoundary = true;
      setUnlockAttempted(true);
      const acknowledgement = await unlockCommercialWave2Canary();
      assertCommercialWave2CanaryUnlockResult(acknowledgement);
      setResult(acknowledgement);
      setMessage('P2A CANARY ENABLED. No Commercial SKU was promoted. STOP before P2B.');
      onChanged();
    } catch (error) {
      setMessage(formatCommercialWave2CanaryUnlockFailure(error, commandCrossedBoundary));
    } finally {
      setBusy(null);
    }
  }

  const target = COMMERCIAL_WAVE2_CANARY_UNLOCK_TARGET;
  return (
    <section className="survey-reconciliation-panel" aria-label="Commercial Promotion Wave 2 staged execution carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · #338 COMMERCIAL PROMOTION WAVE 2</span>
          <h2>Post-PLAN canary eligibility carrier</h2>
          <p>P2A only enables canary eligibility. P2B promotion and P4 expansion remain separate and locked.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled aria-label="P0 complete read-only">
          <legend>P0 · SELECT-only preflight · COMPLETE</legend>
          <p>Historical authenticated evidence passed on protected main {target.carrierBaseSha}.</p>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled aria-label="P1 complete read-only">
          <legend>P1 · PLAN · COMPLETE</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Command</dt><dd>{target.planCommandId}</dd></div>
            <div><dt>State</dt><dd>PLANNED · 164 UNMATCHED · 0 enabled · 0 promoted</dd></div>
          </dl>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || unlockAttempted}>
          <legend>P2A · SELECT-only post-P1 preflight</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Cohort</dt><dd>{target.candidateCount} · {target.candidateSetSha256}</dd></div>
            <div><dt>Canary</dt><dd>{target.canaryExternalProductCode}</dd></div>
            <div><dt>Mapping</dt><dd>{target.canaryMappingId} · rev {target.canaryMappingRevision}</dd></div>
            <div><dt>Required current</dt><dd>1 PLAN · 0 unlock · 0 promotion · 0 enabled</dd></div>
          </dl>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void runP2APreflight()}>
            {busy === 'P2A_PREFLIGHT' ? 'Reading exact server evidence…' : 'Run P2A SELECT-only preflight'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || !preflight || unlockAttempted || result !== null}>
          <legend>P2A · CANARY UNLOCK · separate authorization required</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Frozen command</dt><dd>{target.unlockCommandId}</dd></div>
            <div><dt>Effect</dt><dd>Enable {target.canaryExternalProductCode} for promotion eligibility only</dd></div>
            <div><dt>Explicitly absent</dt><dd>No promotion, Commercial SKU, Physical SKU, package, barcode, image or quantity mutation</dd></div>
          </dl>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void runP2AUnlock()}>
            {busy === 'P2A_UNLOCK' ? 'Calling frozen canary unlock…' : 'Execute separately authorized P2A unlock'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled aria-label="P2B promotion locked">
          <legend>P2B · CANARY PROMOTION · LOCKED</legend>
          <p>No promotion action exists in P2A. A later carrier and explicit authorization are required.</p>
        </fieldset>
        <fieldset className="survey-reconciliation-form" disabled aria-label="P3 locked">
          <legend>P3 · CANARY SELECT-only verification · LOCKED</legend>
          <p>Locked until P2A and a separately authorized P2B complete.</p>
        </fieldset>
        <fieldset className="survey-reconciliation-form" disabled aria-label="P4 locked">
          <legend>P4 · 163-candidate expansion · LOCKED</legend>
          <p>Expansion cannot be unlocked or promoted from this carrier.</p>
        </fieldset>
      </div>

      {preflight ? <p className="survey-reconciliation-message">P2A preflight: {String(preflight.status)} · PLAN {String(preflight.planCommandCount)} · enabled {String(preflight.enabledCandidateCount)}</p> : null}
      {result ? <p className="survey-reconciliation-message">P2A: {String(result.status)} · command {String(result.commandId)} · promotion 0</p> : null}
      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
