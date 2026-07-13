import type { ReactNode } from 'react';
import { formatBusinessDate } from '@/domain/syncModel';
import type { ImportedOrder } from '@/domain/types';
import type { OwnerCommandAttentionRow } from '@/data/repositories/ownerCommandCenter';
import {
  lineSummary,
  money,
  queueBadges,
  signalTone,
  title,
  type DashboardTone,
} from './dashboardModel';

export function DashboardPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: DashboardTone }) {
  return <span className={`owner-command-pill owner-command-pill-${tone}`}>{children}</span>;
}

export function DashboardMetric({
  label,
  value,
  helper,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  helper: string;
  tone?: DashboardTone;
}) {
  return (
    <article className={`owner-command-metric owner-command-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

export function DashboardOrderRow({ order }: { order: ImportedOrder }) {
  const blocked = order.openExceptionCount > 0 || order.status === 'MAPPING_EXCEPTION';
  return (
    <article className="owner-command-order-row">
      <div className={`owner-command-order-signal ${blocked ? 'is-blocked' : ''}`} aria-hidden="true">
        {blocked ? '!' : '✓'}
      </div>
      <div className="owner-command-order-main">
        <div className="owner-command-order-title">
          <strong>{order.orderNo}</strong>
          <div className="owner-command-order-pills">
            {queueBadges(order).map((badge) => (
              <DashboardPill key={badge.label} tone={badge.tone}>{badge.label}</DashboardPill>
            ))}
          </div>
        </div>
        <span>{order.store} · {order.suburb} · {order.priceTier}</span>
        <small className="owner-command-order-lines">{lineSummary(order) || 'Order lines are awaiting detail.'}</small>
        {order.releaseBlockers ? <small className="owner-command-order-blocker">{order.releaseBlockers}</small> : null}
      </div>
      <div className="owner-command-order-side">
        <strong>{money(order.amount)}</strong>
        <span>{order.packageCount} label{order.packageCount === 1 ? '' : 's'}</span>
        <small>Due {formatBusinessDate(order.deliveryDate || order.dueAt)}</small>
      </div>
    </article>
  );
}

export function DashboardAttentionRow({ row }: { row: OwnerCommandAttentionRow }) {
  return (
    <article className="owner-command-attention-row">
      <div>
        <strong>{row.title || 'Untitled attention item'}</strong>
        <span>{row.detail || row.action_hint || 'Review required.'}</span>
      </div>
      <DashboardPill tone={signalTone(row.signal)}>
        {row.area || 'Operations'} · {title(row.signal)}
      </DashboardPill>
    </article>
  );
}

export function DashboardLoading() {
  return (
    <section className="owner-command-loading" aria-live="polite">
      <div className="owner-command-loading-mark" />
      <div>
        <strong>Loading live operations</strong>
        <span>EcoFlow is waiting for all required lifecycle sources before showing totals.</span>
      </div>
    </section>
  );
}
