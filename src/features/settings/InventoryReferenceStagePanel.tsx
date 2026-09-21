import { lazy, Suspense, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Database, ShieldCheck } from 'lucide-react';
import {
  runR5003InventoryReferenceStage,
  type R5003StageResult,
} from '../team/unleashedInventoryReferenceStage';
import { InventoryReferenceSealPanel } from './InventoryReferenceSealPanel';
import { Bpb8InitialOpeningBalanceCanaryPanel } from './Bpb8InitialOpeningBalanceCanaryPanel';

const ReadyPositiveStockCommissioningPanel = lazy(async () => {
  const module = await import('./ReadyPositiveStockCommissioningPanel');
  return { default: module.ReadyPositiveStockCommissioningPanel };
});

const ProvisionalReferenceOpeningPanel = lazy(async () => {
  const module = await import('./ProvisionalReferenceOpeningPanel');
  return { default: module.ProvisionalReferenceOpeningPanel };
});

function tone(result: R5003StageResult | null, error: string) {
  if (result) return 'good';
  if (error) return 'danger';
  return 'neutral';
}

export function InventoryReferenceStagePanel({ supabase }: { supabase: SupabaseClient }) {
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<R5003StageResult | null>(null);
  const [error, setError] = useState('');

  async function runStage() {
    if (!acknowledged || running || attempted) return;
    setAttempted(true);
    setRunning(true);
    setResult(null);
    setError('');
    try {
      setResult(await runR5003InventoryReferenceStage(supabase));
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : String(stageError));
    } finally {
      setRunning(false);
      setAcknowledged(false);
    }
  }

  return (
    <div className="unleashed-r5-stage-carrier">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="unleashed-r5-003-stage"
        onClick={() => setOpen((current) => !current)}
        disabled={running}
      >
        <ShieldCheck aria-hidden="true" size={17} />
        {open ? 'Close inventory reference stage' : 'Review inventory reference stage'}
      </button>

      {open ? (
        <div className="unleashed-acceptance unleashed-r5-stage" id="unleashed-r5-003-stage">
          <div className="unleashed-acceptance-head">
            <div>
              <h3>R5-003 ADL1 inventory reference stage</h3>
              <span>Immutable evidence only · 427 source rows · no inventory authority</span>
            </div>
            <b className={`pill pill-${tone(result, error)}`}>
              {running ? 'RUNNING' : result ? 'STAGED' : attempted ? 'ATTEMPTED' : 'NOT RUN'}
            </b>
          </div>

          <p className="unleashed-acceptance-note">
            This freezes the successful R5-002-R2 ADL1 StockOnHand source set into a governed reference batch.
            It does not create opening balance, stocktake, warehouse movement, inventory movement, location assignment,
            Product Identity, or quantity authority.
          </p>
          <ul className="unleashed-acceptance-scope">
            <li>Source run: 5cd0e73b…</li>
            <li>Rows: 427</li>
            <li>Boundary: 15 Sep 2026 02:13:08.019 UTC</li>
            <li>Command: 653bcfcc…</li>
          </ul>

          <label className="unleashed-acceptance-confirm">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={running || attempted}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>I confirm R5-003 may create immutable reference evidence only. Inventory authority remains unchanged.</span>
          </label>

          {error ? <div className="error-message" role="alert">{error}</div> : null}
          {result ? (
            <div className="unleashed-acceptance-result" role="status">
              <div className="unleashed-acceptance-summary">
                <span>Batch <strong>{result.batchId.slice(0, 8)}</strong></span>
                <span>Rows <strong>{result.sourceRowCount}</strong></span>
                <span>Status <strong>{result.batchStatus}</strong></span>
                <span>Authority <strong>{result.authorityEffect}</strong></span>
              </div>
            </div>
          ) : null}

          {attempted ? (
            <div className="unleashed-acceptance-warning" role="status">
              Do not retry blindly. Verify the production reference ledger first.
            </div>
          ) : null}

          <button
            type="button"
            className="primary unleashed-acceptance-run"
            disabled={!acknowledged || running || attempted}
            onClick={() => void runStage()}
          >
            <Database aria-hidden="true" size={17} />
            {running ? 'Staging immutable reference…' : attempted ? 'Attempt locked' : 'Stage R5-003 reference once'}
          </button>
        </div>
      ) : null}

      <InventoryReferenceSealPanel supabase={supabase} />
      <Bpb8InitialOpeningBalanceCanaryPanel supabase={supabase} />
      <Suspense fallback={<div className="unleashed-acceptance-note">Loading R5-005B commissioning carrier…</div>}>
        <ReadyPositiveStockCommissioningPanel supabase={supabase} />
      </Suspense>
      <Suspense fallback={<div className="unleashed-acceptance-note">Loading R5-007 provisional opening carrier…</div>}>
        <ProvisionalReferenceOpeningPanel supabase={supabase} />
      </Suspense>
    </div>
  );
}
