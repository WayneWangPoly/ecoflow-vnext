import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Database, RadioTower } from 'lucide-react';
import {
  runUnleashedReadonlyProbe,
  type UnleashedProbeResult,
} from '../team/unleashedReadonlyProbe';
import {
  runSupplierUnleashedStaging,
  type SupplierStagingResult,
} from '../team/unleashedSupplierStaging';
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
  const [stagingRunning, setStagingRunning] = useState(false);
  const [stagingResult, setStagingResult] = useState<SupplierStagingResult | null>(null);
  const [error, setError] = useState('');
  const [stagingError, setStagingError] = useState('');

  async function runProbe() {
    if (running || stagingRunning) return;
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

  async function runSupplierStaging() {
    if (running || stagingRunning) return;
    setStagingRunning(true);
    setStagingResult(null);
    setStagingError('');
    try {
      setStagingResult(await runSupplierUnleashedStaging(supabase));
    } catch (runError) {
      setStagingError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setStagingRunning(false);
    }
  }

  return (
    <section className="panel unleashed-probe-panel">
      <div className="panel-head">
        <div><h2>Unleashed connection</h2><span>GET only upstream · #338 suppliers bounded staging gate</span></div>
        <b className={`pill pill-${probeTone(result)}`}>{running ? 'RUNNING' : result?.status ?? 'NOT TESTED'}</b>
      </div>

      {error ? <div className="error-message" role="alert">{error}</div> : null}
      {result ? <div className="success-message" role="status">Connection test recorded · {result.runId.slice(0, 8)}</div> : null}

      <div className="system-status-grid">
        <div><span>Last test</span><strong>{formatTime(result?.requestedAt)}</strong></div>
        <div><span>Resource</span><strong>Suppliers only</strong></div>
        <div><span>Hard cap</span><strong>26 records · 1 page</strong></div>
        <div><span>PLAN</span><strong>Blocked</strong></div>
      </div>

      <div className="system-sync-actions unleashed-probe-actions">
        <button type="button" className="primary" onClick={() => void runProbe()} disabled={running || stagingRunning}>
          <RadioTower aria-hidden="true" size={17} />
          {running ? 'Testing…' : 'Run one-page dry test'}
        </button>
        <button type="button" onClick={() => void runSupplierStaging()} disabled={running || stagingRunning}>
          <Database aria-hidden="true" size={17} />
          {stagingRunning ? 'Staging suppliers…' : 'Run #338 bounded supplier staging'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        Authorized Batch 1B-3 only. A dry preflight first proves the supplier source still fits one page of at most 26 records; only then does one non-dry supplier staging request run. If the source exceeds the bound, the write is not started. PLAN, COPY_IMAGES, Product Identity, inventory and cutover remain blocked.
      </p>

      {stagingError ? <div className="error-message" role="alert">{stagingError}</div> : null}
      {stagingResult ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>suppliers</strong>
                <small>{stagingResult.recordsSeen} seen · {stagingResult.recordsStaged} staged · run {stagingResult.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">BOUNDED STAGED</b>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
