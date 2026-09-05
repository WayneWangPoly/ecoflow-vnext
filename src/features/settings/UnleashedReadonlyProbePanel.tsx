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
  runAuthorizedProductP1,
  type ProductP1Result,
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
  const [productP1Running, setProductP1Running] = useState(false);
  const [productP1Attempted, setProductP1Attempted] = useState(false);
  const [productP1Result, setProductP1Result] = useState<ProductP1Result | null>(null);
  const [error, setError] = useState('');
  const [surveyError, setSurveyError] = useState('');
  const [productP1Error, setProductP1Error] = useState('');
  const productMutationAttemptedRef = useRef(false);

  const anyRunning = running || surveyRunning || productP1Running;

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

  async function runProductP1() {
    if (anyRunning || productP1Result || productMutationAttemptedRef.current) return;
    productMutationAttemptedRef.current = true;
    setProductP1Attempted(true);
    setProductP1Running(true);
    setProductP1Error('');
    try {
      setProductP1Result(await runAuthorizedProductP1(supabase));
    } catch (runError) {
      setProductP1Error(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setProductP1Running(false);
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
        <div><span>Product acquisition</span><strong>authorized P1-P3 · 466 source rows</strong></div>
        <div><span>Currently exposed</span><strong>P1 only · page 1 · 200 rows</strong></div>
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
        <button type="button" className="primary" onClick={() => void runProductP1()} disabled={anyRunning || productP1Attempted || Boolean(productP1Result)}>
          <Database aria-hidden="true" size={17} />
          {productP1Running ? 'Executing product P1…' : productP1Result ? 'Product P1 completed' : productP1Attempted ? 'Product P1 attempt sent' : 'Execute authorized #338 product P1'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        Customer C1-C4 is closed at 623/623. Product P1-P3 is now separately authorized, but only P1 is exposed. P1 is fixed to products page 1, pageSize=200 and maxPages=1 and must match the locked page-1 SHA and 466/3 pagination. Production begins with exactly one historical targeted product snapshot, so P1 may consume zero or one unit of the one-overlap budget: inserted + changed + unchanged must equal 200, changed + unchanged may be only 0 or 1, and staged must equal inserted + changed. P2 remains hidden until Chat verifies production cursor, lease, DB delta and remaining overlap budget. PLAN, COPY_IMAGES, Product Identity, inventory, opening balance and cutover remain blocked.
      </p>

      {productP1Error ? <div className="error-message" role="alert">{productP1Error}</div> : null}
      {productP1Result ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>products P1</strong>
                <small>{productP1Result.recordsInserted} inserted · {productP1Result.recordsChanged} changed · {productP1Result.recordsUnchanged} unchanged · run {productP1Result.runId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">P1 COMPLETE</b>
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
