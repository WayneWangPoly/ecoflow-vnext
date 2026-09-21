import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Database, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  activateR5009FreshReferenceBridge,
  readR5009FreshReferenceBridgeGate,
  runR5009FreshReferenceStage,
  type R5009ActivateResult,
  type R5009BridgeGate,
  type R5009StageResult,
} from '../team/freshInventoryReferenceBridge';

function tone(gate: R5009BridgeGate | null, error: string, activated: boolean) {
  if (error) return 'danger';
  if (activated) return 'good';
  if (gate?.safeToActivate) return 'warning';
  if (gate?.freshBatchStatus === 'STAGED') return 'warning';
  if (gate?.membershipCount === 428) return 'good';
  return 'neutral';
}

export function FreshInventoryReferenceBridgePanel({ supabase }: { supabase: SupabaseClient }) {
  const [gate, setGate] = useState<R5009BridgeGate | null>(null);
  const [gateError, setGateError] = useState('');
  const [gateLoading, setGateLoading] = useState(false);

  const [stageAck, setStageAck] = useState(false);
  const [stageRunning, setStageRunning] = useState(false);
  const [stageAttempted, setStageAttempted] = useState(false);
  const [stageResult, setStageResult] = useState<R5009StageResult | null>(null);
  const [stageError, setStageError] = useState('');

  const [activateAck, setActivateAck] = useState(false);
  const [activateRunning, setActivateRunning] = useState(false);
  const [activateAttempted, setActivateAttempted] = useState(false);
  const [activateResult, setActivateResult] = useState<R5009ActivateResult | null>(null);
  const [activateError, setActivateError] = useState('');

  const refreshGate = useCallback(async () => {
    setGateLoading(true);
    setGateError('');
    try {
      setGate(await readR5009FreshReferenceBridgeGate(supabase));
    } catch (error) {
      setGateError(error instanceof Error ? error.message : String(error));
    } finally {
      setGateLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void refreshGate();
  }, [refreshGate]);

  async function stageFreshReference() {
    if (!stageAck || stageRunning || stageAttempted) return;
    setStageAttempted(true);
    setStageRunning(true);
    setStageResult(null);
    setStageError('');
    try {
      setStageResult(await runR5009FreshReferenceStage(supabase));
      await refreshGate();
    } catch (error) {
      setStageError(error instanceof Error ? error.message : String(error));
    } finally {
      setStageRunning(false);
      setStageAck(false);
    }
  }

  async function activateFreshReference() {
    if (!activateAck || activateRunning || activateAttempted || !gate?.safeToActivate) return;
    setActivateAttempted(true);
    setActivateRunning(true);
    setActivateResult(null);
    setActivateError('');
    try {
      setActivateResult(await activateR5009FreshReferenceBridge(supabase));
      await refreshGate();
    } catch (error) {
      setActivateError(error instanceof Error ? error.message : String(error));
    } finally {
      setActivateRunning(false);
      setActivateAck(false);
    }
  }

  const freshAlreadyStaged = gate?.freshBatchStatus === 'STAGED'
    || gate?.freshBatchStatus === 'SEALED';

  return (
    <div className="unleashed-acceptance unleashed-r5-acquisition" id="unleashed-r5-009-reference-bridge">
      <div className="unleashed-acceptance-head">
        <div>
          <h3>R5-009 fresh inventory-reference bridge</h3>
          <span>R5-008 membership · 428 rows · supersede stale 3/5 planning evidence · no inventory authority</span>
        </div>
        <b className={`pill pill-${tone(gate, gateError || stageError || activateError, Boolean(activateResult))}`}>
          {activateRunning ? 'ACTIVATING' : stageRunning ? 'STAGING' : activateResult ? 'ACTIVATED' : gate?.safeToActivate ? 'READY TO ACTIVATE' : freshAlreadyStaged ? 'STAGED' : gate?.membershipCount === 428 ? 'MEMBERSHIP READY' : 'NOT STAGED'}
        </b>
      </div>

      <p className="unleashed-acceptance-note">
        Phase A reconstructs the complete R5-008 run membership from the governed 349 changed/inserted + 79 unchanged proof,
        then stages a 428-row immutable reference batch. Phase B separately seals that fresh batch and marks the untouched
        old 3/5 DRAFT commissionings and provisional planning evidence as superseded history. Neither phase creates a
        physical count, stocktake approval, warehouse quantity, inventory movement, or operational inventory authority.
      </p>

      <div className="unleashed-acceptance-summary">
        <span>Membership <strong>{gate?.membershipCount ?? '—'}/428</strong></span>
        <span>Fresh batch <strong>{gate?.freshBatchStatus ?? 'NOT STAGED'}</strong></span>
        <span>Old batch <strong>{gate?.oldBatchStatus ?? '—'}</strong></span>
        <span>Stale DRAFT sets <strong>{gate?.staleDraftCommissioningCount ?? '—'}</strong></span>
        <span>Fresh READY targets <strong>{gate?.freshReadyTargetCount ?? '—'}/2</strong></span>
        <span>Inventory authority <strong>NONE</strong></span>
      </div>

      <button
        type="button"
        onClick={() => void refreshGate()}
        disabled={gateLoading || stageRunning || activateRunning}
      >
        <RefreshCw aria-hidden="true" size={17} />
        {gateLoading ? 'Refreshing…' : 'Refresh bridge gate'}
      </button>

      {gateError ? <div className="error-message" role="alert">{gateError}</div> : null}

      <div className="unleashed-acceptance">
        <div className="unleashed-acceptance-head">
          <div>
            <h4>Phase A · reconstruct + stage fresh reference</h4>
            <span>Exact source run bdca8012… · 428 rows · evidence only</span>
          </div>
          <b className={`pill pill-${stageResult || freshAlreadyStaged ? 'good' : stageError ? 'danger' : 'neutral'}`}>
            {stageRunning ? 'RUNNING' : stageResult ? 'STAGED' : freshAlreadyStaged ? 'ALREADY STAGED' : stageAttempted ? 'ATTEMPTED' : 'NOT RUN'}
          </b>
        </div>

        <ul className="unleashed-acceptance-scope">
          <li>R5-008 run: bdca8012-8f78-4dff-b20c-5f5a7d0f8cce</li>
          <li>Proof: 349 bound to R5-008 + 79 unchanged from prior 427-row set + 1 inserted = 428</li>
          <li>Fresh QtyOnHand: R-360Y = 1; SB24/32/40LBOX = 1</li>
          <li>Provider traffic: NONE</li>
        </ul>

        <label className="unleashed-acceptance-confirm">
          <input
            type="checkbox"
            checked={stageAck}
            disabled={stageRunning || stageAttempted || freshAlreadyStaged}
            onChange={(event) => setStageAck(event.target.checked)}
          />
          <span>I confirm Phase A may reconstruct immutable run-membership evidence and stage the fresh reference only.</span>
        </label>

        {stageError ? <div className="error-message" role="alert">{stageError}</div> : null}
        {stageResult ? (
          <div className="success-message" role="status">
            Fresh reference staged · {stageResult.batchId.slice(0, 8)} · {stageResult.sourceRowCount} rows · authority NONE
          </div>
        ) : null}

        {stageAttempted && !stageResult ? (
          <div className="unleashed-acceptance-warning" role="status">
            Do not retry blindly. Refresh and verify the production bridge gate first.
          </div>
        ) : null}

        <button
          type="button"
          className="primary unleashed-acceptance-run"
          disabled={!stageAck || stageRunning || stageAttempted || freshAlreadyStaged}
          onClick={() => void stageFreshReference()}
        >
          <Database aria-hidden="true" size={17} />
          {stageRunning ? 'Reconstructing and staging…' : freshAlreadyStaged ? 'Fresh reference already staged' : stageAttempted ? 'Attempt locked' : 'Reconstruct + stage once'}
        </button>
      </div>

      <div className="unleashed-acceptance">
        <div className="unleashed-acceptance-head">
          <div>
            <h4>Phase B · activate fresh reference lifecycle</h4>
            <span>Seal fresh batch · supersede old 3/5 reference + untouched DRAFT commissionings</span>
          </div>
          <b className={`pill pill-${activateResult ? 'good' : activateError ? 'danger' : gate?.safeToActivate ? 'warning' : 'neutral'}`}>
            {activateRunning ? 'RUNNING' : activateResult ? 'ACTIVATED' : gate?.safeToActivate ? 'READY' : activateAttempted ? 'ATTEMPTED' : 'BLOCKED'}
          </b>
        </div>

        <ul className="unleashed-acceptance-scope">
          <li>Old planning evidence remains auditable and becomes SUPERSEDED_REFERENCE</li>
          <li>Old DRAFT commissioning sets become SUPERSEDED without count/location evidence</li>
          <li>Fresh 1/1 reference becomes the only latest SEALED reference</li>
          <li>Physical stocktake remains mandatory and separately authorized</li>
        </ul>

        <label className="unleashed-acceptance-confirm">
          <input
            type="checkbox"
            checked={activateAck}
            disabled={activateRunning || activateAttempted || !gate?.safeToActivate}
            onChange={(event) => setActivateAck(event.target.checked)}
          />
          <span>I confirm Phase B changes reference lifecycle only. It must not create stocktake or inventory authority.</span>
        </label>

        {activateError ? <div className="error-message" role="alert">{activateError}</div> : null}
        {activateResult ? (
          <div className="success-message" role="status">
            Fresh reference SEALED · old reference SUPERSEDED · 2 stale DRAFT sets superseded · inventory authority NONE
          </div>
        ) : null}

        <button
          type="button"
          className="primary unleashed-acceptance-run"
          disabled={!activateAck || activateRunning || activateAttempted || !gate?.safeToActivate}
          onClick={() => void activateFreshReference()}
        >
          <ShieldCheck aria-hidden="true" size={17} />
          {activateRunning ? 'Activating fresh lifecycle…' : activateAttempted ? 'Attempt locked' : gate?.safeToActivate ? 'Activate fresh reference once' : 'Activation gate blocked'}
        </button>
      </div>
    </div>
  );
}
