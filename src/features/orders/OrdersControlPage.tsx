import { ChevronLeft, ChevronRight, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import type { ImportedOrder } from '@/domain/types';
import {
  ControlButton,
  ControlInput,
  ControlPanel,
  ControlSelect,
  ControlStatus,
} from '@/features/intelligence/designSystem/primitives';
import { useOverlayManager } from '@/features/intelligence/overlays';
import {
  decodeListSort,
  encodeListSort,
  useWorkspaceListQuery,
  type ListQueryDirection,
} from '@/features/intelligence/query';
import {
  buildOrderOverlayRecord,
  formatOrderDateTime,
  formatOrderMoney,
  orderStatusLabel,
  orderStatusOptions,
  orderStatusTone,
  ordersListQuerySchema,
  paymentStatusOptions,
  paymentStatusTone,
  podStatusTone,
  type OrdersSortKey,
} from './ordersQueryContract';
import './ordersControlPage.css';

type Props = {
  orders: readonly ImportedOrder[];
};

const sortOptions: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'updated:desc', label: 'Updated · newest' },
  { value: 'updated:asc', label: 'Updated · oldest' },
  { value: 'value:desc', label: 'Value · high to low' },
  { value: 'value:asc', label: 'Value · low to high' },
  { value: 'order:asc', label: 'Order · ascending' },
  { value: 'store:asc', label: 'Store · ascending' },
  { value: 'status:asc', label: 'Status · ascending' },
];

export function OrdersControlPage({ orders }: Props) {
  const {
    result,
    setSearch,
    setFilter,
    setSort,
    setPage,
    setPageSize,
    clear,
  } = useWorkspaceListQuery(orders, ordersListQuerySchema);
  const { openPrimaryRecord } = useOverlayManager();

  const status = result.query.filters.status?.[0] ?? '';
  const payment = result.query.filters.payment?.[0] ?? '';
  const pod = result.query.filters.pod?.[0] ?? '';
  const sortValue = encodeListSort(result.query.sortKey, result.query.direction);
  const activeQuery = Boolean(
    result.query.search
      || status
      || payment
      || pod
      || sortValue !== 'updated:desc'
      || result.query.pageSize !== 25,
  );

  function changeSort(value: string) {
    const parsed = decodeListSort(value);
    if (!parsed || !parsed.direction) return;
    setSort(parsed.key as OrdersSortKey, parsed.direction as ListQueryDirection);
  }

  return (
    <section className="orders-control-page" data-query-issues={result.issues.length}>
      <header className="orders-control-header">
        <div>
          <span>ORDERMENTUM ORDERS</span>
          <h1>Order control</h1>
          <p>{orders.length} orders from Ordermentum · status follows the real workflow</p>
        </div>
        <div className="orders-control-header__count">
          <strong>{result.total}</strong>
          <span>VISIBLE</span>
        </div>
      </header>

      <ControlPanel tone="dark" className="orders-control-query">
        <div className="orders-control-query__grid">
          <ControlInput
            label="Search orders"
            labelMode="sr-only"
            density="compact"
            value={result.query.search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search orders"
            leading={<Search />}
            autoComplete="off"
          />
          <ControlSelect
            label="Status"
            labelMode="sr-only"
            density="compact"
            value={status}
            onChange={(event) => setFilter('status', event.currentTarget.value || undefined)}
          >
            <option value="">All status</option>
            {orderStatusOptions.map((option) => (
              <option key={option} value={option}>{orderStatusLabel(option)}</option>
            ))}
          </ControlSelect>
          <ControlSelect
            label="Payment"
            labelMode="sr-only"
            density="compact"
            value={payment}
            onChange={(event) => setFilter('payment', event.currentTarget.value || undefined)}
          >
            <option value="">All payment</option>
            {paymentStatusOptions.map((option) => (
              <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
            ))}
          </ControlSelect>
          <ControlSelect
            label="POD"
            labelMode="sr-only"
            density="compact"
            value={pod}
            onChange={(event) => setFilter('pod', event.currentTarget.value || undefined)}
          >
            <option value="">All POD</option>
            <option value="captured">Captured</option>
            <option value="missing">Missing</option>
          </ControlSelect>
          <ControlSelect
            label="Sort"
            labelMode="sr-only"
            density="compact"
            value={sortValue}
            onChange={(event) => changeSort(event.currentTarget.value)}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </ControlSelect>
          <ControlSelect
            label="Rows per page"
            labelMode="sr-only"
            density="compact"
            value={String(result.query.pageSize)}
            onChange={(event) => setPageSize(Number(event.currentTarget.value))}
          >
            <option value="25">25 rows</option>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
          </ControlSelect>
          <ControlButton
            variant="quiet"
            size="compact"
            leading={activeQuery ? <RotateCcw /> : <SlidersHorizontal />}
            onClick={clear}
            disabled={!activeQuery}
          >
            Reset
          </ControlButton>
        </div>
      </ControlPanel>

      <div className="orders-control-readout">
        <span>{result.from}–{result.to} of {result.total}</span>
        <span>Page {result.query.page} of {result.totalPages}</span>
      </div>

      <ControlPanel tone="raised" className="orders-control-table-panel">
        <div className="orders-control-table" role="table" aria-label="Orders">
          <div className="orders-control-row orders-control-row--head" role="row">
            <span role="columnheader">Order</span>
            <span role="columnheader">Store</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Payment</span>
            <span role="columnheader">Value</span>
            <span role="columnheader">POD</span>
            <span role="columnheader">Updated</span>
          </div>
          {result.rows.map((order) => (
            <button
              key={order.id}
              type="button"
              className="orders-control-row"
              role="row"
              aria-label={`Open ${order.orderNo}`}
              onClick={() => openPrimaryRecord(buildOrderOverlayRecord(order))}
            >
              <span role="cell"><strong>{order.orderNo}</strong><small>{order.invoiceNo || '—'}</small></span>
              <span role="cell"><strong>{order.store}</strong><small>{order.suburb} · {order.priceTier}</small></span>
              <span role="cell"><ControlStatus tone={orderStatusTone(order.status)} label={orderStatusLabel(order.status)} compact /></span>
              <span role="cell"><ControlStatus tone={paymentStatusTone(order.paymentStatus)} label={order.paymentStatus.replace(/_/g, ' ')} compact /></span>
              <span role="cell" className="orders-control-value">{formatOrderMoney(order.amount)}</span>
              <span role="cell"><ControlStatus tone={podStatusTone(order.podStatus)} label={order.podStatus} compact /></span>
              <span role="cell"><strong>{formatOrderDateTime(order.lastSeenAt)}</strong><small>{order.changeSummary}</small></span>
            </button>
          ))}
          {!result.rows.length ? <div className="orders-control-empty">No matching orders.</div> : null}
        </div>
      </ControlPanel>

      <nav className="orders-control-pager" aria-label="Order pages">
        <ControlButton
          variant="secondary"
          size="compact"
          leading={<ChevronLeft />}
          disabled={result.query.page <= 1}
          onClick={() => setPage(result.query.page - 1)}
        >
          Previous
        </ControlButton>
        <span>{result.from}–{result.to} / {result.total}</span>
        <ControlButton
          variant="secondary"
          size="compact"
          trailing={<ChevronRight />}
          disabled={result.query.page >= result.totalPages}
          onClick={() => setPage(result.query.page + 1)}
        >
          Next
        </ControlButton>
      </nav>
    </section>
  );
}
