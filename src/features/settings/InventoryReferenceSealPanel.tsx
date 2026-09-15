import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import {
  runR5004BInventoryReferenceSeal,
  type R5004BSealResult,
} from '../team/unleashedInventoryReferenceSeal';

function tone(result: R5004BSealResult | null, error: string) {
  if (result) return 'good';
  if (error) return 'danger';
  return 'neutral';
}

export function InventoryReferenceSealPanel({ supabase }: { supabase: SupabaseClient }) {
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<R5004BSealResult | null>(null);
  const [error, setError] = useState('');

  async function runSeal() {
    if (!acknowledged || running || attempted) return;
    setAttempted(true);
    setRunning(true);
    setResult(null);
    setError('');
    try {
      setResult(await runR5004BInventoryReferenceSeal(supabase));
    } catch (sealError) {
      setError(sealError instanceof Error ? sealError.message : String(sealError));
    } finally {
      setRunning(false);
      setAcknowledged(false);
    }
  }

  return (
    <div className="unleashed-r5-seal-carrier">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="unleashed-r5-004b-seal"
        onClick={() => setOpen((current) => !current)}
        disabled={running}
      >
        <ShieldCheck aria-hidden="true" size={17} />
        {open ? 'Close reference seal' : 'Review R5-004B reference seal'}
      </button>

      {open ? (
        <div className="unleashed-acceptance unleashed-r5-seal" id="unleashed-r5-004b-seal">
          <div className="unleashed-acceptance-head">
            <div>
              <h3>R5-004B seal immutable ADL1 reference</h3>
              <span>OWNER/ADMIN authenticated · STAGED rev0 → SEALED rev1 · authorityEffect NONE</span>
            </div>
            <b className={`pill pill-${tone(result, error)}`}>
              {running ? 'RUNNING' : result ? 'SEALED' : attempted ? 'ATTEMPTED' : 'NOT RUN'}
            </b>
          </div>

          <p className="unleashed-acceptance-note">
            This accepts the already-staged 427-row ADL1 source set as immutable reference evidence for the bounded BPB8 canary.
            It does not create an INITIAL stocktake, opening balance, warehouse movement, inventory movement, location assignment,
            Product Identity mutation, or quantity authority.
          </p>
          <ul className="unleashed-acceptance-scope">
            <li>Reference batch: 4cdb85d3…</li>
            <li>Source run: 5cd0e73b…</li>
            <li>Rows: 427</li>
            <li>Source-set SHA-256: 215e9abe…</li>
            <li>BPB8 reference: QtyOnHand 3 · ADL1 · READY_FOR_LOCATION_EVIDENCE</li>
          </ul>

          <label className="unleashed-acceptance-confirm">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={running || attempted}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>I confirm R5-004B may seal this exact immutable reference batch only. Inventory authority remains unchanged.</span>
          </label>

          {error ? <div className="error-message" role="alert">{error}</div> : null}
          {result ? (
            <div className="unleashed-acceptance-result" role="status">
              <div className="unleashed-acceptance-summary">
                <span>Batch <strong>{result.batchId.slice(0, 8)}</strong></span>
                <span>Status <strong>{result.batchStatus}</strong></span>
                <span>Revision <strong>{result.revision}</strong></span>
                <span>Authority <strong>{result.authorityEffect}</strong></span>
              </div>
            </div>
          ) : null}

          {attempted ? (
            <div className="unleashed-acceptance-warning" role="status">
              Do not retry blindly. Verify the production reference ledger and command envelope first.
            </div>
          ) : null}

          <button
            type="button"
            className="primary unleashed-acceptance-run"
            disabled={!acknowledged || running || attempted}
            onClick={() => void runSeal()}
          >
            <LockKeyhole aria-hidden="true" size={17} />
            {running ? 'Sealing immutable reference…' : attempted ? 'Attempt locked' : 'Seal R5-004B reference once'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
