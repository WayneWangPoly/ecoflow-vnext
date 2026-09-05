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
  runAuthorizedProductP2,
  type ProductP2Result,
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
  const [productP2Running, setProductP2Running] = useState(false);
  const [productP2Attempted, setProductP2Attempted] = useState(false);
  const [productP2Result, setProductP2Result] = useState<ProductP2Result | null>(null);
  const [error, setError] = useState('');
  const [surveyError, setSurveyError] = useState('');
  const [productP2Error, setProductP2Error] = useState('');
  const productMutationAttemptedRef = useRef(false);

  const anyRunning = running || surveyRunning || productP2Running;

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

  async function runProductP2() {
    if (anyRunning || productP2Result || productMutationAttemptedRef.current) return;
    productMutationAttemptedRef.current = true;
    setProductP2Attempted(true);
    setProductP2Running(true);
    setProductP2Error('');
    try {
      setProductP2Result(await runAuthorizedProductP2(supabase));
    } catch (runError) {
      setProductP2Error(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setProductP2Running(false);
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
        <div><span>Product P1</span><strong>verified · 199 inserted + 1 unchanged</strong></div>
        <div><span>Currently exposed</span><strong>P2 only · page 2 · 200 rows</strong></div>
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
        <button type="button" className="primary" onClick={() => void runProductP2()} disabled={anyRunning || productP2Attempted || Boolean(productP2Result)}>
          <Database aria-hidden="true" size={17} />
          {productP2Running ? 'Executing product P2…' : productP2Result ? 'Product P2 completed' : productP2Attempted ? 'Product P2 attempt sent' : 'Execute authorized #338 product P2'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        Product P1 is verified in production at run 162e9838-bcb1-45b9-84c3-334bca8c202c: page 1 matched the locked SHA and 466/3 pagination, with 199 inserted and the one historical product classified unchanged. The one-overlap budget is therefore fully consumed. P2 is now the only exposed non-dry action and is fixed to products page 2, pageSize=200, maxPages=1 and previousRunId=162e9838-bcb1-45b9-84c3-334bca8c202c. P2 must be exactly 200 inserted, 0 changed, 0 unchanged and 0 failed, with the locked page-2 SHA and next_page=3. P3 remains hidden pending production verification. PLAN, COPY_IMAGES, Product Identity, inventory, opening balance and cutover remain blocked.
      </p>

      {productP2Error ? <div className="error-message" role="alert">{productP2Error}</div> : null}
      {productP2Result ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>products P2</strong>
                <small>{productP2Result.recordsInserted} inserted · {productP2Result.recordsChanged} changed · {productP2Result.recordsUnchanged} unchanged · run {productP2Result.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">P2 COMPLETE</b>
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
