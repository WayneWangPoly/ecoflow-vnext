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
  runAuthorizedCustomerC3,
  type CustomerC3Result,
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
  const [customerC3Running, setCustomerC3Running] = useState(false);
  const [customerC3Attempted, setCustomerC3Attempted] = useState(false);
  const [customerC3Result, setCustomerC3Result] = useState<CustomerC3Result | null>(null);
  const [error, setError] = useState('');
  const [surveyError, setSurveyError] = useState('');
  const [customerC3Error, setCustomerC3Error] = useState('');
  const customerMutationAttemptedRef = useRef(false);

  const anyRunning = running || surveyRunning || customerC3Running;

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

  async function runCustomerC3() {
    if (anyRunning || customerC3Result || customerMutationAttemptedRef.current) return;
    customerMutationAttemptedRef.current = true;
    setCustomerC3Attempted(true);
    setCustomerC3Running(true);
    setCustomerC3Error('');
    try {
      setCustomerC3Result(await runAuthorizedCustomerC3(supabase));
    } catch (runError) {
      setCustomerC3Error(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setCustomerC3Running(false);
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
        <div><span>Customer C1-C2</span><strong>verified · 400/623 unique staged</strong></div>
        <div><span>C2 continuation anchor</span><strong>{CUSTOMER_STAGING_PLAN.c2Verification.continuationAnchorRunId.slice(0, 8)}</strong></div>
        <div><span>Currently exposed</span><strong>C3 only · page 3 · 200 rows</strong></div>
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
        <button type="button" className="primary" onClick={() => void runCustomerC3()} disabled={anyRunning || customerC3Attempted || Boolean(customerC3Result)}>
          <Database aria-hidden="true" size={17} />
          {customerC3Running ? 'Executing customer C3…' : customerC3Result ? 'Customer C3 completed' : customerC3Attempted ? 'Customer C3 attempt sent' : 'Execute authorized #338 customer C3'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        C2 is closed from production evidence: run {CUSTOMER_STAGING_PLAN.c2Verification.runId} inserted exactly 200 page-2 rows, matched the locked SHA, left zero changed/unchanged/failed rows, advanced the cursor to page 3 and left no active lease. The C2 UI rejection was a validator defect: the deployed Edge Function returns previousRunId at the response top level, not inside paginationWindows. C3 validation now follows the actual Edge Function response contract only. C3 is bound to previousRunId={CUSTOMER_STAGING_PLAN.c2Verification.continuationAnchorRunId}, must insert exactly 200 page-3 rows, match the locked SHA, report zero changed/unchanged/failed rows and advance to next_page=4. C4 remains hidden until Chat verifies C3. Products non-dry, PLAN, COPY_IMAGES, Product Identity, inventory, opening balance and cutover remain blocked.
      </p>

      {customerC3Error ? <div className="error-message" role="alert">{customerC3Error}</div> : null}
      {customerC3Result ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>customers C3</strong>
                <small>{customerC3Result.recordsInserted} inserted · page 3 · run {customerC3Result.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">C3 COMPLETE</b>
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
