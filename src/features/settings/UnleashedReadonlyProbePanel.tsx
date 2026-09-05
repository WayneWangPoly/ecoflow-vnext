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
  runAuthorizedImageCopyWindow1,
  type AuthorizedImageCopyWindowResult,
} from '../team/unleashedImageCopyWindow1';
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
  const [copyRunning, setCopyRunning] = useState(false);
  const [copyAttempted, setCopyAttempted] = useState(false);
  const [copyResult, setCopyResult] = useState<AuthorizedImageCopyWindowResult | null>(null);
  const [error, setError] = useState('');
  const [surveyError, setSurveyError] = useState('');
  const [copyError, setCopyError] = useState('');
  const copyAttemptedRef = useRef(false);

  const anyRunning = running || surveyRunning || copyRunning;

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

  async function runCopyWindow1() {
    if (anyRunning || copyAttemptedRef.current || copyResult) return;
    copyAttemptedRef.current = true;
    setCopyAttempted(true);
    setCopyRunning(true);
    setCopyError('');
    try {
      setCopyResult(await runAuthorizedImageCopyWindow1(supabase));
    } catch (runError) {
      setCopyError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setCopyRunning(false);
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
        <div><span>Image authorization</span><strong>APPROVED · revision 1 · 64 MiB total · 2 MiB/object</strong></div>
        <div><span>Currently exposed</span><strong>COPY_IMAGES window 1 only · max 10 assets</strong></div>
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
        <button type="button" className="primary" onClick={() => void runCopyWindow1()} disabled={anyRunning || copyAttempted || Boolean(copyResult)}>
          <Database aria-hidden="true" size={17} />
          {copyRunning ? 'Copying bounded image window 1…' : copyResult ? 'Image window 1 completed' : copyAttempted ? 'Image window 1 attempt sent' : 'Execute authorized #338 COPY_IMAGES window 1'}
        </button>
      </div>

      <p className="unleashed-acceptance-note">
        The production image authorization is current and APPROVED at revision 1. This action is the first binary-copy window and is capped at 10 planned assets. It uses one fixed command id so a browser retry cannot create a second run. The Edge Function re-checks rights, source snapshot hash, HTTPS host, MIME/content signature, the 2 MiB per-object limit and the 64 MiB aggregate budget before committing provenance. No continuation window is exposed until production verification of copied/reused/failed counts and actual bytes. Product Identity, inventory/opening balance and cutover remain dependency-gated.
      </p>

      {copyError ? <div className="error-message" role="alert">{copyError}</div> : null}
      {copyResult ? (
        <div className="unleashed-acceptance-result" role="status">
          <div className="unleashed-acceptance-checks">
            <div>
              <span>
                <strong>#338 COPY_IMAGES window 1</strong>
                <small>{copyResult.assetsPlanned} planned · {copyResult.assetsCopied} copied · {copyResult.assetsReused} reused · {copyResult.assetsFailed} failed · {copyResult.bytesCopied} bytes</small>
              </span>
              <b className={`pill ${copyResult.status === 'SUCCEEDED' ? 'pill-good' : 'pill-warning'}`}>{copyResult.status}</b>
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
