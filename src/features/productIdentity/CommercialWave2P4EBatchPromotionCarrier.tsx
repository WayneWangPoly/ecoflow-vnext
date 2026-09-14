import { useState } from 'react';
import type { Role } from '@/domain/types';
import {
  executeCommercialWave2P4EBatch,
  readCommercialWave2P4EBatchGate,
  verifyCommercialWave2P4EBatch,
} from '@/data/repositories/commercialWave2P4EBatchPromotion';
import {
  COMMERCIAL_WAVE2_P4E_PLAN,
  assertCommercialWave2P4EBatchExecution,
  assertCommercialWave2P4EBatchGate,
  assertCommercialWave2P4EPostflight,
  formatCommercialWave2P4EFailure,
  type CommercialWave2P4EBatchExecutionResult,
  type CommercialWave2P4EBatchGateReport,
  type CommercialWave2P4EPostflightResult,
} from './commercialWave2P4EBatchPromotionContract';

type Props = {
  role: Role;
  onChanged?: () => void;
};

export function CommercialWave2P4EBatchPromotionCarrier({ role, onChanged }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<CommercialWave2P4EBatchGateReport | null>(null);
  const [execution, setExecution] = useState<CommercialWave2P4EBatchExecutionResult | null>(null);
  const [postflight, setPostflight] = useState<CommercialWave2P4EPostflightResult | null>(null);
  const [message, setMessage] = useState('P4E has not read the authenticated batch gate in this session.');

  if (!authorized) return null;

  async function readGate(messagePrefix = 'Reading caller-authenticated P4E batch gate…') {
    setBusy(true);
    setMessage(messagePrefix);
    try {
      const report = await readCommercialWave2P4EBatchGate();
      assertCommercialWave2P4EBatchGate(report);
      setGate(report);
      if (report.action === 'EXECUTE' && report.batch) {
        const target = report.batch.expected;
        setMessage(`ECOFLOW-R3-P4E — PASS / BATCH_${target.batchNo}_READY / ${target.candidateCount}_PROMOTION_ELIGIBLE / POSTFLIGHT_REQUIRED`);
      } else if (report.action === 'POSTFLIGHT' && report.batch) {
        setMessage(`ECOFLOW-R3-P4E — PASS / BATCH_${report.batch.expected.batchNo}_PROMOTED / HOLD_FOR_POSTFLIGHT`);
      } else if (report.action === 'COMPLETE') {
        setMessage('ECOFLOW-R3-P4E — PASS / 163_PROMOTED / 7_BATCHES_VERIFIED / PROGRAMME_COMPLETE');
      }
      return report;
    } catch (error) {
      setGate(null);
      setMessage(formatCommercialWave2P4EFailure(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function executeBatch() {
    if (!gate || gate.action !== 'EXECUTE' || !gate.batch) return;
    const target = gate.batch.expected;
    const confirmed = window.confirm(
      `P4E PRODUCTION BUSINESS MUTATION\n\nBatch ${target.batchNo} will create exactly ${target.candidateCount} Commercial SKU identities and ${target.candidateCount} ORDERMENTUM external mappings (${target.firstCode} → ${target.lastCode}).\n\nNo provider call, Physical/package/barcode authority, inventory/SOH/location quantity or image mutation is included.\n\nThe next batch remains locked until an independent postflight checkpoint passes.\n\nExecute batch ${target.batchNo}?`,
    );
    if (!confirmed) return;

    setBusy(true);
    setExecution(null);
    setPostflight(null);
    setMessage(`Executing caller-authenticated P4E batch ${target.batchNo}…`);
    try {
      const result = await executeCommercialWave2P4EBatch(target.batchNo);
      assertCommercialWave2P4EBatchExecution(result, target.batchNo);
      setExecution(result);
      onChanged?.();
      setMessage(`P4E batch ${target.batchNo}: promoted ${result.promotedCount} · replayed ${String(result.replayed)} · postflight REQUIRED`);
      const refreshed = await readCommercialWave2P4EBatchGate();
      assertCommercialWave2P4EBatchGate(refreshed);
      setGate(refreshed);
    } catch (error) {
      setMessage(formatCommercialWave2P4EFailure(error));
    } finally {
      setBusy(false);
    }
  }

  async function verifyBatch() {
    if (!gate || gate.action !== 'POSTFLIGHT' || !gate.batch) return;
    const target = gate.batch.expected;
    const confirmed = window.confirm(
      `Verify and close P4E batch ${target.batchNo}?\n\nThis postflight must prove all ${target.candidateCount} SKU/mapping/promotion/command/audit lineages and zero future-batch promotion before batch ${target.batchNo + 1} can open.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setPostflight(null);
    setMessage(`Verifying P4E batch ${target.batchNo} postflight…`);
    try {
      const result = await verifyCommercialWave2P4EBatch(target.batchNo);
      assertCommercialWave2P4EPostflight(result, target.batchNo);
      setPostflight(result);
      setMessage(
        result.programmeComplete
          ? 'ECOFLOW-R3-P4E — PASS / 163_PROMOTED / 7_BATCHES_VERIFIED / PROGRAMME_COMPLETE'
          : `P4E batch ${target.batchNo} postflight PASS · next batch ${result.nextBatchNo} may now preflight`,
      );
      const refreshed = await readCommercialWave2P4EBatchGate();
      assertCommercialWave2P4EBatchGate(refreshed);
      setGate(refreshed);
    } catch (error) {
      setMessage(formatCommercialWave2P4EFailure(error));
    } finally {
      setBusy(false);
    }
  }

  const current = gate?.batch?.expected ?? null;

  return (
    <section className="survey-reconciliation-panel" aria-label="Commercial Promotion Wave 2 P4E sequential batch promotion carrier">
      <header className="survey-reconciliation-header">
        <div>
          <span>OWNER / ADMIN · #338 COMMERCIAL PROMOTION WAVE 2</span>
          <h2>P4E sequential batch promotion</h2>
          <p>Seven frozen windows. One authenticated batch transaction at a time. Every successful batch is blocked from advancing until an independent postflight checkpoint commits.</p>
        </div>
      </header>

      <div className="survey-reconciliation-layout">
        <fieldset className="survey-reconciliation-form" disabled={busy}>
          <legend>P4E · AUTHENTICATED BATCH GATE</legend>
          <p>Plan SHA: {COMMERCIAL_WAVE2_P4E_PLAN.promotionPlanSha256}</p>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void readGate()}>
            {busy ? 'Reading P4E batch gate…' : 'Run authenticated P4E batch gate'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy || gate?.action !== 'EXECUTE' || !current}>
          <legend>P4E · CURRENT BATCH EXECUTION</legend>
          {current ? (
            <p>Batch {current.batchNo}: exactly {current.candidateCount} · {current.firstCode} → {current.lastCode} · command {current.commandId}</p>
          ) : (
            <p>No executable batch is currently proven.</p>
          )}
          <p>No provider request, Physical/package/barcode authority, inventory/SOH/location quantity or image mutation is part of this command.</p>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void executeBatch()}>
            {current ? `Execute authorized P4E batch ${current.batchNo}: promote exactly ${current.candidateCount}` : 'P4E batch execution locked'}
          </button>
        </fieldset>

        <fieldset className="survey-reconciliation-form" disabled={busy || gate?.action !== 'POSTFLIGHT' || !current}>
          <legend>P4E · INDEPENDENT POSTFLIGHT</legend>
          <p>The next batch cannot execute until this checkpoint proves the exact current-batch footprint and zero future-batch promotion.</p>
          <button type="button" className="survey-reconciliation-primary" onClick={() => void verifyBatch()}>
            {current ? `Verify and close P4E batch ${current.batchNo} postflight` : 'P4E postflight locked'}
          </button>
        </fieldset>
      </div>

      {gate ? (
        <dl className="survey-reconciliation-evidence survey-reconciliation-note">
          <div><dt>Gate</dt><dd>{gate.verdict} · {gate.status} · {gate.action}</dd></div>
          <div><dt>Fresh verifier</dt><dd>{gate.verifierRole} · {gate.verifiedAt}</dd></div>
          <div><dt>Programme</dt><dd>verified {gate.programme.verifiedBatchCount}/7 · promoted {gate.programme.nonCanaryPromotionCount}/163</dd></div>
          <div><dt>Current batch</dt><dd>{current ? `${current.batchNo} · ${current.candidateCount} · ${current.firstCode} → ${current.lastCode}` : 'COMPLETE'}</dd></div>
          <div><dt>Batch authority</dt><dd>authenticated {String(gate.authority.batchAuthenticatedExecute)} · service-role {String(gate.authority.batchServiceRoleExecute)}</dd></div>
          <div><dt>Single-SKU delegate</dt><dd>authenticated {String(gate.authority.singleSkuAuthenticatedExecute)} · service-role {String(gate.authority.singleSkuServiceRoleExecute)}</dd></div>
        </dl>
      ) : null}

      {execution ? (
        <details>
          <summary>Machine-readable P4E batch execution result</summary>
          <pre>{JSON.stringify(execution, null, 2)}</pre>
        </details>
      ) : null}
      {postflight ? (
        <details>
          <summary>Machine-readable P4E postflight result</summary>
          <pre>{JSON.stringify(postflight, null, 2)}</pre>
        </details>
      ) : null}
      {gate ? (
        <details>
          <summary>Machine-readable P4E batch gate report</summary>
          <pre>{JSON.stringify(gate, null, 2)}</pre>
        </details>
      ) : null}
      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
