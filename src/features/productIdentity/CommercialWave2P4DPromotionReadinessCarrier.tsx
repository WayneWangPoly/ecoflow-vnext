import { useState } from 'react';
import type { Role } from '@/domain/types';
import { readCommercialWave2P4DPromotionReadiness } from '@/data/repositories/commercialWave2P4DPromotionReadiness';
import {
  COMMERCIAL_WAVE2_P4D_TARGET,
  assertCommercialWave2P4DPromotionReadiness,
  formatCommercialWave2P4DReadinessFailure,
  type CommercialWave2P4DPromotionReadinessReport,
} from './commercialWave2P4DPromotionReadinessContract';

type Props = { role: Role };

export function CommercialWave2P4DPromotionReadinessCarrier({ role }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CommercialWave2P4DPromotionReadinessReport | null>(null);
  const [message, setMessage] = useState('P4D has not read promotion readiness evidence in this session.');

  if (!authorized) return null;

  async function runReadiness() {
    setBusy(true);
    setReport(null);
    setMessage('Reading caller-authenticated P4D promotion readiness only…');
    try {
      const evidence = await readCommercialWave2P4DPromotionReadiness();
      setReport(evidence);
      assertCommercialWave2P4DPromotionReadiness(evidence);
      setMessage('ECOFLOW-R3-P4D — PASS / 163_PROMOTION_ELIGIBLE / 7_BATCH_PLAN_FROZEN / READY_FOR_P4E_ENGINEERING / PRODUCTION_PROMOTION_NOT_AUTHORIZED');
    } catch (error) {
      setMessage(formatCommercialWave2P4DReadinessFailure(error));
    } finally {
      setBusy(false);
    }
  }

  const target = COMMERCIAL_WAVE2_P4D_TARGET;
  return (
    <section className="survey-reconciliation-panel" aria-label="Commercial Promotion Wave 2 P4D promotion readiness-only carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · #338 COMMERCIAL PROMOTION WAVE 2</span>
          <h2>P4D promotion authority + batch readiness</h2>
          <p>Authenticated SELECT-only evidence. P4C is closed; legacy service-role promotion is revoked; the caller-authenticated replacement remains dormant.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled>
          <legend>P4C · 163 ENABLED · COMPLETE</legend>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Frozen cohort</dt><dd>{target.candidateSetSha256}</dd></div>
            <div><dt>Expansion candidates</dt><dd>{target.expansionCount}</dd></div>
          </dl>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy}>
          <legend>P4D · SELECT-ONLY PROMOTION READINESS</legend>
          <p>Revalidates all 163 enabled candidates, closes stale promotion authority, and freezes seven deterministic promotion batches. No SKU is created here.</p>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void runReadiness()}>
            {busy ? 'Reading P4D promotion readiness…' : 'Run authenticated P4D promotion readiness-only'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled aria-label="P4E promotion execution locked">
          <legend>P4E · BATCH PROMOTION EXECUTION · LOCKED</legend>
          <p>No authenticated promotion execution grant or batch mutation control exists in P4D. P4E must be separately engineered, reviewed, activated and authorized.</p>
        </fieldset>
      </div>

      {report ? (
        <>
          <dl className="survey-reconciliation-evidence survey-reconciliation-note">
            <div><dt>Verdict</dt><dd>{report.verdict} · {report.status}</dd></div>
            <div><dt>Fresh verifier</dt><dd>{report.verifierRole} · {report.verifiedAt}</dd></div>
            <div><dt>Promotion cohort</dt><dd>{report.cohort.eligibleForPromotionCount}/{report.cohort.expansionCandidateCount} eligible · enabled {report.cohort.enabledExpansionCount}</dd></div>
            <div><dt>Promotion lineage</dt><dd>promotions {report.cohort.nonCanaryPromotionCount} · commands {report.cohort.nonCanaryPromotionCommandCount}</dd></div>
            <div><dt>P4C closure</dt><dd>unlock {report.p4c.unlockCount} · command {report.p4c.unlockCommandCount} · audit {report.p4c.auditCount}</dd></div>
            <div><dt>Legacy promotion authority</dt><dd>service-role {String(report.authority.legacyServiceRoleExecute)} · authenticated {String(report.authority.legacyAuthenticatedExecute)}</dd></div>
            <div><dt>P4C mutation authority</dt><dd>authenticated {String(report.authority.p4cAuthenticatedExecute)}</dd></div>
            <div><dt>P4D replacement</dt><dd>authenticated {String(report.authority.v2AuthenticatedExecute)} · service-role {String(report.authority.v2ServiceRoleExecute)}</dd></div>
            <div><dt>Batch plan</dt><dd>{report.batchPlan.batchCount} batches · size {report.batchPlan.batchSize} · {report.batchPlan.promotionPlanSha256}</dd></div>
            <div><dt>Production promotion</dt><dd>AUTHORIZED = {String(report.authority.productionPromotionAuthorized)}</dd></div>
          </dl>
          <div className="survey-reconciliation-note">
            {report.batchPlan.batches.map((batch) => (
              <p key={batch.batchNo}>Batch {batch.batchNo}: {batch.candidateCount} · {batch.firstCode} → {batch.lastCode} · {batch.batchSha256}</p>
            ))}
          </div>
          <details>
            <summary>Machine-readable P4D promotion readiness report</summary>
            <pre>{JSON.stringify(report, null, 2)}</pre>
          </details>
        </>
      ) : null}
      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
