import { useState } from 'react';
import type { Role } from '@/domain/types';
import { readCommercialWave2P4AReadiness } from '@/data/repositories/commercialWave2P4Readiness';
import {
  COMMERCIAL_WAVE2_P4A_TARGET,
  assertCommercialWave2P4AReadiness,
  formatCommercialWave2P4AReadinessFailure,
  type CommercialWave2P4AReadinessReport,
} from './commercialWave2P4ReadinessContract';

type Props = { role: Role };

export function CommercialWave2P4ReadinessCarrier({ role }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CommercialWave2P4AReadinessReport | null>(null);
  const [message, setMessage] = useState('P4A has not read production readiness evidence in this session.');

  if (!authorized) return null;

  async function runReadiness() {
    setBusy(true);
    setReport(null);
    setMessage('Reading caller-authenticated P4A expansion readiness only…');
    try {
      const evidence = await readCommercialWave2P4AReadiness();
      setReport(evidence);
      assertCommercialWave2P4AReadiness(evidence);
      setMessage('ECOFLOW-R3-P4A — PASS / 163_ELIGIBLE / READY_FOR_P4B_ENGINEERING / PRODUCTION_EXPANSION_NOT_AUTHORIZED');
    } catch (error) {
      setMessage(formatCommercialWave2P4AReadinessFailure(error));
    } finally {
      setBusy(false);
    }
  }

  const target = COMMERCIAL_WAVE2_P4A_TARGET;
  return (
    <section className="survey-reconciliation-panel" aria-label="Commercial Promotion Wave 2 P4A readiness-only carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · #338 COMMERCIAL PROMOTION WAVE 2</span>
          <h2>P4A expansion readiness-only</h2>
          <p>Authenticated SELECT-only evidence. No expansion enablement, promotion, provider action, inventory/Physical/image authority, caller switch, retirement or cutover control exists here.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled>
          <legend>P3 · CANARY VERIFIED · COMPLETE</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Canary</dt><dd>{target.canaryExternalProductCode}</dd></div>
            <div><dt>Commercial SKU</dt><dd>{target.canaryCommercialSkuId}</dd></div>
            <div><dt>Active Ordermentum mapping</dt><dd>{target.canaryActiveOrdermentumMappingId}</dd></div>
            <div><dt>Frozen cohort</dt><dd>{target.candidateSetSha256}</dd></div>
          </dl>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy}>
          <legend>P4A · SELECT-ONLY EXPANSION READINESS</legend>
          <p>Revalidates all 163 frozen expansion candidates against the same source/listing/no-collision rules used by bounded Commercial promotion.</p>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void runReadiness()}>
            {busy ? 'Reading P4A readiness evidence…' : 'Run authenticated P4A readiness-only'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled aria-label="P4B expansion execution locked">
          <legend>P4B · EXPANSION EXECUTION · LOCKED</legend>
          <p>The incumbent service-role expansion unlock is stale: it expects a test-only CANARY source-mapping MATCHED mutation that production P2B never performs. P4B must replace or revoke that legacy path before any production expansion authorization.</p>
        </fieldset>
      </div>

      {report ? (
        <>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Verdict</dt><dd>{report.verdict} · {report.status}</dd></div>
            <div><dt>Fresh verifier</dt><dd>{report.verifierRole} · {report.verifiedAt}</dd></div>
            <div><dt>P3 authority</dt><dd>{report.p3.verdict} · P4 locked {String(report.p3.p4Locked)} · {report.p3.providerStatus}</dd></div>
            <div><dt>Expansion cohort</dt><dd>{report.cohort.eligibleExpansionCount}/{report.cohort.expansionCandidateCount} eligible · enabled {report.cohort.enabledExpansionCount}</dd></div>
            <div><dt>Cohort hash</dt><dd>{report.cohort.recomputedCandidateSetSha256}</dd></div>
            <div><dt>Canary source mapping</dt><dd>{report.canary.sourceMappingId} · {report.canary.sourceMappingStatus} · rev {report.canary.sourceMappingRevision}</dd></div>
            <div><dt>Legacy P4 unlock</dt><dd>service-role execute {String(report.legacyExpansionUnlock.serviceRoleExecute)} · compatible {String(report.legacyExpansionUnlock.compatibleWithCurrentCanaryState)}</dd></div>
            <div><dt>Required next gate</dt><dd>{report.legacyExpansionUnlock.requiredNextGate}</dd></div>
            <div><dt>Production expansion</dt><dd>AUTHORIZED = {String(report.authority.productionExpansionAuthorized)}</dd></div>
          </dl>
          <details>
            <summary>Machine-readable P4A readiness report</summary>
            <pre>{JSON.stringify(report, null, 2)}</pre>
          </details>
        </>
      ) : null}
      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
