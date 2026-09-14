import { useState } from 'react';
import type { Role } from '@/domain/types';
import {
  executeCommercialWave2P4CExpansion,
  readCommercialWave2P4CActivation,
} from '@/data/repositories/commercialWave2P4Expansion';
import {
  COMMERCIAL_WAVE2_P4C_TARGET,
  assertCommercialWave2P4CActivation,
  assertCommercialWave2P4CExpansionResult,
  formatCommercialWave2P4CFailure,
  type CommercialWave2P4CActivationReport,
  type CommercialWave2P4CExpansionResult,
} from './commercialWave2P4ExpansionContract';

type Props = {
  role: Role;
  onChanged: () => void;
};

export function CommercialWave2P4ExpansionCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState<'PREFLIGHT' | 'EXECUTE' | null>(null);
  const [preflight, setPreflight] = useState<CommercialWave2P4CActivationReport | null>(null);
  const [result, setResult] = useState<CommercialWave2P4CExpansionResult | null>(null);
  const [executionAttempted, setExecutionAttempted] = useState(false);
  const [message, setMessage] = useState('P4C production expansion has not been executed from this session.');

  if (!authorized) return null;

  async function runPreflight() {
    setBusy('PREFLIGHT');
    setPreflight(null);
    setResult(null);
    setMessage('Reading caller-authenticated P4C activation and frozen 163-row readiness…');
    try {
      const evidence = await readCommercialWave2P4CActivation();
      assertCommercialWave2P4CActivation(evidence);
      setPreflight(evidence);
      setMessage('P4C preflight PASS. The 163-row unlock remains a separate explicit command boundary.');
    } catch (error) {
      setMessage(formatCommercialWave2P4CFailure(error, false));
    } finally {
      setBusy(null);
    }
  }

  async function runExpansion() {
    let crossed = false;
    try {
      if (!preflight) throw new Error('fresh P4C activation preflight is required');
      assertCommercialWave2P4CActivation(preflight);
      const confirmed = window.confirm(
        'Authorize ECOFLOW-R3-P4C to enable exactly 163 frozen EXPANSION candidates? This does NOT create Commercial SKUs or call a provider. Continue?',
      );
      if (!confirmed) {
        setMessage('P4C execution cancelled before the production command boundary.');
        return;
      }

      setBusy('EXECUTE');
      setExecutionAttempted(true);
      setMessage('Calling the frozen caller-authenticated P4C expansion command…');
      crossed = true;
      const acknowledgement = await executeCommercialWave2P4CExpansion();
      assertCommercialWave2P4CExpansionResult(acknowledgement);
      setResult(acknowledgement);
      setMessage('ECOFLOW-R3-P4C — PASS / 163_ENABLED / HOLD_BEFORE_NON_CANARY_PROMOTION');
      onChanged();
    } catch (error) {
      setMessage(formatCommercialWave2P4CFailure(error, crossed));
    } finally {
      setBusy(null);
    }
  }

  const target = COMMERCIAL_WAVE2_P4C_TARGET;
  return (
    <section className="survey-reconciliation-panel" aria-label="Commercial Promotion Wave 2 P4C authenticated expansion carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · #338 COMMERCIAL PROMOTION WAVE 2</span>
          <h2>P4C authenticated 163-candidate expansion unlock</h2>
          <p>Caller-authenticated bounded production mutation. Enables the frozen EXPANSION candidates only; it creates no Commercial SKU, external mapping, provider traffic, Physical authority or inventory authority.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled>
          <legend>P4B · AUTHORITY REPLACEMENT · COMPLETE</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Legacy path</dt><dd>revoked</dd></div>
            <div><dt>New authority</dt><dd>authenticated OWNER/ADMIN only</dd></div>
            <div><dt>Frozen cohort</dt><dd>{target.candidateSetSha256}</dd></div>
          </dl>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || executionAttempted}>
          <legend>P4C · AUTHENTICATED ACTIVATION PREFLIGHT</legend>
          <p>Requires legacy authority revoked, v2 service-role/anon denied, v2 authenticated enabled, 163/163 still eligible, enabled 0, and zero prior expansion command/unlock.</p>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void runPreflight()}>
            {busy === 'PREFLIGHT' ? 'Reading P4C activation evidence…' : 'Run authenticated P4C preflight'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy !== null || !preflight || executionAttempted || result !== null}>
          <legend>P4C · ENABLE EXACTLY 163 EXPANSION CANDIDATES</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Frozen command</dt><dd>{target.commandId}</dd></div>
            <div><dt>Effect</dt><dd>EXPANSION candidate enabled false → true, exactly 163 rows</dd></div>
            <div><dt>Explicitly absent</dt><dd>No promotion, SKU creation, provider call, Physical/package/barcode, inventory/SOH/location or image mutation</dd></div>
          </dl>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void runExpansion()}>
            {busy === 'EXECUTE' ? 'Executing frozen 163-row unlock…' : 'Execute authorized P4C: enable exactly 163 candidates'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled>
          <legend>NEXT · NON-CANARY PROMOTION · LOCKED</legend>
          <p>No non-CANARY promotion control exists here. STOP after P4C and independently verify the 163-row unlock before any promotion stage.</p>
        </fieldset>
      </div>

      {preflight ? (
        <p className="survey-reconciliation-message">
          P4C preflight: {preflight.verdict} · eligible {preflight.cohort.eligibleExpansionCount} · enabled {preflight.cohort.enabledExpansionCount} · authenticated authority {String(preflight.authority.v2AuthenticatedExecute)}
        </p>
      ) : null}
      {result ? (
        <>
          <p className="survey-reconciliation-message">P4C result: unlocked {result.unlockedCandidateCount} · replayed {String(result.replayed)} · promotion {String(result.promotionIncluded)}</p>
          <details>
            <summary>Machine-readable P4C expansion result</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </>
      ) : null}
      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
