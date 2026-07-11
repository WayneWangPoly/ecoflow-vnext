import { useEffect, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';
import { loadLatestPickHandoffProgress, type PickHandoffProgressRow } from '@/data/repositories/pickHandoff';

function num(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function title(value?: string | null) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function timeText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function phaseTone(phase?: string | null) {
  if (phase === 'STAGING_OR_READY_TO_LOAD') return 'good';
  if (phase === 'PICKING' || phase === 'SORTING') return 'blue';
  if (phase === 'WAITING_DRIVER_ROUTE') return 'warn';
  return 'neutral';
}

function HandoffCard({ progress, error, onRefresh }: { progress: PickHandoffProgressRow | null; error: string; onRefresh: () => void }) {
  const phase = progress?.warehouse_phase || 'WAITING_DRIVER_ROUTE';
  return (
    <section className="warehouse-pick-handoff-card">
      <div className="warehouse-pick-handoff-head">
        <div>
          <span>ROUTE → WAREHOUSE HANDOFF</span>
          <h2>{title(phase)}</h2>
          <p>{progress?.locked_at ? `Route locked ${timeText(progress.locked_at)} · ${progress.locked_by || 'driver/office'}` : 'Warehouse waits here until driver/owner locks the delivery order.'}</p>
        </div>
        <button type="button" onClick={onRefresh}>Refresh</button>
      </div>
      {error ? <div className="warehouse-pick-handoff-error">{error}</div> : null}
      <div className="warehouse-pick-handoff-metrics">
        <div><strong>{num(progress?.picked_task_count)}/{num(progress?.task_count)}</strong><span>SKUs picked</span></div>
        <div><strong>{num(progress?.done_allocation_count)}/{num(progress?.allocation_count)}</strong><span>box allocations</span></div>
        <div><strong>{num(progress?.sealed_stop_count)}</strong><span>stops sealed</span></div>
        <div><strong>{num(progress?.labelled_stop_count)}</strong><span>labels applied</span></div>
        <div><strong>{num(progress?.staged_stop_count)}</strong><span>stops staged</span></div>
        <div><strong>{num(progress?.short_units)}</strong><span>short units</span></div>
      </div>
      <div className={`warehouse-pick-phase-strip phase-${phaseTone(phase)}`}>
        <strong>{title(progress?.handoff_status)}</strong>
        <span>Bulk pick → box allocation → seal → apply A6 labels → stage → reverse load.</span>
      </div>
    </section>
  );
}

export function WarehousePickHandoffStatus() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [progress, setProgress] = useState<PickHandoffProgressRow | null>(null);
  const [error, setError] = useState('');

  function locate() {
    const pickBoard = document.querySelector<HTMLElement>('.pick-board');
    const warehouseTitle = Array.from(document.querySelectorAll<HTMLElement>('.mobile-title h1')).find((node) => node.textContent?.trim() === 'Warehouse');
    if (!pickBoard || !warehouseTitle) { setHost(null); return; }
    let mount = document.querySelector<HTMLElement>('.warehouse-pick-handoff-mount');
    if (!mount) {
      mount = document.createElement('section');
      mount.className = 'warehouse-pick-handoff-mount';
      pickBoard.insertAdjacentElement('beforebegin', mount);
    }
    setHost(mount);
  }

  async function refresh() {
    try {
      const next = await loadLatestPickHandoffProgress();
      setProgress(next);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    const stopObserving = observeBody(locate);
    return stopObserving;
  }, []);

  useEffect(() => {
    if (!host) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [host]);

  return host ? createPortal(<HandoffCard progress={progress} error={error} onRefresh={() => void refresh()} />, host) : null;
}
