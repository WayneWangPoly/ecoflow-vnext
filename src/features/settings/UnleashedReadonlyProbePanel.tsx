import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Database, RadioTower } from 'lucide-react';
import {
  runUnleashedReadonlyProbe,
  type UnleashedProbeResult,
} from '../team/unleashedReadonlyProbe';
import {
  itemCountForResource,
  runRemainingMasterDrySurvey,
  type RemainingMasterDrySurveyResult,
} from '../team/unleashedRemainingMasterDrySurvey';
import {
  runCustomerDeliveryAddressContinuation,
  type AddressContinuationResult,
} from '../team/unleashedCustomerDeliveryAddressStaging';
import { ADDRESS_CONTINUATION_PLAN } from '../team/unleashedCustomerDeliveryAddressContinuationPlan';
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
  const [surveyRunning, setSurveyRunning] = useState(false);
  const [surveyResult, setSurveyResult] = useState<RemainingMasterDrySurveyResult | null>(null);
  const [continuationRunning, setContinuationRunning] = useState(false);
  const [continuationResult, setContinuationResult] = useState<AddressContinuationResult | null>(null);
  const [error, setError] = useState('');
  const [surveyError, setSurveyError] = useState('');
  const [continuationError, setContinuationError] = useState('');

  const anyRunning = running || surveyRunning || continuationRunning;

  async function runProbe() {
    if (anyRunning) return;
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

  async function runSurvey() {
    if (anyRunning) return;
    setSurveyRunning(true);
    setSurveyResult(null);
    setSurveyError('');
    try {
      setSurveyResult(await runRemainingMasterDrySurvey(supabase));
    } catch (runError) {
      setSurveyError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setSurveyRunning(false);
    }
  }

  async function runAuthorizedContinuation() {
    if (anyRunning || continuationResult) return;
    setContinuationRunning(true);
    setContinuationError('');
    try {
      setContinuationResult(await runCustomerDeliveryAddressContinuation(supabase));
    } catch (runError) {
      setContinuationError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setContinuationRunning(false);
    }
  }

  const customerCount = surveyResult ? itemCountForResource(surveyResult, 'customers') : null;
  const productCount = surveyResult ? itemCountForResource(surveyResult, 'products') : null;

  return (
    <section className="panel unleashed-probe-panel">
      <div className="panel-head">
        <div><h2>Unleashed connection</h2><span>GET only upstream · #338 bounded acquisition controls</span></div>
        <b className={`pill pill-${probeTone(result)}`}>{running ? 'RUNNING' : result?.status ?? 'NOT TESTED'}</b>
      </div>

      {error ? <div className="error-message" role="alert">{error}</div> : null}
      {result ? <div className="success-message" role="status">Connection test recorded · {result.runId.slice(0, 8)}</div> : null}

      <div className="system-status-grid">
        <div><span>Last test</span><strong>{formatTime(result?.requestedAt)}</strong></div>
        <div><span>Authorized resource</span><strong>Customer delivery addresses only</strong></div>
        <div><span>Continuation</span><strong>page 3 → 4 · 84 expected</strong></div>
        <div><span>Non-dry</span><strong>1B-5B only</strong></div>
      </div>

      <div className="system-sync-actions unleashed-probe-actions">
        <button type="button" onClick={() => void runProbe()} disabled={anyRunning}>
          <RadioTower aria-hidden="true" size={17} />
          {running ? 'Testing…' : 'Run one-page dry test'}
        </button>
        <button type="button" onClick={() => void runSurvey()} disabled={anyRunning}>
          <Database aria-hidden="true" size={17} />
          {surveyRunning ? 'Reading customers + products…' : 'Run #338 remaining master dry survey'}
        </button>
        <button type="button" className="primary" onClick={() => void runAuthorizedContinuation()} disabled={anyRunning || Boolean(continuationResult)}>
          <Database aria-hidden="true" size={17} />
          {continuationRunning ? 'Executing 1B-5B…' : continuationResult ? '1B-5B completed' : 'Execute authorized #338 1B-5B'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        Batch 1B-5B is the only exposed non-dry action. It invokes exactly customer_delivery_addresses with startPage={ADDRESS_CONTINUATION_PLAN.startPage}, pageSize={ADDRESS_CONTINUATION_PLAN.pageSize}, maxPages={ADDRESS_CONTINUATION_PLAN.maxPages}, and previousRunId={ADDRESS_CONTINUATION_PLAN.previousRunId}. Acceptance requires exactly 84 inserted rows, locked page 3/4 response hashes, zero failures, and a terminal completed window. PLAN, COPY_IMAGES, Product Identity, inventory and cutover remain blocked.
      </p>

      {continuationError ? <div className="error-message" role="alert">{continuationError}</div> : null}
      {continuationResult ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>customer_delivery_addresses</strong>
                <small>{continuationResult.recordsInserted} inserted · pages 3-4 · run {continuationResult.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">1B-5B COMPLETE</b>
            </div>
          </div>
        </div>
      ) : null}

      {surveyError ? <div className="error-message" role="alert">{surveyError}</div> : null}
      {surveyResult ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>customers</strong>
                <small>{customerCount ?? 'n/a'} source records · {surveyResult.paginationWindows.find((window) => window.resource === 'customers')?.numberOfPages ?? 'n/a'} pages</small>
              </span>
              <b className="pill pill-good">DRY COMPLETE</b>
            </div>
            <div>
              <span>
                <strong>products</strong>
                <small>{productCount ?? 'n/a'} source records · {surveyResult.paginationWindows.find((window) => window.resource === 'products')?.numberOfPages ?? 'n/a'} pages · run {surveyResult.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">DRY COMPLETE</b>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
