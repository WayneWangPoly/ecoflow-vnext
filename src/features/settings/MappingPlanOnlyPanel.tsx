import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  readR5006MappingPlanOnlyPreflight,
  runR5006MappingPlanOnly,
  type R5006MappingPlanOnlyPreflight,
  type R5006MappingPlanOnlyResult,
} from '../team/unleashedMappingPlanOnly';

const DEFAULT_REASON = 'Refresh Unleashed product mappings after Commercial Wave-2 completion; mapping-only PLAN with no image, provider, Physical Identity, or inventory action.';

function tone(preflight: R5006MappingPlanOnlyPreflight | null, error: string, result: R5006MappingPlanOnlyResult | null) {
  if (error) return 'danger';
  if (result) return 'good';
  if (!preflight) return 'neutral';
  return preflight.ready ? 'good' : 'warning';
}

export function MappingPlanOnlyPanel({ supabase }: { supabase: SupabaseClient }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [preflight, setPreflight] = useState<R5006MappingPlanOnlyPreflight | null>(null);
  const [result, setResult] = useState<R5006MappingPlanOnlyResult | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());

  const executionLocked = useMemo(
    () => running || !preflight?.ready || !acknowledged || Boolean(result),
    [running, preflight, acknowledged, result],
  );

  async function refreshPreflight() {
    if (loading || running) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setPreflight(await readR5006MappingPlanOnlyPreflight(supabase));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : String(readError));
    } finally {
      setLoading(false);
    }
  }

  async function execute() {
    if (executionLocked) return;
    setRunning(true);
    setError('');
    try {
      const response = await runR5006MappingPlanOnly(supabase, { commandId, reason });
      setResult(response);
      setPreflight(response.postflight);
      setAcknowledged(false);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setRunning(false);
    }
  }

  function resetCommand() {
    if (running) return;
    setCommandId(crypto.randomUUID());
    setResult(null);
    setError('');
    setAcknowledged(false);
  }

  return (
    <div className="unleashed-acceptance">
      <div className="unleashed-acceptance-head">
        <div>
          <h3>R5-006 mapping-only PLAN</h3>
          <span>151 exact ORDERMENTUM product mappings · no image/provider/inventory action</span>
        </div>
        <b className={`pill pill-${tone(preflight, error, result)}`}>
          {running ? 'RUNNING' : result ? 'COMPLETE' : preflight?.status ?? 'NOT CHECKED'}
        </b>
      </div>

      <p className="unleashed-acceptance-note">
        This refreshes only the governed Unleashed master mapping plan. It does not plan or copy images,
        call Unleashed/Ordermentum, create Physical SKU/package/barcode authority, or change inventory.
      </p>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        disabled={running}
      >
        {open ? 'Close R5-006 mapping PLAN' : 'Review R5-006 mapping PLAN'}
      </button>

      {open ? (
        <>
          <div className="system-sync-actions unleashed-probe-actions">
            <button type="button" onClick={() => void refreshPreflight()} disabled={loading || running}>
              {loading ? 'Checking…' : 'Refresh frozen preflight'}
            </button>
          </div>

          {preflight ? (
            <div className="unleashed-acceptance-result" role="status">
              <div className="unleashed-acceptance-summary">
                <span>Pending product mapping <strong>{preflight.pendingProductMappingCount}</strong></span>
                <span>Exact auto-matchable <strong>{preflight.autoMatchableCount}</strong></span>
                <span>Positive rows <strong>{preflight.autoMatchablePositiveRows}</strong></span>
                <span>Reference cartons <strong>{preflight.autoMatchablePositiveQty}</strong></span>
                <span>No target <strong>{preflight.noTargetCount}</strong></span>
                <span>Ambiguous <strong>{preflight.ambiguousTargetCount}</strong></span>
              </div>
              <p className="unleashed-acceptance-note">
                Expected after PLAN: product mapping {preflight.predictedPostflight.pendingProductMappingCount},
                physical identity {preflight.predictedPostflight.pendingPhysicalIdentityCount},
                ready for location evidence {preflight.predictedPostflight.readyForLocationEvidenceCount}.
              </p>
            </div>
          ) : null}

          <label>
            Reason
            <input
              value={reason}
              disabled={running || Boolean(result)}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>

          <label className="unleashed-acceptance-confirm">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={running || Boolean(result) || !preflight?.ready}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              I confirm this is mapping-only PLAN. No image planning, provider traffic, Physical Identity creation,
              stocktake, or inventory authority is included.
            </span>
          </label>

          {error ? <div className="error-message" role="alert">{error}</div> : null}
          {result ? (
            <div className="success-message" role="status">
              Mapping PLAN completed · pending product mappings {result.postflight.pendingProductMappingCount}
              {' · '}pending Physical Identity {result.postflight.pendingPhysicalIdentityCount}
              {' · '}command {result.commandId.slice(0, 8)}
            </div>
          ) : null}

          <div className="system-sync-actions unleashed-probe-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void execute()}
              disabled={executionLocked}
            >
              {running ? 'Running mapping PLAN…' : 'Run mapping-only PLAN'}
            </button>
            <button type="button" onClick={resetCommand} disabled={running || !result}>
              New command
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
