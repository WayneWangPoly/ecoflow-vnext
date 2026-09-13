import { useState } from 'react';
import type { Role } from '@/domain/types';
import { readCommercialWave2P3Verification } from '@/data/repositories/commercialWave2CanaryVerification';
import {
  COMMERCIAL_WAVE2_P3_TARGET,
  assertCommercialWave2P3VerificationReport,
  formatCommercialWave2P3VerificationFailure,
  type CommercialWave2P3VerificationReport,
} from './commercialWave2CanaryVerificationContract';

type Props = { role: Role };

export function CommercialWave2CanaryVerificationCarrier({ role }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CommercialWave2P3VerificationReport | null>(null);
  const [message, setMessage] = useState('P3 has not read production evidence in this session.');

  if (!authorized) return null;

  async function runVerification() {
    setBusy(true);
    setReport(null);
    setMessage('Reading authenticated production evidence through the P3 verification-only boundary…');
    try {
      const evidence = await readCommercialWave2P3Verification();
      setReport(evidence);
      assertCommercialWave2P3VerificationReport(evidence);
      setMessage('ECOFLOW-R3-P3 — PASS / CANARY_VERIFIED / HOLD_AT_P4');
    } catch (error) {
      setMessage(formatCommercialWave2P3VerificationFailure(error));
    } finally {
      setBusy(false);
    }
  }

  const target = COMMERCIAL_WAVE2_P3_TARGET;
  return (
    <section className="survey-reconciliation-panel" aria-label="Commercial Promotion Wave 2 P3 verification-only carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · #338 COMMERCIAL PROMOTION WAVE 2</span>
          <h2>P3 verification-only</h2>
          <p>Authenticated production reads only. This carrier has no edit, command replay, repair, reconciliation, publish, or P4 control.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled>
          <legend>P2B · FROZEN COMPLETION LINEAGE</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Command</dt><dd>{target.promotionCommandId}</dd></div>
            <div><dt>Canary</dt><dd>{target.canaryExternalProductCode}</dd></div>
            <div><dt>Commercial SKU</dt><dd>{target.commercialSkuId}</dd></div>
            <div><dt>Ordermentum mapping</dt><dd>{target.activeOrdermentumMappingId}</dd></div>
          </dl>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy}>
          <legend>P3 · AUTHENTICATED PRODUCTION READ</legend>
          <p>Reads identity, mapping, source provenance, ledger, audit, negative space, and side-effect sentinels. It performs no business write.</p>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void runVerification()}>
            {busy ? 'Reading independent production evidence…' : 'Run authenticated P3 verification-only'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled aria-label="P4 expansion locked">
          <legend>P4 · 163-CANDIDATE EXPANSION · LOCKED</legend>
          <p>No expansion candidate selection, enablement, command, provider traffic, caller switch, or cutover exists in this carrier.</p>
        </fieldset>
      </div>

      {report ? (
        <>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Verdict</dt><dd>{report.verdict} · {report.stage}</dd></div>
            <div><dt>Fresh verifier</dt><dd>{report.verifierRole} · {report.verifiedAt}</dd></div>
            <div><dt>Commercial SKU</dt><dd>{report.identity.code} · {report.identity.id} · {report.identity.setupStatus}</dd></div>
            <div><dt>Active mapping</dt><dd>{report.mapping.provider} · {report.mapping.id} · count {report.mapping.count}</dd></div>
            <div><dt>Source provenance</dt><dd>{report.provenance.id} · rev {report.provenance.revision} · {report.provenance.sourcePayloadSha256}</dd></div>
            <div><dt>Ledger</dt><dd>command {report.lineage.commandCount} · promotion {report.lineage.promotionCount} · replayed {String(report.lineage.initialReplayed)}</dd></div>
            <div><dt>Audit</dt><dd>{report.audit.event} · {report.audit.actorRole} · {report.audit.id}</dd></div>
            <div><dt>Negative space</dt><dd>P4 enabled {report.negativeSpace.p4EnabledCandidates} · non-canary {report.negativeSpace.nonCanaryPromotions}</dd></div>
            <div><dt>Authority</dt><dd>bounded Commercial identity only · no production business mutation</dd></div>
          </dl>
          <details>
            <summary>Machine-readable P3 verification report</summary>
            <pre>{JSON.stringify(report, null, 2)}</pre>
          </details>
        </>
      ) : null}
      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
