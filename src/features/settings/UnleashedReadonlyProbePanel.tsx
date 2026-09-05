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
import { PRODUCT_STAGING_PLAN } from '../team/unleashedProductStagingPlan';
import {
  runAuthorizedProductP3,
  type ProductP3Result,
} from '../team/unleashedProductStaging';
import './teamAccessSettings.css';

function probeTone(result: UnleashedProbeResult | null) {
  if (!result) return 'neutral';
  return result.ok && result.status === 'SUCCEEDED' && result.recordsFailed === 0 ? 'good' : 'danger';
}

export function UnleashedReadonlyProbePanel({ supabase }: { supabase: SupabaseClient }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<UnleashedProbeResult | null>(null);
  const [surveyRunning, setSurveyRunning] = useState(false);
  const [surveyResult, setSurveyResult] = useState<RemainingMasterDrySurveyResult | null>(null);
  const [productP3Running, setProductP3Running] = useState(false);
  const [productP3Attempted, setProductP3Attempted] = useState(false);
  const [productP3Result, setProductP3Result] = useState<ProductP3Result | null>(null);
  const [error, setError] = useState('');
  const [surveyError, setSurveyError] = useState('');
  const [productP3Error, setProductP3Error] = useState('');
  const productMutationAttemptedRef = useRef(false);

  const anyRunning = running || surveyRunning || productP3Running;

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

  async function runProductP3() {
    if (anyRunning || productP3Result || productMutationAttemptedRef.current) return;
    productMutationAttemptedRef.current = true;
    setProductP3Attempted(true);
    setProductP3Running(true);
    setProductP3Error('');
    try {
      setProductP3Result(await runAuthorizedProductP3(supabase));
    } catch (runError) {
      setProductP3Error(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setProductP3Running(false);
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
        <div><span>Address acquisition</span><strong>closed · 184/184 staged</strong></div>
        <div><span>Customer acquisition</span><strong>closed · 623/623 staged</strong></div>
        <div><span>Product P1 + P2</span><strong>verified · 400/466 staged</strong></div>
        <div><span>Currently exposed</span><strong>P3 final only · page 3 · 66 rows</strong></div>
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
        <button type="button" className="primary" onClick={() => void runProductP3()} disabled={anyRunning || productP3Attempted || Boolean(productP3Result)}>
          <Database aria-hidden="true" size={17} />
          {productP3Running ? 'Executing product P3…' : productP3Result ? 'Product P3 completed' : productP3Attempted ? 'Product P3 attempt sent' : 'Execute authorized #338 product P3'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        Product P1 is verified at run 162e9838-bcb1-45b9-84c3-334bca8c202c with 199 inserted + 1 unchanged, consuming the only historical overlap. Product P2 is verified at run 4a531e9f-68ff-4c41-9d39-7eef57cdc0eb with exactly 200 inserted and no changed/unchanged rows; products now stand at 400/466 snapshots and identities and the cursor is RUNNING at next_page=3. P3 is the only exposed non-dry action and is fixed to products page 3, pageSize=200, maxPages=1 and previousRunId=4a531e9f-68ff-4c41-9d39-7eef57cdc0eb. It must be exactly 66 inserted, 0 changed, 0 unchanged and 0 failed, match the locked page-3 SHA, finish allResourcesComplete=true, window_complete=true and next_page=null. PLAN, COPY_IMAGES, Product Identity, inventory, opening balance and cutover remain blocked.
      </p>

      {productP3Error ? <div className="error-message" role="alert">{productP3Error}</div> : null}
      {productP3Result ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>products P3 final</strong>
                <small>{productP3Result.recordsInserted} inserted · {productP3Result.recordsChanged} changed · {productP3Result.recordsUnchanged} unchanged · run {productP3Result.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">P3 COMPLETE</b>
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
