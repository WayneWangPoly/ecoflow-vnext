import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Database, Eye, ShieldCheck } from 'lucide-react';
import {
  applyR5010BulkOpening,
  previewR5010BulkOpening,
  R5_010_CANARIES,
  R5_010_MIGRATION_LOCATION,
  R5_010_REFERENCE_BATCH_ID,
  type R5010ApplyResult,
  type R5010Preview,
} from '../team/freshBatchBulkOpening';

type Scope = 'ALL' | 'CANARY_R360Y' | 'CANARY_SB' | 'CUSTOM';

function short(value: string, size = 12) {
  return value.length <= size ? value : `${value.slice(0, size)}…`;
}

function parseCustomRows(value: string) {
  return [...new Set(
    value
      .split(/[\s,]+/)
      .map((row) => row.trim())
      .filter(Boolean),
  )];
}

export function FreshBatchBulkOpeningPanel({ supabase }: { supabase: SupabaseClient }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('ALL');
  const [customRows, setCustomRows] = useState('');
  const [preview, setPreview] = useState<R5010Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<R5010ApplyResult | null>(null);

  const referenceRowIds = useMemo(() => {
    if (scope === 'CANARY_R360Y') return [R5_010_CANARIES[0].referenceRowId];
    if (scope === 'CANARY_SB') return [R5_010_CANARIES[1].referenceRowId];
    if (scope === 'CUSTOM') return parseCustomRows(customRows);
    return null;
  }, [customRows, scope]);

  function invalidatePreview() {
    setPreview(null);
    setResult(null);
    setAcknowledged(false);
  }

  async function runPreview() {
    if (previewing || applying) return;
    if (scope === 'CUSTOM' && (!referenceRowIds || referenceRowIds.length === 0)) {
      setError('Enter at least one reference-row UUID for a custom wave.');
      return;
    }
    setPreviewing(true);
    setError('');
    setResult(null);
    setAcknowledged(false);
    try {
      setPreview(await previewR5010BulkOpening(supabase, {
        referenceRowIds,
        locationCode: R5_010_MIGRATION_LOCATION,
      }));
    } catch (previewError) {
      setPreview(null);
      setError(previewError instanceof Error ? previewError.message : String(previewError));
    } finally {
      setPreviewing(false);
    }
  }

  async function runApply() {
    if (!preview || !preview.canApply || !acknowledged || applying) return;
    setApplying(true);
    setError('');
    setResult(null);
    try {
      const applied = await applyR5010BulkOpening(supabase, {
        manifestSha256: preview.manifestSha256,
        commandId: crypto.randomUUID(),
        reason,
        acknowledged,
        referenceRowIds,
        locationCode: preview.locationCode,
      });
      setResult(applied);
      setPreview(await previewR5010BulkOpening(supabase, {
        referenceRowIds: scope === 'ALL' ? null : referenceRowIds,
        locationCode: preview.locationCode,
      }));
      setAcknowledged(false);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError));
    } finally {
      setApplying(false);
    }
  }

  const unresolved = preview
    ? preview.pendingProductMappingCount + preview.ambiguousProductMappingCount +
      preview.pendingWarehouseMappingCount + preview.ambiguousWarehouseMappingCount +
      preview.pendingPhysicalIdentityCount
    : 0;

  return (
    <section className="unleashed-r5-stage-carrier">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="r5-010-fresh-batch-opening"
        onClick={() => setOpen((current) => !current)}
        disabled={previewing || applying}
      >
        <ShieldCheck aria-hidden="true" size={17} />
        {open ? 'Close fresh batch opening' : 'Review fresh batch opening'}
      </button>

      {open ? (
        <div className="unleashed-acceptance unleashed-r5-stage" id="r5-010-fresh-batch-opening">
          <div className="unleashed-acceptance-head">
            <div>
              <h3>R5-010 fresh batch opening</h3>
              <span>Latest SEALED ADL1 reference · manifest-bound · Owner/Admin only</span>
            </div>
            <b className={`pill pill-${result ? 'good' : error ? 'danger' : preview?.canApply ? 'good' : 'neutral'}`}>
              {applying ? 'APPLYING' : previewing ? 'PREVIEWING' : result ? 'APPLIED' : preview?.canApply ? 'READY' : 'PREVIEW'}
            </b>
          </div>

          <p className="unleashed-acceptance-note">
            Batch <strong>{short(R5_010_REFERENCE_BATCH_ID)}</strong>. PREVIEW is read-only. APPLY creates opening inventory only from the frozen Unleashed migration reference; it does not claim a physical count.
          </p>

          <div className="unleashed-acceptance-scope">
            <label>
              Opening wave
              <select
                value={scope}
                disabled={previewing || applying}
                onChange={(event) => { setScope(event.target.value as Scope); invalidatePreview(); }}
              >
                <option value="ALL">All uninitialized READY candidates</option>
                <option value="CANARY_R360Y">Canary · R-360Y</option>
                <option value="CANARY_SB">Canary · SB24/32/40LBOX</option>
                <option value="CUSTOM">Custom reference-row wave</option>
              </select>
            </label>
            {scope === 'CUSTOM' ? (
              <label>
                Reference row UUIDs
                <input
                  value={customRows}
                  disabled={previewing || applying}
                  onChange={(event) => { setCustomRows(event.target.value); invalidatePreview(); }}
                  placeholder="uuid, uuid, …"
                />
              </label>
            ) : null}
            <span>
              Opening location <strong>{R5_010_MIGRATION_LOCATION}</strong> · governed non-physical migration holding only. Move stock to real bins later through normal audited transfer.
            </span>
          </div>

          <button type="button" disabled={previewing || applying} onClick={() => void runPreview()}>
            <Eye aria-hidden="true" size={17} />
            {previewing ? 'Building manifest…' : 'Preview opening wave'}
          </button>

          {preview ? (
            <div className="unleashed-acceptance-result" role="status">
              <div className="unleashed-acceptance-summary">
                <span>READY <strong>{preview.readyRowCount}</strong></span>
                <span>positive <strong>{preview.readyPositiveRowCount}</strong></span>
                <span>zero <strong>{preview.readyZeroRowCount}</strong></span>
                <span>unresolved <strong>{unresolved}</strong></span>
                <span>already opened <strong>{preview.alreadyInitializedCount}</strong></span>
                <span>wave <strong>{preview.executableRowCount}/{preview.selectedRowCount}</strong></span>
                <span>positive QtyOnHand <strong>{preview.positiveQtyOnHandTotal}</strong></span>
              </div>
              <p className="unleashed-acceptance-note">
                Manifest <code>{preview.manifestSha256}</code><br />
                Location <strong>{preview.locationCode}</strong> · {preview.locationSemantics}
              </p>
              {preview.rows.some((row) => !row.executable) ? (
                <div className="unleashed-acceptance-warning">
                  {preview.rows.filter((row) => !row.executable).map((row) => (
                    <div key={row.referenceRowId}>{row.sourceProductCode}: {row.blockReason ?? 'BLOCKED'}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <label>
            Apply reason
            <input
              value={reason}
              disabled={!preview || applying}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why this migration opening wave is being applied"
            />
          </label>
          <label className="unleashed-acceptance-confirm">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={!preview?.canApply || applying}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>I confirm this manifest may create opening inventory authority from UNLEASHED_MIGRATION_REFERENCE evidence.</span>
          </label>

          {error ? <div className="error-message" role="alert">{error}</div> : null}
          {result ? (
            <div className="unleashed-acceptance-result" role="status">
              Approved session <strong>{short(result.stocktakeSessionId)}</strong> · rows {result.selectedRowCount} · opening movements {result.openingMovementCount} · zero initializations {result.zeroRowCount}
            </div>
          ) : null}

          <button
            type="button"
            className="primary unleashed-acceptance-run"
            disabled={!preview?.canApply || !acknowledged || !reason.trim() || applying || previewing}
            onClick={() => void runApply()}
          >
            <Database aria-hidden="true" size={17} />
            {applying ? 'Applying manifest…' : 'Apply selected opening wave'}
          </button>
        </div>
      ) : null}
    </section>
  );
}