import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Database, RadioTower } from 'lucide-react';
import {
  runUnleashedReadonlyProbe,
  type UnleashedProbeResult,
} from '../team/unleashedReadonlyProbe';
import {
  runCustomerDeliveryAddressContinuationPreflight,
  type AddressContinuationPreflightResult,
} from '../team/unleashedCustomerDeliveryAddressStaging';
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
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [preflightResult, setPreflightResult] = useState<AddressContinuationPreflightResult | null>(null);
  const [error, setError] = useState('');
  const [preflightError, setPreflightError] = useState('');

  async function runProbe() {
    if (running || preflightRunning) return;
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

  async function runContinuationPreflight() {
    if (running || preflightRunning) return;
    setPreflightRunning(true);
    setPreflightResult(null);
    setPreflightError('');
    try {
      setPreflightResult(await runCustomerDeliveryAddressContinuationPreflight(supabase));
    } catch (runError) {
      setPreflightError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setPreflightRunning(false);
    }
  }

  return (
    <section className="panel unleashed-probe-panel">
      <div className="panel-head">
        <div><h2>Unleashed connection</h2><span>GET only upstream · #338 address continuation dry preflight</span></div>
        <b className={`pill pill-${probeTone(result)}`}>{running ? 'RUNNING' : result?.status ?? 'NOT TESTED'}</b>
      </div>

      {error ? <div className="error-message" role="alert">{error}</div> : null}
      {result ? <div className="success-message" role="status">Connection test recorded · {result.runId.slice(0, 8)}</div> : null}

      <div className="system-status-grid">
        <div><span>Last test</span><strong>{formatTime(result?.requestedAt)}</strong></div>
        <div><span>Resource</span><strong>Customer delivery addresses only</strong></div>
        <div><span>Dry preflight</span><strong>184 records · 4 pages · no staging</strong></div>
        <div><span>Non-dry</span><strong>Blocked</strong></div>
      </div>

      <div className="system-sync-actions unleashed-probe-actions">
        <button type="button" className="primary" onClick={() => void runProbe()} disabled={running || preflightRunning}>
          <RadioTower aria-hidden="true" size={17} />
          {running ? 'Testing…' : 'Run one-page dry test'}
        </button>
        <button type="button" onClick={() => void runContinuationPreflight()} disabled={running || preflightRunning}>
          <Database aria-hidden="true" size={17} />
          {preflightRunning ? 'Reading all 4 address pages…' : 'Run #338 address continuation dry preflight'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        Groundwork only after Batch 1B-5A closure. This action is dryRun=true and reads exactly customer_delivery_addresses at pageSize=50/maxPages=4. It is accepted only if the source is still exactly 184 records across 4 pages. No non-dry continuation action is exposed. PLAN, COPY_IMAGES, Product Identity, inventory and cutover remain blocked.
      </p>

      {preflightError ? <div className="error-message" role="alert">{preflightError}</div> : null}
      {preflightResult ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>customer_delivery_addresses</strong>
                <small>{preflightResult.recordsSeen} seen · 0 staged · page 3 SHA {preflightResult.pages[2]?.responseSha256.slice(0, 8)}… · page 4 SHA {preflightResult.pages[3]?.responseSha256.slice(0, 8)}… · run {preflightResult.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">DRY PREFLIGHT PASS</b>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
