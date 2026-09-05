import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Database, RadioTower } from 'lucide-react';
import {
  runUnleashedReadonlyProbe,
  type UnleashedProbeResult,
} from '../team/unleashedReadonlyProbe';
import {
  runCustomerDeliveryAddressFirstWindow,
  type AddressStagingResult,
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
  const [stagingRunning, setStagingRunning] = useState(false);
  const [stagingResult, setStagingResult] = useState<AddressStagingResult | null>(null);
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

  async function runFirstWindow() {
    if (running || stagingRunning) return;
    setStagingRunning(true);
    setStagingResult(null);
    setStagingError('');
    try {
      setStagingResult(await runCustomerDeliveryAddressFirstWindow(supabase));
    } catch (runError) {
      setStagingError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setStagingRunning(false);
    }
  }

  return (
    <section className="panel unleashed-probe-panel">
      <div className="panel-head">
        <div><h2>Unleashed connection</h2><span>GET only upstream · #338 address first-window staging gate</span></div>
        <b className={`pill pill-${probeTone(result)}`}>{running ? 'RUNNING' : result?.status ?? 'NOT TESTED'}</b>
      </div>

      {error ? <div className="error-message" role="alert">{error}</div> : null}
      {result ? <div className="success-message" role="status">Connection test recorded · {result.runId.slice(0, 8)}</div> : null}

      <div className="system-status-grid">
        <div><span>Last test</span><strong>{formatTime(result?.requestedAt)}</strong></div>
        <div><span>Resource</span><strong>Customer delivery addresses only</strong></div>
        <div><span>Authorized window</span><strong>Pages 1-2 · 50/page · max 100</strong></div>
        <div><span>PLAN</span><strong>Blocked</strong></div>
      </div>

      <div className="system-sync-actions unleashed-probe-actions">
        <button type="button" className="primary" onClick={() => void runProbe()} disabled={running || stagingRunning}>
          <RadioTower aria-hidden="true" size={17} />
          {running ? 'Testing…' : 'Run one-page dry test'}
        </button>
        <button type="button" onClick={() => void runFirstWindow()} disabled={running || stagingRunning}>
          <Database aria-hidden="true" size={17} />
          {stagingRunning ? 'Staging addresses pages 1-2…' : 'Run #338 address pages 1-2 staging'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        Authorized Batch 1B-5A only. A dry preflight must prove customer_delivery_addresses is exactly 184 records / 4 pages at pageSize=50. Only then may one non-dry pages 1-2 window run, capped at 100 records. The preflight and non-dry page hashes/high-watermarks must match. Expected post-run continuation is nextPage=3 with windowComplete=false. PLAN, COPY_IMAGES, Product Identity, inventory and cutover remain blocked.
      </p>

      {stagingError ? <div className="error-message" role="alert">{stagingError}</div> : null}
      {stagingResult ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>customer_delivery_addresses</strong>
                <small>{stagingResult.recordsSeen} seen · {stagingResult.recordsStaged} staged · next page {stagingResult.paginationWindows[0]?.nextPage ?? 'n/a'} · run {stagingResult.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">PAGES 1-2 STAGED</b>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
