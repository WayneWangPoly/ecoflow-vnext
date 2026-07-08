import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  loadInternalOrderDraftDependencies,
  loadInternalOrderExecutionQueue,
  loadInternalOrderSchemaProbe,
  type InternalOrderDependencyRow,
  type InternalOrderExecutionQueueRow,
  type InternalOrderSchemaProbeRow,
} from '@/data/repositories/internalOrderExecution';

function title(value: string | null | undefined) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function n(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function ReadinessPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'blue' | 'neutral' }) {
  return <span className={`internal-exec-pill internal-exec-pill-${tone}`}>{children}</span>;
}

function useMountHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    function locate() {
      const platformMount = document.querySelector<HTMLElement>('.order-platform-react-mount');
      const orderHeading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((node) => node.textContent?.trim() === 'Order control');
      const orderPanel = orderHeading?.closest<HTMLElement>('.panel');
      if (!platformMount && !orderPanel) {
        setHost(null);
        return;
      }
      let mount = document.querySelector<HTMLElement>('.internal-order-execution-mount');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'internal-order-execution-mount';
        if (platformMount) platformMount.insertAdjacentElement('afterend', mount);
        else orderPanel?.insertAdjacentElement('beforebegin', mount);
      }
      setHost(mount);
    }

    locate();
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => { pending = false; locate(); }, 160);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return host;
}

function SchemaRow({ row }: { row: InternalOrderSchemaProbeRow }) {
  const important = String(row.columns || '').includes('internal_order_id') || String(row.columns || '').includes('internalisation_status');
  return (
    <article className="internal-exec-schema-row">
      <div><strong>{row.table_name}</strong><span>{row.table_type} · {n(row.column_count)} columns</span></div>
      <ReadinessPill tone={important ? 'good' : 'neutral'}>{important ? 'candidate' : 'reference'}</ReadinessPill>
      <small>{row.columns || 'no columns visible'}</small>
    </article>
  );
}

function DependencyRow({ row }: { row: InternalOrderDependencyRow }) {
  const ready = row.has_internal_order_id && (row.has_internalisation_status || row.has_warehouse_gate_status);
  return (
    <article className="internal-exec-dependency-row">
      <div><strong>{row.object_name}</strong><span>{row.object_type}</span></div>
      <ReadinessPill tone={ready ? 'good' : 'warn'}>{ready ? 'execution candidate' : 'needs review'}</ReadinessPill>
      <small>{row.has_internal_order_id ? 'internal_order_id' : 'no internal_order_id'} · {row.has_internalisation_status ? 'internalisation_status' : 'no internalisation_status'} · {row.has_warehouse_gate_status ? 'warehouse_gate_status' : 'no warehouse_gate_status'}</small>
    </article>
  );
}

function QueueRow({ row }: { row: InternalOrderExecutionQueueRow }) {
  const tone = row.execution_status === 'NO_DESTRUCTIVE_ACTION_REQUIRED' ? 'good' : row.execution_status?.includes('CONFIRMATION') ? 'warn' : 'blue';
  return (
    <article className="internal-exec-queue-row">
      <div><strong>{row.order_number || row.lifecycle_id}</strong><span>{row.invoice_number || 'invoice pending'} · {row.internal_order_id || 'no internal id'}</span></div>
      <ReadinessPill tone={tone}>{title(row.execution_status)}</ReadinessPill>
      <small>{title(row.decision)} · {timeText(row.decided_at)} · {row.decision_note || 'no note'}</small>
    </article>
  );
}

function InspectorContent() {
  const [schema, setSchema] = useState<InternalOrderSchemaProbeRow[]>([]);
  const [dependencies, setDependencies] = useState<InternalOrderDependencyRow[]>([]);
  const [queue, setQueue] = useState<InternalOrderExecutionQueueRow[]>([]);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  async function reload() {
    setError('');
    try {
      const [nextSchema, nextDeps, nextQueue] = await Promise.all([
        loadInternalOrderSchemaProbe().catch(() => []),
        loadInternalOrderDraftDependencies().catch(() => []),
        loadInternalOrderExecutionQueue().catch(() => []),
      ]);
      setSchema(nextSchema);
      setDependencies(nextDeps);
      setQueue(nextQueue);
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);

  const executionCandidates = dependencies.filter((row) => row.has_internal_order_id && (row.has_internalisation_status || row.has_warehouse_gate_status));
  const readiness = useMemo(() => {
    if (!schema.length && !dependencies.length) return 'Migration pending';
    if (executionCandidates.length) return 'Execution source identified';
    return 'Schema visible, execution source not confirmed';
  }, [schema.length, dependencies.length, executionCandidates.length]);

  return (
    <section className="internal-exec-shell">
      <section className="internal-exec-hero">
        <div><span>INTERNAL ORDER EXECUTION READINESS</span><h3>{readiness}</h3><p>The system inspects database metadata before wiring destructive cancel/rebuild actions. Until the source table is confirmed, cancel/rebuild stays as an audited request.</p></div>
        <div className="internal-exec-actions"><button type="button" onClick={() => void reload()}>Refresh readiness</button><small>{loadedAt ? `checked ${timeText(loadedAt)}` : 'waiting for probe'}</small></div>
      </section>
      {error ? <div className="internal-exec-error">{error}</div> : null}
      <section className="internal-exec-metrics"><div><strong>{schema.length}</strong><span>schema objects</span></div><div><strong>{dependencies.length}</strong><span>draft dependencies</span></div><div><strong>{executionCandidates.length}</strong><span>execution candidates</span></div><div><strong>{queue.length}</strong><span>decision queue</span></div></section>
      <section className="internal-exec-grid">
        <div className="internal-exec-panel"><header><h4>Draft view dependencies</h4><ReadinessPill tone={executionCandidates.length ? 'good' : 'warn'}>{executionCandidates.length ? 'candidate found' : 'not confirmed'}</ReadinessPill></header><div className="internal-exec-list">{dependencies.slice(0, 8).map((row) => <DependencyRow key={`${row.object_type}-${row.object_name}`} row={row} />)}{!dependencies.length ? <div className="internal-exec-empty">Run the readiness migration to inspect dependencies.</div> : null}</div></div>
        <div className="internal-exec-panel"><header><h4>Execution queue</h4><ReadinessPill tone={queue.length ? 'blue' : 'neutral'}>{queue.length}</ReadinessPill></header><div className="internal-exec-list">{queue.slice(0, 8).map((row) => <QueueRow key={`${row.id}-${row.lifecycle_id}`} row={row} />)}{!queue.length ? <div className="internal-exec-empty">No archive/cancel/rebuild decisions waiting for execution.</div> : null}</div></div>
      </section>
      <section className="internal-exec-panel"><header><h4>Schema probe</h4><ReadinessPill tone={schema.length ? 'blue' : 'neutral'}>{schema.length}</ReadinessPill></header><div className="internal-exec-schema-grid">{schema.slice(0, 10).map((row) => <SchemaRow key={`${row.table_type}-${row.table_name}`} row={row} />)}{!schema.length ? <div className="internal-exec-empty">No schema rows loaded yet.</div> : null}</div></section>
    </section>
  );
}

export function InternalOrderReadinessInspector() {
  const host = useMountHost();
  return host ? createPortal(<InspectorContent />, host) : null;
}
