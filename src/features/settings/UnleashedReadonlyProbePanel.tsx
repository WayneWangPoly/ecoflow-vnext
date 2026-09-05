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
  runAuthorizedAssetAuthorization,
  type AuthorizedAssetAuthorizationResult,
} from '../team/unleashedAssetAuthorization';
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
  const [authorizationRunning, setAuthorizationRunning] = useState(false);
  const [authorizationAttempted, setAuthorizationAttempted] = useState(false);
  const [authorizationResult, setAuthorizationResult] = useState<AuthorizedAssetAuthorizationResult | null>(null);
  const [error, setError] = useState('');
  const [surveyError, setSurveyError] = useState('');
  const [authorizationError, setAuthorizationError] = useState('');
  const authorizationAttemptedRef = useRef(false);

  const anyRunning = running || surveyRunning || authorizationRunning;

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

  async function authorizeAssets() {
    if (anyRunning || authorizationAttemptedRef.current || authorizationResult) return;
    authorizationAttemptedRef.current = true;
    setAuthorizationAttempted(true);
    setAuthorizationRunning(true);
    setAuthorizationError('');
    try {
      setAuthorizationResult(await runAuthorizedAssetAuthorization(supabase));
    } catch (runError) {
      setAuthorizationError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setAuthorizationRunning(false);
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
        <div><span>Governed PLAN</span><strong>complete · 1300 mappings · 440 image locators · 27 missing</strong></div>
        <div><span>Image storage</span><strong>private bucket · 0 objects · 0 bytes copied</strong></div>
        <div><span>Currently exposed</span><strong>bounded image-copy authorization only</strong></div>
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
        <button type="button" className="primary" onClick={() => void authorizeAssets()} disabled={anyRunning || authorizationAttempted || Boolean(authorizationResult)}>
          <Database aria-hidden="true" size={17} />
          {authorizationRunning ? 'Authorizing bounded image copy…' : authorizationResult ? 'Image-copy authorization recorded' : authorizationAttempted ? 'Image-copy authorization attempt sent' : 'Authorize bounded #338 image copy'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        The production PLAN is closed at 1300 deterministic mappings and 467 asset rows: 440 PLANNED image locators plus 27 BLOCKED/missing rows. This action does not copy images. It records one current Owner/Admin authorization scoped only to the product-image locators already planned from the EcoFlow Unleashed tenant into the private unleashed-product-images bucket for the internal replacement-system migration. Hard limits are 64 MiB aggregate storage budget and 2 MiB per image; those limits reserve no storage. COPY_IMAGES remains a separate bounded action capped at 10 assets per run and will not be exposed until this authorization is production-verified. Product Identity, inventory/opening balance and cutover remain dependency-gated.
      </p>

      {authorizationError ? <div className="error-message" role="alert">{authorizationError}</div> : null}
      {authorizationResult ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>#338 image-copy authorization</strong>
                <small>APPROVED · revision {authorizationResult.authorization.revision} · {authorizationResult.authorization.authorizationId.slice(0, 8)}</small>
              </span>
              <b className="pill pill-good">AUTHORIZED</b>
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
