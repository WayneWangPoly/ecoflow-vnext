import { Suspense, lazy, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Database, RadioTower, ShieldCheck, Warehouse } from 'lucide-react';
import {
  runUnleashedConnectorAcceptance,
  type UnleashedAcceptanceResource,
  type UnleashedAcceptanceResult,
} from '../team/unleashedConnectorAcceptance';
import { runUnleashedReadonlyProbe, type UnleashedProbeResult } from '../team/unleashedReadonlyProbe';
import {
  runR5002R2Adl1StockOnHandAcquisition,
  runR5008Adl1StockOnHandAcquisition,
  type R5002AcquisitionResult,
} from '../team/unleashedAdl1StockOnHandAcquisition';
import { InventoryReferenceStagePanel } from './InventoryReferenceStagePanel';
import './teamAccessSettings.css';

const MappingPlanOnlyPanel = lazy(async () => {
  const module = await import('./MappingPlanOnlyPanel');
  return { default: module.MappingPlanOnlyPanel };
});

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

function acquisitionTone(result: R5002AcquisitionResult | null, error: string) {
  if (result) return 'good';
  if (error) return 'danger';
  return 'neutral';
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
  const [acquisitionOpen, setAcquisitionOpen] = useState(false);
  const [acquisitionAcknowledged, setAcquisitionAcknowledged] = useState(false);
  const [acquisitionRunning, setAcquisitionRunning] = useState(false);
  const [acquisitionAttempted, setAcquisitionAttempted] = useState(false);
  const [acquisitionResult, setAcquisitionResult] = useState<R5002AcquisitionResult | null>(null);
  const [acquisitionError, setAcquisitionError] = useState('');
  const [freshOpen, setFreshOpen] = useState(false);
  const [freshAcknowledged, setFreshAcknowledged] = useState(false);
  const [freshRunning, setFreshRunning] = useState(false);
  const [freshAttempted, setFreshAttempted] = useState(false);
  const [freshResult, setFreshResult] = useState<R5002AcquisitionResult | null>(null);
  const [freshError, setFreshError] = useState('');

  async function runProbe() {
    if (running || acceptanceRunning || acquisitionRunning || freshRunning) return;
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
    if (!acceptanceAcknowledged || acceptanceRunning || running || acquisitionRunning) return;
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

  async function runAcquisition() {
    if (
      !acquisitionAcknowledged
      || acquisitionRunning
      || acquisitionAttempted
      || running
      || acceptanceRunning
      || freshRunning
    ) return;
    setAcquisitionAttempted(true);
    setAcquisitionRunning(true);
    setAcquisitionResult(null);
    setAcquisitionError('');
    try {
      setAcquisitionResult(await runR5002R2Adl1StockOnHandAcquisition(supabase));
    } catch (runError) {
      setAcquisitionError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setAcquisitionRunning(false);
      setAcquisitionAcknowledged(false);
    }
  }

  async function runFreshAcquisition() {
    if (
      !freshAcknowledged
      || freshRunning
      || freshAttempted
      || running
      || acceptanceRunning
      || acquisitionRunning
    ) return;
    setFreshAttempted(true);
    setFreshRunning(true);
    setFreshResult(null);
    setFreshError('');
    try {
      setFreshResult(await runR5008Adl1StockOnHandAcquisition(supabase));
    } catch (runError) {
      setFreshError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setFreshRunning(false);
      setFreshAcknowledged(false);
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
        <button type="button" className="primary" onClick={() => void runProbe()} disabled={running || acceptanceRunning || acquisitionRunning || freshRunning}>
          <RadioTower aria-hidden="true" size={17} />
          {running ? 'Testing…' : 'Run one-page test'}
        </button>
        <button
          type="button"
          aria-expanded={acceptanceOpen}
          aria-controls="unleashed-production-acceptance"
          onClick={() => setAcceptanceOpen((current) => !current)}
          disabled={running || acceptanceRunning || acquisitionRunning || freshRunning}
        >
          <ShieldCheck aria-hidden="true" size={17} />
          {acceptanceOpen ? 'Close acceptance' : 'Review production acceptance'}
        </button>
        <button
          type="button"
          aria-expanded={acquisitionOpen}
          aria-controls="unleashed-r5-002-acquisition"
          onClick={() => setAcquisitionOpen((current) => !current)}
          disabled={running || acceptanceRunning || acquisitionRunning || freshRunning}
        >
          <Warehouse aria-hidden="true" size={17} />
          {acquisitionOpen ? 'Close ADL1 acquisition' : 'Review ADL1 acquisition'}
        </button>
        <button
          type="button"
          aria-expanded={freshOpen}
          aria-controls="unleashed-r5-008-acquisition"
          onClick={() => setFreshOpen((current) => !current)}
          disabled={running || acceptanceRunning || acquisitionRunning || freshRunning}
        >
          <Warehouse aria-hidden="true" size={17} />
          {freshOpen ? 'Close fresh ADL1 snapshot' : 'Review fresh ADL1 snapshot'}
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
              {acceptanceResult.seedStatus === 'PARTIAL' ? (
                <div className="unleashed-acceptance-warning">
                  Source coverage is incomplete. {acceptanceResult.seedRecordsFailed} resource read failed and remains unverified.
                  {acceptanceResult.seedErrorMessage ? ` ${acceptanceResult.seedErrorMessage}.` : ''}
                </div>
              ) : null}
              <div className="unleashed-acceptance-summary">
                <span>Seed run <strong>{acceptanceResult.seedRunId.slice(0, 8)}</strong></span>
                <span>Source records checked <strong>{acceptanceResult.seedRecordsSeen}</strong></span>
                <span>Snapshots written <strong>{acceptanceResult.seedRecordsStaged}</strong></span>
                <span>Source read failures <strong>{acceptanceResult.seedRecordsFailed}</strong></span>
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
            disabled={!acceptanceAcknowledged || acceptanceRunning || running || acquisitionRunning}
            onClick={() => void runAcceptance()}
          >
            <Database aria-hidden="true" size={17} />
            {acceptanceRunning ? 'Running acceptance…' : 'Store sample and verify replay'}
          </button>
        </div>
      ) : null}

      {acquisitionOpen ? (
        <div className="unleashed-acceptance unleashed-r5-acquisition" id="unleashed-r5-002-acquisition">
          <div className="unleashed-acceptance-head">
            <div><h3>R5-002-R2 ADL1 StockOnHand recovery</h3><span>Authorized recovery · one shot · pages 1–5 · 200 rows per page</span></div>
            <b className={`pill pill-${acquisitionTone(acquisitionResult, acquisitionError)}`}>
              {acquisitionRunning ? 'RUNNING' : acquisitionResult ? 'SUCCEEDED' : acquisitionAttempted ? 'ATTEMPTED' : 'NOT RUN'}
            </b>
          </div>

          <p className="unleashed-acceptance-note">
            This sends GET-only StockOnHand requests scoped to warehouse ADL1 and stores source evidence only.
            No STAGE, opening balance, stocktake, inventory movement, or Product Identity mutation.
          </p>
          <ul className="unleashed-acceptance-scope">
            <li>Resource: stock_on_hand</li>
            <li>Warehouse: ADL1</li>
            <li>Window: page 1, maximum 5 pages</li>
            <li>Request key: ECOFLOW-R5-002-R2</li>
          </ul>

          <label className="unleashed-acceptance-confirm">
            <input
              type="checkbox"
              checked={acquisitionAcknowledged}
              disabled={acquisitionRunning || acquisitionAttempted}
              onChange={(event) => setAcquisitionAcknowledged(event.target.checked)}
            />
            <span>I confirm this authorized R5-002-R2 recovery acquisition and understand this control allows one attempt only.</span>
          </label>

          {acquisitionError ? <div className="error-message" role="alert">{acquisitionError}</div> : null}
          {acquisitionResult ? (
            <div className="unleashed-acceptance-result" role="status">
              <div className="unleashed-acceptance-summary">
                <span>Run <strong>{acquisitionResult.runId.slice(0, 8)}</strong></span>
                <span>Pages <strong>{acquisitionResult.pages.length}</strong></span>
                <span>Source rows <strong>{acquisitionResult.recordsSeen}</strong></span>
                <span>Window <strong>{acquisitionResult.paginationWindows[0].windowComplete ? 'COMPLETE' : 'INCOMPLETE'}</strong></span>
              </div>
            </div>
          ) : null}

          {acquisitionAttempted ? (
            <div className="unleashed-acceptance-warning" role="status">
              Do not retry. Verify the production ledger first.
            </div>
          ) : null}

          <button
            type="button"
            className="primary unleashed-acceptance-run"
            disabled={!acquisitionAcknowledged || acquisitionRunning || acquisitionAttempted || running || acceptanceRunning}
            onClick={() => void runAcquisition()}
          >
            <Database aria-hidden="true" size={17} />
            {acquisitionRunning ? 'Acquiring ADL1 recovery evidence…' : acquisitionAttempted ? 'Attempt locked' : 'Run R5-002-R2 once'}
          </button>
        </div>
      ) : null}

      {freshOpen ? (
        <div className="unleashed-acceptance unleashed-r5-acquisition" id="unleashed-r5-008-acquisition">
          <div className="unleashed-acceptance-head">
            <div><h3>R5-008 fresh ADL1 StockOnHand pre-stocktake snapshot</h3><span>Fresh pre-stocktake evidence · one shot · pages 1–5 · 200 rows per page</span></div>
            <b className={`pill pill-${acquisitionTone(freshResult, freshError)}`}>
              {freshRunning ? 'RUNNING' : freshResult ? 'SUCCEEDED' : freshAttempted ? 'ATTEMPTED' : 'NOT RUN'}
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
              checked={freshAcknowledged}
              disabled={freshRunning || freshAttempted}
              onChange={(event) => setFreshAcknowledged(event.target.checked)}
            />
            <span>I confirm this fresh pre-stocktake ADL1 source acquisition and understand this request key allows one attempt only.</span>
          </label>

          {freshError ? <div className="error-message" role="alert">{freshError}</div> : null}
          {freshResult ? (
            <div className="unleashed-acceptance-result" role="status">
              <div className="unleashed-acceptance-summary">
                <span>Run <strong>{freshResult.runId.slice(0, 8)}</strong></span>
                <span>Pages <strong>{freshResult.pages.length}</strong></span>
                <span>Source rows <strong>{freshResult.recordsSeen}</strong></span>
                <span>Window <strong>{freshResult.paginationWindows[0].windowComplete ? 'COMPLETE' : 'INCOMPLETE'}</strong></span>
              </div>
            </div>
          ) : null}

          {freshAttempted ? (
            <div className="unleashed-acceptance-warning" role="status">
              Do not retry. Verify the production ledger first.
            </div>
          ) : null}

          <button
            type="button"
            className="primary unleashed-acceptance-run"
            disabled={!freshAcknowledged || freshRunning || freshAttempted || running || acceptanceRunning || acquisitionRunning}
            onClick={() => void runFreshAcquisition()}
          >
            <Database aria-hidden="true" size={17} />
            {freshRunning ? 'Acquiring fresh ADL1 evidence…' : freshAttempted ? 'Attempt locked' : 'Acquire fresh ADL1 snapshot once'}
          </button>
        </div>
      ) : null}

      <Suspense fallback={<div className="unleashed-acceptance-note">Loading R5-006 mapping PLAN…</div>}>
        <MappingPlanOnlyPanel supabase={supabase} />
      </Suspense>
      <InventoryReferenceStagePanel supabase={supabase} />
    </section>
  );
}
