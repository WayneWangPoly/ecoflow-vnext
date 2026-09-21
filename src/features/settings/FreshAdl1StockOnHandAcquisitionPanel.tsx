import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'lucide-react';
import {
  runR5008Adl1StockOnHandAcquisition,
  type R5002AcquisitionResult,
} from '../team/unleashedAdl1StockOnHandAcquisition';

function acquisitionTone(result: R5002AcquisitionResult | null, error: string) {
  if (result) return 'good';
  if (error) return 'danger';
  return 'neutral';
}

export function FreshAdl1StockOnHandAcquisitionPanel({ supabase }: { supabase: SupabaseClient }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<R5002AcquisitionResult | null>(null);
  const [error, setError] = useState('');

  async function runAcquisition() {
    if (!acknowledged || running || attempted) return;
    setAttempted(true);
    setRunning(true);
    setResult(null);
    setError('');
    try {
      setResult(await runR5008Adl1StockOnHandAcquisition(supabase));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setRunning(false);
      setAcknowledged(false);
    }
  }

  return (
    <div className="unleashed-acceptance unleashed-r5-acquisition" id="unleashed-r5-008-acquisition">
      <div className="unleashed-acceptance-head">
        <div>
          <h3>R5-008 fresh ADL1 StockOnHand pre-stocktake snapshot</h3>
          <span>Fresh pre-stocktake evidence · one shot · pages 1–5 · 200 rows per page</span>
        </div>
        <b className={`pill pill-${acquisitionTone(result, error)}`}>
          {running ? 'RUNNING' : result ? 'SUCCEEDED' : attempted ? 'ATTEMPTED' : 'NOT RUN'}
        </b>
      </div>

      <p className="unleashed-acceptance-note">
        This sends GET-only StockOnHand requests scoped to warehouse ADL1 and stores fresh source evidence only.
        No STAGE, opening balance, stocktake, inventory movement, or Product Identity mutation.
      </p>
      <ul className="unleashed-acceptance-scope">
        <li>Resource: stock_on_hand</li>
        <li>Warehouse: ADL1</li>
        <li>Window: page 1, maximum 5 pages</li>
        <li>Request key: ECOFLOW-R5-008</li>
      </ul>

      <label className="unleashed-acceptance-confirm">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={running || attempted}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>I confirm this fresh pre-stocktake ADL1 source acquisition and understand this request key allows one attempt only.</span>
      </label>

      {error ? <div className="error-message" role="alert">{error}</div> : null}
      {result ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-summary">
            <span>Run <strong>{result.runId.slice(0, 8)}</strong></span>
            <span>Pages <strong>{result.pages.length}</strong></span>
            <span>Source rows <strong>{result.recordsSeen}</strong></span>
            <span>Window <strong>{result.paginationWindows[0].windowComplete ? 'COMPLETE' : 'INCOMPLETE'}</strong></span>
          </div>
        </div>
      ) : null}

      {attempted ? (
        <div className="unleashed-acceptance-warning" role="status">
          Do not retry. Verify the production ledger first.
        </div>
      ) : null}

      <button
        type="button"
        className="primary unleashed-acceptance-run"
        disabled={!acknowledged || running || attempted}
        onClick={() => void runAcquisition()}
      >
        <Database aria-hidden="true" size={17} />
        {running ? 'Acquiring fresh ADL1 evidence…' : attempted ? 'Attempt locked' : 'Acquire fresh ADL1 snapshot once'}
      </button>
    </div>
  );
}
