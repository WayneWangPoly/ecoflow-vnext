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
import { CUSTOMER_STAGING_PLAN } from '../team/unleashedCustomerStagingPlan';
import {
  runAuthorizedCustomerC1,
  type CustomerC1Result,
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
  const [customerC1Running, setCustomerC1Running] = useState(false);
  const [customerC1Result, setCustomerC1Result] = useState<CustomerC1Result | null>(null);
  const [error, setError] = useState('');
  const [surveyError, setSurveyError] = useState('');
  const [customerC1Error, setCustomerC1Error] = useState('');

  const anyRunning = running || surveyRunning || customerC1Running;

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

  async function runCustomerC1() {
    if (anyRunning || customerC1Result) return;
    setCustomerC1Running(true);
    setCustomerC1Error('');
    try {
      setCustomerC1Result(await runAuthorizedCustomerC1(supabase));
    } catch (runError) {
      setCustomerC1Error(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setCustomerC1Running(false);
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
        <div><span>Customer source</span><strong>623 records · 4 pages · dry evidence locked</strong></div>
        <div><span>Authorized scope</span><strong>C1-C4 · one window then verify</strong></div>
        <div><span>Currently exposed</span><strong>C1 only · page 1 · 200 rows</strong></div>
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
        <button type="button" className="primary" onClick={() => void runCustomerC1()} disabled={anyRunning || Boolean(customerC1Result)}>
          <Database aria-hidden="true" size={17} />
          {customerC1Running ? 'Executing customer C1…' : customerC1Result ? 'Customer C1 completed' : 'Execute authorized #338 customer C1'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        Customer C1 is the only exposed non-dry action. It invokes exactly customers page 1 with pageSize={CUSTOMER_STAGING_PLAN.executionShape.pageSize}, maxPages=1 and no previousRunId. Acceptance requires exactly 200 inserted rows, the locked page-1 SHA from dry run {CUSTOMER_STAGING_PLAN.freshSourceEvidence.dryRunId.slice(0, 8)}, zero changed/unchanged/failed rows, an incomplete window with next_page=2, and the locked high-water mark. C2 remains hidden until Chat verifies C1 production evidence. Products non-dry, PLAN, COPY_IMAGES, Product Identity, inventory, opening balance and cutover remain blocked.
      </p>

      {customerC1Error ? <div className="error-message" role="alert">{customerC1Error}</div> : null}
      {customerC1Result ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>customers C1</strong>
                <small>{customerC1Result.recordsInserted} inserted · page 1 · run {customerC1Result.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">C1 COMPLETE</b>
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
