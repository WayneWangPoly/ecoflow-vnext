import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Database, RadioTower, ShieldCheck } from 'lucide-react';
import {
  runUnleashedConnectorAcceptance,
  type UnleashedAcceptanceResource,
  type UnleashedAcceptanceResult,
} from '../team/unleashedConnectorAcceptance';
import { runUnleashedReadonlyProbe, type UnleashedProbeResult } from '../team/unleashedReadonlyProbe';
import './teamAccessSettings.css';

const ACCEPTANCE_RESOURCE_LABELS: Record<UnleashedAcceptanceResource, string> = {
  products: 'Product',
  stock_on_hand: 'Stock on hand',
  sales_orders_open: 'Open sales order',
  purchase_orders_open: 'Open purchase order',
};

function formatTime(value?: string | null) {
  if (!value) return 'Not run';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function probeTone(result: UnleashedProbeResult | null) {
  if (!result) return 'neutral';
  return result.ok && result.status === 'SUCCEEDED' && result.recordsFailed === 0 ? 'good' : 'danger';
}

function acceptanceTone(result: UnleashedAcceptanceResult | null) {
  if (!result) return 'neutral';
  return result.complete ? 'good' : 'warning';
}

export function UnleashedReadonlyProbePanel({ supabase }: { supabase: SupabaseClient }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<UnleashedProbeResult | null>(null);
  const [error, setError] = useState('');
  const [acceptanceOpen, setAcceptanceOpen] = useState(false);
  const [acceptanceAcknowledged, setAcceptanceAcknowledged] = useState(false);
  const [acceptanceRunning, setAcceptanceRunning] = useState(false);
  const [acceptanceResult, setAcceptanceResult] = useState<UnleashedAcceptanceResult | null>(null);
  const [acceptanceError, setAcceptanceError] = useState('');

  async function runProbe() {
    if (running || acceptanceRunning) return;
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

  async function runAcceptance() {
    if (!acceptanceAcknowledged || acceptanceRunning || running) return;
    setAcceptanceRunning(true);
    setAcceptanceResult(null);
    setAcceptanceError('');
    try {
      setAcceptanceResult(await runUnleashedConnectorAcceptance(supabase));
    } catch (runError) {
      setAcceptanceError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setAcceptanceRunning(false);
      setAcceptanceAcknowledged(false);
    }
  }

  return (
    <section className="panel unleashed-probe-panel">
      <div className="panel-head">
        <div><h2>Unleashed connection</h2><span>GET only · dry-run · one page</span></div>
        <b className={`pill pill-${probeTone(result)}`}>{running ? 'RUNNING' : result?.status ?? 'NOT TESTED'}</b>
      </div>

      {error ? <div className="error-message" role="alert">{error}</div> : null}
      {result ? <div className="success-message" role="status">Connection test recorded · {result.runId.slice(0, 8)}</div> : null}

      <div className="system-status-grid">
        <div><span>Last test</span><strong>{formatTime(result?.requestedAt)}</strong></div>
        <div><span>Resource</span><strong>Warehouses</strong></div>
        <div><span>Records checked</span><strong>{result?.recordsSeen ?? '—'}</strong></div>
        <div><span>Records imported</span><strong>{result?.recordsStaged ?? 0}</strong></div>
      </div>

      <div className="system-sync-actions unleashed-probe-actions">
        <button type="button" className="primary" onClick={() => void runProbe()} disabled={running || acceptanceRunning}>
          <RadioTower aria-hidden="true" size={17} />
          {running ? 'Testing…' : 'Run one-page test'}
        </button>
        <button
          type="button"
          aria-expanded={acceptanceOpen}
          aria-controls="unleashed-production-acceptance"
          onClick={() => setAcceptanceOpen((current) => !current)}
          disabled={running || acceptanceRunning}
        >
          <ShieldCheck aria-hidden="true" size={17} />
          {acceptanceOpen ? 'Close acceptance' : 'Review production acceptance'}
        </button>
      </div>

      {acceptanceOpen ? (
        <div className="unleashed-acceptance" id="unleashed-production-acceptance">
          <div className="unleashed-acceptance-head">
            <div><h3>Bounded production acceptance</h3><span>Four source records maximum</span></div>
            <b className={`pill pill-${acceptanceTone(acceptanceResult)}`}>
              {acceptanceRunning ? 'RUNNING' : acceptanceResult ? `${acceptanceResult.verifiedCount}/4 VERIFIED` : 'NOT RUN'}
            </b>
          </div>

          <p className="unleashed-acceptance-note">
            Unleashed receives GET requests only. EcoFlow stores or refreshes at most one source snapshot for each resource below, then reads each exact target twice to verify that an unchanged replay writes nothing.
          </p>
          <ul className="unleashed-acceptance-scope">
            {Object.values(ACCEPTANCE_RESOURCE_LABELS).map((label) => <li key={label}>{label}</li>)}
          </ul>

          <label className="unleashed-acceptance-confirm">
            <input
              type="checkbox"
              checked={acceptanceAcknowledged}
              disabled={acceptanceRunning}
              onChange={(event) => setAcceptanceAcknowledged(event.target.checked)}
            />
            <span>I confirm this bounded source-snapshot write. Business records and inventory authority will not change.</span>
          </label>

          {acceptanceError ? <div className="error-message" role="alert">{acceptanceError}</div> : null}
          {acceptanceResult ? (
            <div className="unleashed-acceptance-result" role="status">
              <div className="unleashed-acceptance-summary">
                <span>Seed run <strong>{acceptanceResult.seedRunId.slice(0, 8)}</strong></span>
                <span>Source records checked <strong>{acceptanceResult.seedRecordsSeen}</strong></span>
                <span>Snapshots written <strong>{acceptanceResult.seedRecordsStaged}</strong></span>
                <span>Already unchanged <strong>{acceptanceResult.seedRecordsUnchanged}</strong></span>
              </div>
              <div className="unleashed-acceptance-checks">
                {acceptanceResult.checks.map((check) => (
                  <div key={check.resource}>
                    <span><strong>{ACCEPTANCE_RESOURCE_LABELS[check.resource]}</strong><small>{check.error ?? 'Exact target read and unchanged replay passed.'}</small></span>
                    <b className={`pill pill-${check.status === 'VERIFIED' ? 'good' : check.status === 'FAILED' ? 'danger' : 'warning'}`}>{check.status}</b>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            className="primary unleashed-acceptance-run"
            disabled={!acceptanceAcknowledged || acceptanceRunning || running}
            onClick={() => void runAcceptance()}
          >
            <Database aria-hidden="true" size={17} />
            {acceptanceRunning ? 'Running acceptance…' : 'Store sample and verify replay'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
