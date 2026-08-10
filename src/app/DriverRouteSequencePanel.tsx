import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, RefreshCw, Route, X } from 'lucide-react';
import {
  loadDeliveryRouteExecutionSequence,
  reorderDeliveryRouteExecution,
  type DeliveryRouteExecutionSequence,
} from '@/data/repositories/deliveryRouteAuthority';
import { loadDriverDayState, type StopStatus } from '@/domain/driverRun';
import type { BusinessDay } from '@/domain/types';

type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';
type PendingIntent = {
  commandId: string;
  expectedSequenceRevision: number;
  stopOrder: string[];
};

const IMMUTABLE_STATUSES = new Set<StopStatus>(['ARRIVED', 'DELIVERED', 'FAILED', 'SKIPPED']);

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function commandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function isConflict(reason: unknown) {
  const code = reason && typeof reason === 'object' && 'code' in reason ? String((reason as { code?: unknown }).code || '') : '';
  const message = errorMessage(reason);
  return code === '40001' || message.includes('ROUTE_SEQUENCE_REVISION_CONFLICT');
}

export function DriverRouteSequencePanel({
  businessDay,
  onRouteChanged,
}: {
  businessDay: BusinessDay;
  onRouteChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [runCode, setRunCode] = useState(() => loadDriverDayState(businessDay.date).runCode);
  const [sequence, setSequence] = useState<DeliveryRouteExecutionSequence | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const draftRef = useRef<string[]>([]);
  const [immutableIds, setImmutableIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStartOrder = useRef<string[]>([]);

  const replaceDraft = useCallback((next: string[]) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    const localDay = loadDriverDayState(businessDay.date);
    const nextRunCode = localDay.runCode;
    setRunCode(nextRunCode);
    setImmutableIds(new Set(
      Object.entries(localDay.stopProgress)
        .filter(([, progress]) => IMMUTABLE_STATUSES.has(progress.status))
        .map(([orderId]) => orderId),
    ));
    if (!quiet) setLoading(true);
    try {
      const next = await loadDeliveryRouteExecutionSequence({ businessDay: businessDay.date, runCode: nextRunCode });
      setSequence(next);
      if (next && saveState !== 'saving' && !draggingId && !pendingIntent) replaceDraft(next.stopOrder);
      if (!next) {
        replaceDraft([]);
        setPendingIntent(null);
        setSaveState('idle');
      }
      setError('');
    } catch (reason) {
      if (!quiet) setError(errorMessage(reason));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [businessDay.date, draggingId, pendingIntent, replaceDraft, saveState]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const rows = useMemo(() => {
    if (!sequence) return [];
    const byId = new Map(sequence.snapshot.stops.map((stop) => [stop.orderId, stop]));
    return draft.map((orderId, index) => {
      const stop = byId.get(orderId);
      return stop ? { stop, index, immutable: immutableIds.has(orderId) } : null;
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [draft, immutableIds, sequence]);

  function canMove(from: number, to: number) {
    if (from < 0 || to < 0 || from >= draft.length || to >= draft.length || from === to) return false;
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    for (let index = low; index <= high; index += 1) {
      if (immutableIds.has(draft[index])) return false;
    }
    return true;
  }

  function reordered(from: number, to: number) {
    if (!canMove(from, to)) return draft;
    const next = [...draft];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }

  async function persist(nextOrder: string[], retryIntent?: PendingIntent) {
    if (!sequence || sameOrder(nextOrder, sequence.stopOrder) || saveState === 'saving') return;
    const intent = retryIntent ?? {
      commandId: commandId(),
      expectedSequenceRevision: sequence.sequenceRevision,
      stopOrder: nextOrder,
    };
    replaceDraft(nextOrder);
    setPendingIntent(intent);
    setSaveState('saving');
    setError('');
    try {
      const result = await reorderDeliveryRouteExecution({
        businessDay: businessDay.date,
        runCode,
        expectedSequenceRevision: intent.expectedSequenceRevision,
        commandId: intent.commandId,
        stopOrder: intent.stopOrder,
      });
      const nextSequence: DeliveryRouteExecutionSequence = {
        ...sequence,
        routeRevision: result.routeRevision,
        sequenceRevision: result.sequenceRevision,
        stopOrder: result.stopOrder,
        snapshot: result.snapshot,
        updatedAt: result.updatedAt,
      };
      setSequence(nextSequence);
      replaceDraft(result.stopOrder);
      setPendingIntent(null);
      setSaveState('saved');
      onRouteChanged();
      window.setTimeout(() => setSaveState((current) => current === 'saved' ? 'idle' : current), 1800);
    } catch (reason) {
      if (isConflict(reason)) {
        setPendingIntent(null);
        setSaveState('conflict');
        setError('Route order changed elsewhere. The latest authoritative sequence has been reloaded; review it before trying again.');
        await refresh();
      } else {
        setSaveState('error');
        setError(errorMessage(reason));
      }
    }
  }

  function moveByButton(orderId: string, delta: number) {
    const from = draft.indexOf(orderId);
    const to = from + delta;
    if (!canMove(from, to)) return;
    void persist(reordered(from, to));
  }

  function handlePointerDown(orderId: string, event: React.PointerEvent<HTMLButtonElement>) {
    if (immutableIds.has(orderId) || saveState === 'saving') return;
    dragStartOrder.current = [...draftRef.current];
    setDraggingId(orderId);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-route-order-id]');
    const targetId = element?.dataset.routeOrderId;
    if (!targetId || targetId === draggingId) return;
    setDraft((current) => {
      const from = current.indexOf(draggingId);
      const to = current.indexOf(targetId);
      if (from < 0 || to < 0) return current;
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      for (let index = low; index <= high; index += 1) {
        if (immutableIds.has(current[index])) return current;
      }
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      draftRef.current = next;
      return next;
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const finalOrder = [...draftRef.current];
    setDraggingId(null);
    if (!sameOrder(finalOrder, dragStartOrder.current)) void persist(finalOrder);
  }

  if (!sequence && !loading) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Adjust delivery route order"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', right: 14, bottom: 76, zIndex: 35, border: 0, borderRadius: 999,
          padding: '11px 14px', background: '#102f24', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,.2)',
          display: sequence ? 'inline-flex' : 'none', alignItems: 'center', gap: 8, fontWeight: 800,
        }}
      >
        <Route size={17} /> Route order
      </button>

      {open ? (
        <div className="driver-overlay" role="dialog" aria-label="Adjust delivery route order">
          <div className="driver-bottom-sheet" style={{ maxHeight: '88dvh', overflow: 'auto' }}>
            <div className="sheet-grab" />
            <div className="sheet-head">
              <div>
                <strong>Run {runCode} · execution order</strong>
                <span>Drag pending stops or use ↑ ↓. Box codes and order facts stay fixed.</span>
              </div>
              <button type="button" className="driver-icon-button" onClick={() => setOpen(false)} aria-label="Close route order"><X size={20} /></button>
            </div>

            <div className="pod-requirement" style={{ marginBottom: 10 }}>
              Server sequence r{sequence?.sequenceRevision ?? '…'} · {saveState === 'saving' ? 'Saving authoritative order…' : saveState === 'saved' ? 'Saved' : saveState === 'conflict' ? 'Conflict refreshed' : saveState === 'error' ? 'Save needs attention' : 'Ready'}
            </div>
            {error ? <div className="pod-requirement">{error}</div> : null}
            {pendingIntent && saveState === 'error' ? (
              <button type="button" className="driver-primary-button" onClick={() => void persist(pendingIntent.stopOrder, pendingIntent)}>
                <RefreshCw size={17} /> Retry same command safely
              </button>
            ) : null}

            <div className="list-stack" style={{ marginTop: 10 }}>
              {rows.map(({ stop, index, immutable }) => (
                <article
                  className="stop-row"
                  key={stop.orderId}
                  data-route-order-id={stop.orderId}
                  style={{ opacity: saveState === 'saving' ? .78 : 1 }}
                >
                  <button
                    type="button"
                    className="driver-icon-button"
                    aria-label={`Drag ${stop.store}`}
                    disabled={immutable || saveState === 'saving'}
                    onPointerDown={(event) => handlePointerDown(stop.orderId, event)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    style={{ touchAction: 'none', cursor: immutable ? 'not-allowed' : 'grab' }}
                  >
                    <GripVertical size={19} />
                  </button>
                  <b>{index + 1}</b>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong>{stop.boxCode} · {stop.store}</strong>
                    <span>{stop.suburb} · ETA {stop.eta}{immutable ? ' · position locked after execution began' : ''}</span>
                  </div>
                  <span className="row-actions">
                    <button type="button" aria-label={`Move ${stop.store} up`} disabled={!canMove(index, index - 1) || saveState === 'saving'} onClick={() => moveByButton(stop.orderId, -1)}><ChevronUp size={17} /></button>
                    <button type="button" aria-label={`Move ${stop.store} down`} disabled={!canMove(index, index + 1) || saveState === 'saving'} onClick={() => moveByButton(stop.orderId, 1)}><ChevronDown size={17} /></button>
                  </span>
                </article>
              ))}
            </div>
            <small style={{ display: 'block', marginTop: 12, opacity: .76 }}>
              Completed, failed, skipped and current arrived stops cannot move. Cross-driver, stale-revision and membership checks are enforced again by the server.
            </small>
          </div>
        </div>
      ) : null}
    </>
  );
}
