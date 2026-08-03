import { useMemo, useState } from 'react';
import type { ImportedOrder } from '@/domain/types';
import { NativeWorkspaceEmpty, NativeWorkspaceFrame } from '@/features/navigation/NativeWorkspaceFrame';

function money(value: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value || 0);
}

function statusTone(value: string) {
  const normalized = value.toUpperCase();
  if (['PAID', 'DELIVERED', 'MATCHED'].includes(normalized)) return 'good';
  if (['CREDIT_HOLD', 'FAILED', 'MISMATCH'].includes(normalized)) return 'danger';
  if (['PARTIAL', 'OUTSTANDING', 'REVIEW'].includes(normalized)) return 'warn';
  return 'neutral';
}

export function NativeReconciliationWorkspace({ orders, businessDay }: { orders: ImportedOrder[]; businessDay: string }) {
  const [filter, setFilter] = useState('OPEN');
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orders.filter((order) => {
      const paid = String(order.paymentStatus).toUpperCase() === 'PAID';
      const delivered = order.status === 'DELIVERED';
      const needsReview = !paid || !delivered || order.openExceptionCount > 0;
      if (filter === 'OPEN' && !needsReview) return false;
      if (filter === 'MATCHED' && needsReview) return false;
      if (!query) return true;
      return [order.invoiceNo, order.orderNo, order.store, order.paymentStatus, order.status]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [filter, orders, search]);

  const outstandingValue = rows.reduce((sum, order) => String(order.paymentStatus).toUpperCase() === 'PAID' ? sum : sum + order.amount, 0);
  const podPending = rows.filter((order) => order.status !== 'DELIVERED').length;
  const exceptions = rows.reduce((sum, order) => sum + order.openExceptionCount, 0);

  return (
    <NativeWorkspaceFrame
      eyebrow="FINANCIAL AND DELIVERY CONTROL"
      title="Reconciliation"
      detail="Invoice, payment, delivery and exception facts remain linked to the same order record."
      actions={<span className="status-chip">ADELAIDE {businessDay}</span>}
    >
      <section className="quick-stats">
        <article className="metric-card"><span>Visible records</span><strong>{rows.length}</strong><small>{filter === 'OPEN' ? 'Require attention' : 'Fully matched'}</small></article>
        <article className="metric-card"><span>Outstanding value</span><strong>{money(outstandingValue)}</strong><small>Not marked paid</small></article>
        <article className="metric-card"><span>POD pending</span><strong>{podPending}</strong><small>Not delivered</small></article>
        <article className="metric-card"><span>Open exceptions</span><strong>{exceptions}</strong><small>Operational blockers</small></article>
      </section>

      <section className="native-workspace-toolbar" aria-label="Reconciliation filters">
        <label><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Invoice, order or store" /></label>
        <label><span>Queue</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="OPEN">Needs attention</option><option value="MATCHED">Matched</option><option value="ALL">All</option></select></label>
        <button type="button" onClick={() => { setSearch(''); setFilter('OPEN'); }}>Clear</button>
      </section>

      {!rows.length ? <NativeWorkspaceEmpty title="No reconciliation records" detail="The current filter returned no invoices. This is an explicit empty state, not a failed read." /> : null}
      {rows.length ? <div className="native-server-table" role="region" aria-label="Reconciliation records" tabIndex={0}><table><caption>{rows.length} order record{rows.length === 1 ? '' : 's'}</caption><thead><tr><th>Invoice</th><th>Order</th><th>Store</th><th>Payment</th><th>Amount</th><th>Delivery</th><th>Exceptions</th><th>Result</th></tr></thead><tbody>{rows.map((order) => { const paid = String(order.paymentStatus).toUpperCase() === 'PAID'; const delivered = order.status === 'DELIVERED'; const matched = paid && delivered && order.openExceptionCount === 0; return <tr key={order.id}><td><strong>{order.invoiceNo}</strong></td><td>{order.orderNo}</td><td>{order.store}</td><td><span className={`status-chip ${statusTone(String(order.paymentStatus))}`}>{order.paymentStatus}</span></td><td>{money(order.amount)}</td><td><span className={`status-chip ${statusTone(order.status)}`}>{order.status}</span></td><td>{order.openExceptionCount}</td><td><span className={`status-chip ${matched ? 'good' : 'warn'}`}>{matched ? 'MATCHED' : 'REVIEW'}</span></td></tr>; })}</tbody></table></div> : null}
    </NativeWorkspaceFrame>
  );
}
