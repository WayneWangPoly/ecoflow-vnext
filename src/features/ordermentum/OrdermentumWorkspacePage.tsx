import { useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { DriverDayState } from '@/domain/driverRun';
import { bucketOrders, getOrderBucketCounts, orderBucketDefinitions } from '@/domain/orderBuckets';
import { changeImpactLabel, formatBusinessDate, formatDateTime, sortOrdersForOperations, syncStatusLabel } from '@/domain/syncModel';
import type { EcoFlowDataSet, ImportedOrder, MappingException, OrderBucketKey } from '@/domain/types';
import { callInternaliseOrders } from '@/data/repositories/pickSync';
import { NativePager, NativeWorkspaceEmpty, NativeWorkspaceFrame, NativeWorkspaceLoading, NativeWorkspaceUnavailable } from '@/features/navigation/NativeWorkspaceFrame';
import { paginateRows, useWorkspaceQueryState } from '@/features/navigation/useWorkspaceQueryState';

const BUCKET_TABS = [...orderBucketDefinitions.map((definition) => definition.key), 'exceptions'] as const;
const FILTERS = ['all', 'ready', 'blocked', 'released'] as const;
const SORTS = ['operations', 'store', 'due', 'value', 'updated'] as const;
const PAGE_SIZES = [15, 25, 50] as const;

function isOrderBucket(value: string): value is OrderBucketKey {
  return orderBucketDefinitions.some((definition) => definition.key === value);
}

function releaseTone(status?: ImportedOrder['releaseGateStatus']) {
  if (status === 'READY_TO_RELEASE') return 'good';
  if (status === 'REVIEW_PAYMENT') return 'warn';
  if (status) return 'danger';
  return 'neutral';
}

function statusTone(status: ImportedOrder['status']) {
  if (status === 'DELIVERED' || status === 'CLOSED') return 'good';
  if (status === 'FAILED' || status === 'MAPPING_EXCEPTION') return 'danger';
  if (status === 'RELEASE_READY') return 'warn';
  if (status === 'RELEASED' || status === 'PICKING' || status === 'PACKED' || status === 'STAGED' || status === 'OUT_FOR_DELIVERY') return 'blue';
  return 'neutral';
}

function sortRows(rows: ImportedOrder[], sort: string) {
  if (sort === 'operations') return sortOrdersForOperations(rows);
  return [...rows].sort((left, right) => {
    if (sort === 'store') return left.store.localeCompare(right.store) || left.orderNo.localeCompare(right.orderNo);
    if (sort === 'due') return String(left.deliveryDate || left.dueAt || '').localeCompare(String(right.deliveryDate || right.dueAt || ''));
    if (sort === 'value') return right.amount - left.amount || left.orderNo.localeCompare(right.orderNo);
    if (sort === 'updated') return String(right.lastSeenAt || '').localeCompare(String(left.lastSeenAt || ''));
    return 0;
  });
}

function matchesReleaseFilter(order: ImportedOrder, filter: string, releasedOrders: Record<string, string>) {
  if (filter === 'all') return true;
  if (filter === 'released') return Boolean(releasedOrders[order.id]);
  if (filter === 'ready') return order.releaseGateStatus === 'READY_TO_RELEASE' && order.hasInternalOrder === true && !order.releaseBlockers;
  if (filter === 'blocked') return Boolean(order.releaseBlockers) || Boolean(order.releaseGateStatus && order.releaseGateStatus !== 'READY_TO_RELEASE');
  return true;
}

function money(value: number) {
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

export function OrdermentumWorkspacePage({
  orders,
  setOrders,
  data,
  mappingExceptions,
  day,
  setDay,
  loading,
  available,
  loadError,
  healthNotice,
  onReload,
}: {
  orders: ImportedOrder[];
  setOrders: Dispatch<SetStateAction<ImportedOrder[]>>;
  data: EcoFlowDataSet;
  mappingExceptions: MappingException[];
  day: DriverDayState;
  setDay: Dispatch<SetStateAction<DriverDayState>>;
  loading: boolean;
  available: boolean;
  loadError?: string;
  healthNotice?: string;
  onReload: () => Promise<void>;
}) {
  const { state, update, clear } = useWorkspaceQueryState({
    tab: 'newToday',
    search: '',
    filter: 'all',
    sort: 'operations',
    page: 1,
    pageSize: 25,
    allowedTabs: BUCKET_TABS,
    allowedFilters: FILTERS,
    allowedSorts: SORTS,
    allowedPageSizes: PAGE_SIZES,
  });
  const [internalising, setInternalising] = useState(false);
  const [actionNotice, setActionNotice] = useState('');

  const bucket = isOrderBucket(state.tab) ? state.tab : 'all';
  const counts = getOrderBucketCounts(orders, data.businessDay.date);
  const filteredOrders = useMemo(() => {
    const needle = state.search.toLowerCase();
    return sortRows(
      bucketOrders(orders, bucket, data.businessDay.date).filter((order) => {
        if (!matchesReleaseFilter(order, state.filter, day.releasedOrders)) return false;
        if (!needle) return true;
        return [order.orderNo, order.invoiceNo, order.store, order.account, order.suburb, order.priceTier, order.releaseBlockers, order.changeSummary]
          .some((value) => String(value || '').toLowerCase().includes(needle));
      }),
      state.sort,
    );
  }, [bucket, data.businessDay.date, day.releasedOrders, orders, state.filter, state.search, state.sort]);

  const visibleExceptions = useMemo(() => {
    const needle = state.search.toLowerCase();
    return mappingExceptions.filter((exception) => {
      const order = orders.find((item) => item.id === exception.orderId);
      if (order && order.status !== 'MAPPING_EXCEPTION' && order.openExceptionCount <= 0) return false;
      if (!needle) return true;
      return [exception.orderNo, exception.store, exception.category, exception.summary, exception.detail, exception.action]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [mappingExceptions, orders, state.search]);

  const activeRows = state.tab === 'exceptions' ? visibleExceptions : filteredOrders;
  const page = paginateRows(activeRows, state.page, state.pageSize);
  const releasedCount = Object.keys(day.releasedOrders).length;
  const ready = orders.filter((order) => order.status === 'RELEASE_READY'
    && order.releaseGateStatus === 'READY_TO_RELEASE'
    && order.hasInternalOrder === true
    && !order.releaseBlockers
    && !day.releasedOrders[order.id]);
  const selectedReady = ready.filter((order) => order.selected);

  const notice = actionNotice || (loadError
    ? `Live Ordermentum refresh failed. The last trusted snapshot remains visible. ${loadError}`
    : healthNotice
      ? `Ordermentum workspace is degraded: ${healthNotice}`
      : '');

  async function internaliseEligible() {
    setInternalising(true);
    setActionNotice('');
    try {
      const rows = await callInternaliseOrders(50, false);
      const created = rows.filter((row) => row.internal_order_id).length;
      setActionNotice(`${created} internal orders created or updated through the governed database RPC.`);
      await onReload();
    } catch (error) {
      setActionNotice(error instanceof Error ? `Internalisation failed: ${error.message}` : 'Internalisation failed.');
    } finally {
      setInternalising(false);
    }
  }

  function toggleSelected(orderId: string) {
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, selected: !order.selected } : order));
  }

  function releaseOrders(orderIds: string[]) {
    if (!orderIds.length) return;
    const base = Date.now();
    setDay((current) => ({
      ...current,
      releasedOrders: {
        ...current.releasedOrders,
        ...Object.fromEntries(orderIds.map((id, index) => [id, new Date(base + index).toISOString()])),
      },
    }));
    setOrders((current) => current.map((order) => orderIds.includes(order.id) ? { ...order, selected: false } : order));
    setActionNotice(`${orderIds.length} order${orderIds.length === 1 ? '' : 's'} released to Run ${day.runCode}. Server authority will reconcile the command across devices.`);
  }

  return (
    <NativeWorkspaceFrame
      eyebrow="NATIVE ROUTE · ORDERMENTUM"
      title="Ordermentum inbox and exception control"
      detail="The daily intake, release gate and source exceptions are owned by this React route. Query state is shareable and no portal waits for visible headings before the workspace appears."
      notice={notice}
      noticeTone={loadError || actionNotice.toLowerCase().includes('failed') ? 'danger' : 'warning'}
      actions={(
        <>
          <button type="button" className="soft-button" onClick={clear}>Reset view</button>
          <button type="button" className="soft-button" disabled={internalising || !available} onClick={() => void internaliseEligible()}>{internalising ? 'Internalising…' : 'Internalise eligible'}</button>
          <button type="button" className="primary-small" disabled={loading} onClick={() => void onReload()}>{loading ? 'Refreshing…' : 'Refresh source'}</button>
        </>
      )}
    >
      <section className="panel">
        <div className="panel-head"><h2>Source and release status</h2><span>Business day {data.businessDay.label}</span></div>
        <div className="readiness-grid">
          <div><strong>{data.syncBatch.fetched}</strong><span>fetched</span></div>
          <div><strong>{data.syncBatch.created}</strong><span>new</span></div>
          <div><strong>{data.syncBatch.updated}</strong><span>updated</span></div>
          <div><strong>{orders.filter((order) => order.releaseGateStatus === 'READY_TO_RELEASE').length}</strong><span>release gate ready</span></div>
          <div><strong>{ready.length}</strong><span>ready for run</span></div>
          <div><strong>{releasedCount}</strong><span>released to Run {day.runCode}</span></div>
        </div>
      </section>

      <nav className="native-workspace-tabs" aria-label="Ordermentum inbox buckets">
        {orderBucketDefinitions.map((definition) => {
          const count = counts.find((item) => item.key === definition.key)?.count ?? 0;
          return <button key={definition.key} type="button" className={state.tab === definition.key ? 'active' : ''} onClick={() => update({ tab: definition.key })}>{definition.label} · {count}</button>;
        })}
        <button type="button" className={state.tab === 'exceptions' ? 'active' : ''} onClick={() => update({ tab: 'exceptions' })}>Exceptions · {visibleExceptions.length}</button>
      </nav>

      <section className="panel native-workspace-toolbar">
        <label>
          <span>Search</span>
          <input value={state.search} placeholder="Order, invoice, store, blocker or exception" onChange={(event) => update({ search: event.target.value }, { replace: true })} />
        </label>
        <label>
          <span>Release filter</span>
          <select value={state.filter} disabled={state.tab === 'exceptions'} onChange={(event) => update({ filter: event.target.value })}>
            <option value="all">All release states</option>
            <option value="ready">Ready for run</option>
            <option value="blocked">Blocked / review</option>
            <option value="released">Released</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={state.sort} disabled={state.tab === 'exceptions'} onChange={(event) => update({ sort: event.target.value })}>
            <option value="operations">Operational priority</option>
            <option value="store">Store</option>
            <option value="due">Delivery date</option>
            <option value="value">Order value</option>
            <option value="updated">Last updated</option>
          </select>
        </label>
        <label>
          <span>Page size</span>
          <select value={state.pageSize} onChange={(event) => update({ pageSize: Number(event.target.value) })}>
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </section>

      {selectedReady.length ? (
        <section className="panel">
          <div className="panel-head"><h2>{selectedReady.length} ready order{selectedReady.length === 1 ? '' : 's'} selected</h2><span>Release remains subject to server-authoritative day-state revision checks</span></div>
          <button type="button" className="primary-small" onClick={() => releaseOrders(selectedReady.map((order) => order.id))}>Release selected to Run {day.runCode}</button>
        </section>
      ) : null}

      {loading && !available ? <NativeWorkspaceLoading label="Ordermentum inbox" /> : null}
      {!loading && !available ? <NativeWorkspaceUnavailable label="Ordermentum inbox" detail={loadError || 'No trusted source snapshot is available. EcoFlow will not show sample orders or false zero counts.'} onRetry={() => void onReload()} /> : null}
      {available && !activeRows.length ? <NativeWorkspaceEmpty title="No records match this view" detail="Change the bucket, query or release filter. The current view remains encoded in the URL." /> : null}

      {available && activeRows.length && state.tab !== 'exceptions' ? (
        <section className="panel">
          <div className="panel-head"><h2>Retained order database</h2><span>{filteredOrders.length} matching · {orders.length} retained</span></div>
          <div className="table-like native-ordermentum-table">
            <div className="table-head"><span>Select</span><span>Order</span><span>Store</span><span>Due</span><span>Sync / impact</span><span>Release gate</span><span>Action</span></div>
            {(page.rows as ImportedOrder[]).map((order) => {
              const canRelease = ready.some((candidate) => candidate.id === order.id);
              const released = Boolean(day.releasedOrders[order.id]);
              return (
                <div className="table-row" key={order.id}>
                  <span><input type="checkbox" checked={order.selected} disabled={!canRelease} aria-label={`Select ${order.orderNo}`} onChange={() => toggleSelected(order.id)} /></span>
                  <span><strong><a href={`/orders/${encodeURIComponent(order.id)}`}>{order.orderNo}</a></strong><small>{order.invoiceNo} · {money(order.amount)}</small></span>
                  <span><strong>{order.store}</strong><small>{order.priceTier} · {order.suburb}</small></span>
                  <span><strong>{formatBusinessDate(order.deliveryDate || order.dueAt)}</strong><small>{order.packageCount} labels</small></span>
                  <span><strong>{syncStatusLabel(order.syncStatus)}</strong><small>{changeImpactLabel(order.changeImpact)} · {formatDateTime(order.lastSeenAt)}</small></span>
                  <span><span className={`pill pill-${releaseTone(order.releaseGateStatus)}`}>{released ? 'RELEASED' : order.releaseGateStatus?.replace(/_/g, ' ') || 'CHECK REQUIRED'}</span><small>{order.releaseBlockers || order.changeSummary}</small></span>
                  <span>{canRelease ? <button type="button" className="primary-small" onClick={() => releaseOrders([order.id])}>Release</button> : <span className={`pill pill-${statusTone(order.status)}`}>{order.status.replace(/_/g, ' ')}</span>}</span>
                </div>
              );
            })}
          </div>
          <NativePager page={page.page} totalPages={page.totalPages} totalRows={page.totalRows} onPage={(next) => update({ page: next }, { preservePage: true })} />
        </section>
      ) : null}

      {available && activeRows.length && state.tab === 'exceptions' ? (
        <section className="panel">
          <div className="panel-head"><h2>Source and mapping exceptions</h2><span>{visibleExceptions.length} actionable source records</span></div>
          <div className="native-exception-list">
            {(page.rows as MappingException[]).map((exception) => (
              <article className="native-exception-row" key={exception.id}>
                <span className={`pill pill-${exception.severity === 'danger' ? 'danger' : 'warn'}`}>{exception.category.replace(/_/g, ' ')}</span>
                <div><strong><a href={`/orders/${encodeURIComponent(exception.orderId)}`}>{exception.orderNo}</a></strong><span>{exception.store}</span></div>
                <div><strong>{exception.summary}</strong><small>{exception.detail}</small></div>
                <div><strong>Recommended action</strong><span>{exception.action}</span></div>
              </article>
            ))}
          </div>
          <NativePager page={page.page} totalPages={page.totalPages} totalRows={page.totalRows} onPage={(next) => update({ page: next }, { preservePage: true })} />
        </section>
      ) : null}
    </NativeWorkspaceFrame>
  );
}
