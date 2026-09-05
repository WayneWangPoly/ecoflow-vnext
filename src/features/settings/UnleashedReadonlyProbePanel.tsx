import { useRef, useState } from 'react';
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
import { CUSTOMER_STAGING_PLAN } from '../team/unleashedCustomerStagingPlan';
import {
  runAuthorizedCustomerC2,
  type CustomerC2Result,
} from '../team/unleashedCustomerStaging';
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
  const [customerC2Running, setCustomerC2Running] = useState(false);
  const [customerC2Attempted, setCustomerC2Attempted] = useState(false);
  const [customerC2Result, setCustomerC2Result] = useState<CustomerC2Result | null>(null);
  const [error, setError] = useState('');
  const [surveyError, setSurveyError] = useState('');
  const [customerC2Error, setCustomerC2Error] = useState('');
  const customerMutationAttemptedRef = useRef(false);

  const anyRunning = running || surveyRunning || customerC2Running;

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

  async function runCustomerC2() {
    if (anyRunning || customerC2Result || customerMutationAttemptedRef.current) return;
    customerMutationAttemptedRef.current = true;
    setCustomerC2Attempted(true);
    setCustomerC2Running(true);
    setCustomerC2Error('');
    try {
      setCustomerC2Result(await runAuthorizedCustomerC2(supabase));
    } catch (runError) {
      setCustomerC2Error(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setCustomerC2Running(false);
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
        <div><span>Address acquisition</span><strong>1B-5B closed · 184/184 staged</strong></div>
        <div><span>Customer C1</span><strong>verified · 200/623 unique staged</strong></div>
        <div><span>C1 continuation anchor</span><strong>{CUSTOMER_STAGING_PLAN.c1Verification.continuationAnchorRunId.slice(0, 8)}</strong></div>
        <div><span>Currently exposed</span><strong>C2 only · page 2 · 200 rows</strong></div>
      </div>

      <div className="system-sync-actions unleashed-probe-actions">
        <button type="button" onClick={() => void runProbe()} disabled={anyRunning}>
          <RadioTower aria-hidden="true" size={17} />
          {running ? 'Testing…' : 'Run one-page dry test'}
        </button>
        <button type="button" onClick={() => void runSurvey()} disabled={anyRunning}>
          <Database aria-hidden="true" size={17} />
          {surveyRunning ? 'Reading customers + products…' : 'Run fresh #338 customer/product dry preflight'}
        </button>
        <button type="button" className="primary" onClick={() => void runCustomerC2()} disabled={anyRunning || customerC2Attempted || Boolean(customerC2Result)}>
          <Database aria-hidden="true" size={17} />
          {customerC2Running ? 'Executing customer C2…' : customerC2Result ? 'Customer C2 completed' : customerC2Attempted ? 'Customer C2 attempt sent' : 'Execute authorized #338 customer C2'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        C1 is closed from production evidence. Its first run inserted exactly 200 rows and a subsequent idempotent page-1 replay inserted 0 / reported 200 unchanged, leaving exactly 200 unique customer snapshots and identities. The earlier UI rejection was caused by comparing a full four-page dry-window high-water mark against a single-page window; that invalid comparison has been removed. C2 is now the only non-dry action and is bound to previousRunId={CUSTOMER_STAGING_PLAN.c1Verification.continuationAnchorRunId}. It requires the locked page-2 SHA, exactly 200 inserts, zero changed/unchanged/failed rows and next_page=3. The button uses a synchronous one-shot lock: after one attempt it cannot be clicked again on this page. C3 remains hidden until Chat verifies C2. Products non-dry, PLAN, COPY_IMAGES, Product Identity, inventory, opening balance and cutover remain blocked.
      </p>

      {customerC2Error ? <div className="error-message" role="alert">{customerC2Error}</div> : null}
      {customerC2Result ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>customers C2</strong>
                <small>{customerC2Result.recordsInserted} inserted · page 2 · run {customerC2Result.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">C2 COMPLETE</b>
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
