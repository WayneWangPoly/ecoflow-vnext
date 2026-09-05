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
import {
  runAuthorizedMasterPlan,
  type AuthorizedMasterPlanResult,
} from '../team/unleashedMasterMigrationPlan';
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
  const [planRunning, setPlanRunning] = useState(false);
  const [planAttempted, setPlanAttempted] = useState(false);
  const [planResult, setPlanResult] = useState<AuthorizedMasterPlanResult | null>(null);
  const [error, setError] = useState('');
  const [surveyError, setSurveyError] = useState('');
  const [planError, setPlanError] = useState('');
  const planAttemptedRef = useRef(false);

  const anyRunning = running || surveyRunning || planRunning;

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

  async function runPlan() {
    if (anyRunning || planAttemptedRef.current || planResult) return;
    planAttemptedRef.current = true;
    setPlanAttempted(true);
    setPlanRunning(true);
    setPlanError('');
    try {
      setPlanResult(await runAuthorizedMasterPlan(supabase));
    } catch (runError) {
      setPlanError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setPlanRunning(false);
    }
  }

  const customerCount = surveyResult ? itemCountForResource(surveyResult, 'customers') : null;
  const productCount = surveyResult ? itemCountForResource(surveyResult, 'products') : null;

  return (
    <section className="panel unleashed-probe-panel">
      <div className="panel-head">
        <div><h2>Unleashed connection</h2><span>GET-only source · #338 governed migration controls</span></div>
        <b className={`pill pill-${probeTone(result)}`}>{running ? 'RUNNING' : result?.status ?? 'NOT TESTED'}</b>
      </div>

      {error ? <div className="error-message" role="alert">{error}</div> : null}
      {result ? <div className="success-message" role="status">Connection test recorded · {result.runId.slice(0, 8)}</div> : null}

      <div className="system-status-grid">
        <div><span>Raw master acquisition</span><strong>closed · addresses 184 · customers 623 · products 466</strong></div>
        <div><span>Mapping PLAN baseline</span><strong>1300 planned · 158 matched · 1141 unmatched · 1 retired</strong></div>
        <div><span>Raw non-dry gates</span><strong>customers / products / stock_on_hand · CLOSED_DRY_ONLY</strong></div>
        <div><span>Currently exposed</span><strong>governed PLAN + asset locator plan only</strong></div>
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
        <button type="button" className="primary" onClick={() => void runPlan()} disabled={anyRunning || planAttempted || Boolean(planResult)}>
          <Database aria-hidden="true" size={17} />
          {planRunning ? 'Executing governed PLAN…' : planResult ? 'Governed PLAN completed' : planAttempted ? 'Governed PLAN attempt sent' : 'Execute authorized #338 governed PLAN + asset plan'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        Downstream #338 authority is granted, but the migration still advances through evidence gates. This action is deliberately limited to the deployed PLAN contract: it re-plans deterministic mappings idempotently, creates/updates only product-image locator plan rows, and ensures the private EcoFlow image bucket exists. Expected evidence is exactly 1300 mappings (158 matched, 0 ambiguous, 1141 unmatched, 1 retired) and 467 asset-plan rows discovered from the current 466 Product snapshots (27 blocked/missing). It copies zero image bytes, publishes zero Product Identity records, changes zero inventory quantities, and performs no cutover. Product Identity remains evidence-gated because no #328 reconciliation is READY yet; later inventory and cutover remain dependency-gated even though authorization has been granted.
      </p>

      {planError ? <div className="error-message" role="alert">{planError}</div> : null}
      {planResult ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>#338 governed PLAN</strong>
                <small>{planResult.mappings.planned} mappings · {planResult.mappings.matched} matched · {planResult.assets.discovered} asset rows · {planResult.assets.blocked} blocked</small>
              </span>
              <b className="pill pill-good">PLAN COMPLETE</b>
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
