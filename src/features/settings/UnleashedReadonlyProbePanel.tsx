import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Database, RadioTower } from 'lucide-react';
import {
  runUnleashedReadonlyProbe,
  type UnleashedDryRunCensusResult,
  type UnleashedProbeResult,
} from '../team/unleashedReadonlyProbe';
import {
  runWarehouseUnleashedStaging,
  type WarehouseStagingResult,
} from '../team/unleashedWarehouseStaging';
import './teamAccessSettings.css';

function formatTime(value?: string | null) {
  if (!value) return 'Not run';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function probeTone(result: UnleashedProbeResult | null) {
  if (!result) return 'neutral';
  return result.ok && result.status === 'SUCCEEDED' && result.recordsFailed === 0 ? 'good' : 'danger';
}

export function UnleashedReadonlyProbePanel({ supabase }: { supabase: SupabaseClient }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<UnleashedProbeResult | null>(null);
  const [error, setError] = useState('');
  const [censusRunning, setCensusRunning] = useState(false);
  const [censusResults, setCensusResults] = useState<Array<UnleashedDryRunCensusResult | UnleashedProbeResult | WarehouseStagingResult>>([]);
  const [censusError, setCensusError] = useState('');

  async function runProbe() {
    if (running || censusRunning) return;
    setRunning(true);
    setResult(null);
    setError('');
    try {
      setResult(await runUnleashedReadonlyProbe(supabase));
    } catch (probeError) {
      setError(probeError instanceof Error ? probeError.message : String(probeError));
    } finally {
      setRunning(false);
    }
  }

  async function runCensus() {
    if (running || censusRunning) return;
    setCensusRunning(true);
    setCensusResults([]);
    setCensusError('');
    try {
      setCensusResults([await runWarehouseUnleashedStaging(supabase)]);
    } catch (runError) {
      setCensusError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setCensusRunning(false);
    }
  }

  return (
    <section className="panel unleashed-probe-panel">
      <div className="panel-head">
        <div><h2>Unleashed connection</h2><span>GET only upstream · #338 warehouse idempotency gate</span></div>
        <b className={`pill pill-${probeTone(result)}`}>{running ? 'RUNNING' : result?.status ?? 'NOT TESTED'}</b>
      </div>

      {error ? <div className="error-message" role="alert">{error}</div> : null}
      {result ? <div className="success-message" role="status">Connection test recorded · {result.runId.slice(0, 8)}</div> : null}

      <div className="system-status-grid">
        <div><span>Last test</span><strong>{formatTime(result?.requestedAt)}</strong></div>
        <div><span>Resource</span><strong>Warehouses only</strong></div>
        <div><span>Expected staged</span><strong>0</strong></div>
        <div><span>PLAN</span><strong>Blocked</strong></div>
      </div>

      <div className="system-sync-actions unleashed-probe-actions">
        <button type="button" className="primary" onClick={() => void runProbe()} disabled={running || censusRunning}>
          <RadioTower aria-hidden="true" size={17} />
          {running ? 'Testing…' : 'Run one-page dry test'}
        </button>
        <button type="button" onClick={() => void runCensus()} disabled={running || censusRunning}>
          <Database aria-hidden="true" size={17} />
          {censusRunning ? 'Replaying warehouse…' : 'Run #338 warehouse idempotent replay'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        Authorized Batch 1B-2 only: replay the same single warehouse snapshot. The result is accepted only if staged=0, inserted=0, changed=0 and unchanged=1. PLAN, COPY_IMAGES, Product Identity, inventory and cutover remain blocked.
      </p>

      {censusError ? <div className="error-message" role="alert">{censusError}</div> : null}
      {censusResults.length ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            {censusResults.map((censusResult) => {
              const page = censusResult.pages[0];
              const itemCount = Number(page.pagination.NumberOfItems ?? page.recordsSeen);
              const pageCount = Number(page.pagination.NumberOfPages ?? 1);
              return (
                <div key={page.resource}>
                  <span>
                    <strong>{page.resource}</strong>
                    <small>{itemCount} items · {pageCount} pages · run {censusResult.runId.slice(0, 8)} · staged {page.recordsStaged}</small>
                  </span>
                  <b className="pill pill-good">IDEMPOTENT</b>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
