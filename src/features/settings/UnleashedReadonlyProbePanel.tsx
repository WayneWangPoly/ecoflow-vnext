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
  runAuthorizedCustomerC4,
  type CustomerC4Result,
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
  const [customerC4Running, setCustomerC4Running] = useState(false);
  const [customerC4Attempted, setCustomerC4Attempted] = useState(false);
  const [customerC4Result, setCustomerC4Result] = useState<CustomerC4Result | null>(null);
  const [error, setError] = useState('');
  const [surveyError, setSurveyError] = useState('');
  const [customerC4Error, setCustomerC4Error] = useState('');
  const customerMutationAttemptedRef = useRef(false);

  const anyRunning = running || surveyRunning || customerC4Running;

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

  async function runCustomerC4() {
    if (anyRunning || customerC4Result || customerMutationAttemptedRef.current) return;
    customerMutationAttemptedRef.current = true;
    setCustomerC4Attempted(true);
    setCustomerC4Running(true);
    setCustomerC4Error('');
    try {
      setCustomerC4Result(await runAuthorizedCustomerC4(supabase));
    } catch (runError) {
      setCustomerC4Error(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setCustomerC4Running(false);
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
        <div><span>Customer C1-C3</span><strong>verified · 600/623 unique staged</strong></div>
        <div><span>C3 continuation anchor</span><strong>{CUSTOMER_STAGING_PLAN.c3Verification.continuationAnchorRunId.slice(0, 8)}</strong></div>
        <div><span>Currently exposed</span><strong>C4 final · page 4 · 23 rows</strong></div>
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
        <button type="button" className="primary" onClick={() => void runCustomerC4()} disabled={anyRunning || customerC4Attempted || Boolean(customerC4Result)}>
          <Database aria-hidden="true" size={17} />
          {customerC4Running ? 'Executing customer C4…' : customerC4Result ? 'Customer C4 completed' : customerC4Attempted ? 'Customer C4 attempt sent' : 'Execute authorized #338 customer C4'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        C3 is closed from production evidence: run {CUSTOMER_STAGING_PLAN.c3Verification.runId} inserted exactly 200 page-3 rows, matched the locked SHA, left zero changed/unchanged/failed rows, advanced the cursor to page 4, left no active lease and produced exactly 600 unique customer snapshots and identities. C4 is the final authorized customer window and is bound to previousRunId={CUSTOMER_STAGING_PLAN.c3Verification.continuationAnchorRunId}. It must read exactly 23 rows from page 4, match the locked page-4 SHA, insert exactly 23 rows, report zero changed/unchanged/failed rows, finish with allResourcesComplete=true, window_complete=true and next_page=null. The button uses a synchronous one-shot lock. Products non-dry, PLAN, COPY_IMAGES, Product Identity, inventory, opening balance and cutover remain blocked.
      </p>

      {customerC4Error ? <div className="error-message" role="alert">{customerC4Error}</div> : null}
      {customerC4Result ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>customers C4</strong>
                <small>{customerC4Result.recordsInserted} inserted · page 4 · run {customerC4Result.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">CUSTOMERS COMPLETE</b>
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
