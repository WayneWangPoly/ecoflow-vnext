import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { buildEcoFlowData } from '@/domain/ecoflowData';
import { applySupabaseOrdermentumViews, loadSupabaseOrdermentumViews } from '@/data/repositories/supabaseOrdermentumViews';
import { bucketOrders, getOrderBucketCounts, orderBucketDefinitions } from '@/domain/orderBuckets';
import { changeImpactLabel, formatBusinessDate, formatDateTime, sortOrdersForOperations, syncStatusLabel } from '@/domain/syncModel';
import type {
  Activity,
  CatalogRow,
  DataQualityItem,
  DesktopTab,
  DriverTab,
  EcoFlowDataSet,
  ImportedOrder,
  OrderBucketCount,
  OrderBucketKey,
  MappingException,
  OrderLine,
  OrderStatus,
  PriceGroupRow,
  PriceTier,
  Role,
  StockRow,
  StoreProfile,
  WarehouseTab
} from '@/domain/types';

const initialData = buildEcoFlowData();

const roleOptions: { role: Role; label: string; passcode: string; shell: 'desktop' | 'mobile' }[] = [
  { role: 'owner', label: 'Owner', passcode: '0000', shell: 'desktop' },
  { role: 'account', label: 'Account', passcode: '0000', shell: 'desktop' },
  { role: 'warehouse', label: 'Warehouse', passcode: '4444', shell: 'mobile' },
  { role: 'driver', label: 'Driver', passcode: '6666', shell: 'mobile' }
];

const desktopTabs: { id: DesktopTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'ordermentum', label: 'Ordermentum' },
  { id: 'orders', label: 'Orders' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'stores', label: 'Stores' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Settings' }
];

function cls(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function money(value: number) {
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function statusLabel(status: OrderStatus) {
  return status.replace(/_/g, ' ');
}

function roleLabel(role: Role) {
  return roleOptions.find((item) => item.role === role)?.label ?? role;
}

function syncTone(status: ImportedOrder['syncStatus']): 'good' | 'blue' | 'neutral' {
  if (status === 'NEW') return 'good';
  if (status === 'UPDATED') return 'blue';
  return 'neutral';
}

function impactTone(impact: ImportedOrder['changeImpact']): 'good' | 'warn' | 'danger' | 'neutral' | 'blue' {
  if (impact === 'SAFE_UPDATE') return 'good';
  if (impact === 'REVIEW_REQUIRED') return 'warn';
  if (impact === 'RECONCILIATION_VARIANCE') return 'danger';
  return 'neutral';
}

function sourceLabel(source: CatalogRow['source'] | OrderLine['source']) {
  if (source === 'order-detail') return 'order detail';
  if (source === 'variant') return 'variant';
  if (source === 'product') return 'product';
  if (source === 'catalog-sample') return 'catalog';
  return 'fallback';
}

function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <div className={cls('brand-logo', large && 'brand-logo-large')} aria-label="EcoFlow Packaging">
      <span className="brand-monogram">EF</span>
      <span className="brand-tag">PACK</span>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (role: Role) => void }) {
  const [role, setRole] = useState<Role>('owner');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');

  function submit() {
    const selected = roleOptions.find((item) => item.role === role);
    if (selected?.passcode === passcode) {
      window.localStorage.setItem('ecoflow-role', role);
      onLogin(role);
      return;
    }
    setError('Wrong passcode for this role.');
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand-row">
          <BrandMark large />
          <div>
            <div className="login-brand-name">EcoFlow</div>
            <div className="login-brand-subtitle">PACKAGING OPERATIONS</div>
          </div>
        </div>
        <h1>Delivery OS</h1>
        <label htmlFor="role-select">Role</label>
        <select id="role-select" value={role} onChange={(event) => setRole(event.target.value as Role)}>
          {roleOptions.map((item) => <option key={item.role} value={item.role}>{item.label}</option>)}
        </select>
        <label htmlFor="passcode">Passcode</label>
        <input id="passcode" type="password" inputMode="numeric" value={passcode} autoFocus onChange={(event) => setPasscode(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} />
        {error ? <div className="error-message">{error}</div> : null}
        <button className="primary-button" type="button" onClick={submit}>Enter</button>
      </section>
    </main>
  );
}

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'danger' | 'blue' }) {
  return <span className={cls('pill', `pill-${tone}`)}>{children}</span>;
}

function MetricCard({ label, value, tone = 'green', helper }: { label: string; value: string | number; tone?: 'green' | 'gold' | 'blue' | 'mint'; helper?: string }) {
  return (
    <article className={cls('metric-card', `metric-${tone}`)}>
      <strong>{value}</strong>
      <span>{label}</span>
      {helper ? <small>{helper}</small> : null}
    </article>
  );
}

function StatusPill({ status }: { status: OrderStatus }) {
  const tone = status === 'DELIVERED' || status === 'CLOSED' ? 'good' : status === 'MAPPING_EXCEPTION' ? 'danger' : status === 'OUT_FOR_DELIVERY' || status === 'PACKED' || status === 'STAGED' ? 'blue' : status === 'RELEASE_READY' ? 'warn' : 'neutral';
  return <Pill tone={tone}>{statusLabel(status)}</Pill>;
}


function QualityRow({ item }: { item: DataQualityItem }) {
  const tone = item.severity === 'good' ? 'good' : item.severity === 'danger' ? 'danger' : item.severity === 'warn' ? 'warn' : 'blue';
  return (
    <article className="quality-row">
      <Pill tone={tone}>{item.severity.toUpperCase()}</Pill>
      <div><strong>{item.area}</strong><span>{item.message}</span><small>{item.detail}</small></div>
    </article>
  );
}


function DesktopShell({ role, tab, setTab, onLogout, onUndo, children }: {
  role: Role;
  tab: DesktopTab;
  setTab: (tab: DesktopTab) => void;
  onLogout: () => void;
  onUndo: () => void;
  children: ReactNode;
}) {
  return (
    <div className="desktop-app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark />
          <div>
            <strong>EcoFlow</strong>
            <span>{roleLabel(role).toUpperCase()}</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {desktopTabs.map((item) => (
            <button key={item.id} type="button" className={cls(tab === item.id && 'active')} onClick={() => setTab(item.id)}>{item.label}</button>
          ))}
        </nav>
      </aside>
      <section className="desktop-main">
        <header className="desktop-topbar">
          <div className="topbar-title">
            <BrandMark />
            <div>
              <strong>EcoFlow</strong>
              <span>PACKAGING OPERATIONS</span>
            </div>
          </div>
          <div className="topbar-actions">
            <button type="button" onClick={onUndo}>Undo</button>
            <button type="button" onClick={onLogout}>Logout</button>
          </div>
        </header>
        <main className="desktop-content">{children}</main>
      </section>
    </div>
  );
}

function HeroDashboard({ role, orders, stock, dataQuality, syncBatch, bucketCounts }: { role: Role; orders: ImportedOrder[]; stock: StockRow[]; dataQuality: DataQualityItem[]; syncBatch: EcoFlowDataSet['syncBatch']; bucketCounts: OrderBucketCount[] }) {
  const delivered = orders.filter((order) => order.status === 'DELIVERED' || order.status === 'CLOSED').length;
  const openAR = orders.filter((order) => order.paymentStatus !== 'PAID').reduce((sum, order) => sum + order.amount, 0);
  const lowStock = stock.filter((row) => row.onHand <= row.reorderPoint || row.onHand < row.reserved);
  const warnings = dataQuality.filter((item) => item.severity === 'warn' || item.severity === 'danger').length;
  const count = (key: OrderBucketKey) => bucketCounts.find((item) => item.key === key)?.count ?? 0;
  const activeOrders = orders.filter((order) => !['DELIVERED', 'CLOSED', 'CANCELLED'].includes(order.status)).length;

  return (
    <>
      <section className="hero-card">
        <div className="hero-copy">
          <span>ECOFLOW CONTROL ROOM · ORDERMENTUM INBOX</span>
          <h1>Build the supply chain<br />behind a cleaner food future.</h1>
          <div className="date-chip">{syncBatch.businessDay.label} · cutoff {syncBatch.businessDay.cutoffTime} · {syncBatch.source}</div>
        </div>
        <div className="hero-metrics">
          <MetricCard label="NEW TODAY" value={count('newToday')} helper="first seen" />
          <MetricCard label="UPDATED TODAY" value={count('updatedToday')} tone="blue" helper="changed" />
          <MetricCard label="CARRY-OVER" value={count('carryOver')} tone="gold" helper="open from earlier" />
          <MetricCard label="DUE TODAY" value={count('dueToday')} tone="mint" helper="operational day" />
        </div>
      </section>

      <section className="quick-stats">
        <MetricCard label="ORDERS IN DATABASE" value={orders.length} tone="green" />
        <MetricCard label="ACTIVE ORDERS" value={activeOrders} tone="gold" />
        <MetricCard label="EXCEPTIONS" value={count('exceptions')} tone="mint" />
        <MetricCard label="OPEN AR" value={money(openAR)} tone="blue" />
      </section>

      <section className="dashboard-grid">
        <div className="panel large-panel">
          <div className="panel-head">
            <h2>{role === 'account' ? 'Ordermentum inbox' : 'Daily control queue'}</h2>
            <span>{syncBatch.created} new · {syncBatch.updated} updated · {syncBatch.unchanged} unchanged</span>
          </div>
          <div className="list-stack">
            {sortOrdersForOperations(orders).filter((order) => order.syncStatus !== 'UNCHANGED' || order.openExceptionCount > 0).slice(0, 10).map((order) => (
              <OrderListItem key={order.id} order={order} />
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Sync control</h2>
            <Pill tone={syncBatch.status === 'SUCCESS' ? 'good' : 'warn'}>{syncBatch.status}</Pill>
          </div>
          <div className="sync-card-stack">
            <div><strong>{formatDateTime(syncBatch.completedAt)}</strong><span>Last sync</span></div>
            <div><strong>{syncBatch.fetched}</strong><span>Fetched</span></div>
            <div><strong>{delivered}</strong><span>Completed</span></div>
            <div><strong>{warnings}</strong><span>Data warnings</span></div>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Stock watch</h2>
            <span>{lowStock.length} pressure rows</span>
          </div>
          <div className="stock-watch">
            {lowStock.slice(0, 8).map((row) => (
              <div className="stock-watch-row" key={row.sku}>
                <div><strong>{row.sku}</strong><span>{row.location} · reserved {row.reserved}</span></div>
                <Pill tone={row.onHand < row.reserved ? 'danger' : 'warn'}>{row.onHand < row.reserved ? 'INSUFFICIENT' : 'LOW'}</Pill>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Operational buckets</h2><span>{syncBatch.businessDay.label}</span></div>
          <div className="bucket-mini-grid">
            {bucketCounts.map((bucket) => <div key={bucket.key}><strong>{bucket.count}</strong><span>{bucket.label}</span></div>)}
          </div>
        </div>
      </section>
    </>
  );
}

function OrderListItem({ order, selectable, onToggle }: { order: ImportedOrder; selectable?: boolean; onToggle?: () => void }) {
  return (
    <article className="order-list-item">
      {selectable ? <input type="checkbox" checked={order.selected} onChange={onToggle} aria-label={`select ${order.orderNo}`} /> : null}
      <div className="order-main-copy">
        <div className="order-title-line"><strong>{order.orderNo}</strong><StatusPill status={order.status} /><Pill tone={syncTone(order.syncStatus)}>{syncStatusLabel(order.syncStatus)}</Pill></div>
        <span>{order.store} · {order.suburb} · {order.priceTier}</span>
        <small>{order.lines.map((line) => `${line.sku} × ${line.qty} ${line.unit}`).join(' · ')}</small>
      </div>
      <div className="order-side-copy">
        <strong>{money(order.amount)}</strong>
        <small>{order.packageCount} labels · due {formatBusinessDate(order.deliveryDate || order.dueAt)}</small>
      </div>
    </article>
  );
}

function OrdermentumPanel({ orders, setOrders, data, mappingExceptions }: { orders: ImportedOrder[]; setOrders: React.Dispatch<React.SetStateAction<ImportedOrder[]>>; data: EcoFlowDataSet; mappingExceptions: MappingException[] }) {
  const [bucket, setBucket] = useState<OrderBucketKey>('newToday');
  const bucketCounts = getOrderBucketCounts(orders, data.businessDay.date);
  const bucketRows = sortOrdersForOperations(bucketOrders(orders, bucket, data.businessDay.date));
  const visibleExceptions = mappingExceptions.filter((exception) => {
    const order = orders.find((item) => item.id === exception.orderId);
    return order ? order.status === 'MAPPING_EXCEPTION' || order.openExceptionCount > 0 : true;
  });
  const ready = orders.filter((order) => order.status === 'RELEASE_READY');
  const selectedReady = ready.filter((order) => order.selected).length;

  function releaseSelected() {
    setOrders((current) => current.map((order) => order.status === 'RELEASE_READY' && order.selected ? { ...order, status: 'RELEASED' } : order));
  }

  function clearException(orderId: string) {
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, status: 'RELEASE_READY', selected: true, mappingNotes: [], openExceptionCount: 0 } : order));
  }

  function releaseOrder(orderId: string) {
    setOrders((current) => current.map((order) => order.id === orderId && order.status === 'RELEASE_READY' ? { ...order, status: 'RELEASED', selected: false } : order));
  }

  return (
    <section className="workspace-stack">
      <section className="panel sync-panel">
        <div className="sync-header-block">
          <span className="section-eyebrow">ORDERMENTUM INBOX</span>
          <h2>Daily order intake</h2>
          <div className="sync-meta-line">Business day {data.businessDay.label} · last sync {formatDateTime(data.syncBatch.completedAt)}</div>
        </div>
        <div className="sync-strip">
          <div><strong>{data.syncBatch.fetched}</strong><span>Fetched</span></div>
          <div><strong>{data.syncBatch.created}</strong><span>New</span></div>
          <div><strong>{data.syncBatch.updated}</strong><span>Updated</span></div>
          <div><strong>{data.syncBatch.unchanged}</strong><span>Unchanged</span></div>
          <div><strong>{data.syncBatch.failed}</strong><span>Failed</span></div>
        </div>
      </section>

      <section className="panel inbox-panel">
        <div className="panel-head"><h2>Order database</h2><Pill tone="blue">{orders.length} retained</Pill></div>
        <nav className="inbox-tabs" aria-label="Ordermentum order buckets">
          {orderBucketDefinitions.map((definition) => {
            const count = bucketCounts.find((item) => item.key === definition.key)?.count ?? 0;
            return <button key={definition.key} type="button" className={cls(bucket === definition.key && 'active')} onClick={() => setBucket(definition.key)}><span>{definition.label}</span><strong>{count}</strong></button>;
          })}
        </nav>
        <div className="table-like inbox-table-like">
          <div className="table-head"><span>Order</span><span>Store</span><span>Received</span><span>Updated</span><span>Due</span><span>Sync</span><span>Impact</span><span>Action</span></div>
          {bucketRows.map((order) => (
            <div className="table-row" key={order.id}>
              <span><strong>{order.orderNo}</strong><small>{order.invoiceNo}</small></span>
              <span><strong>{order.store}</strong><small>{order.priceTier} · {order.suburb}</small></span>
              <span>{formatDateTime(order.firstSeenAt)}<small>{order.firstSeenBusinessDay}</small></span>
              <span>{formatDateTime(order.lastSeenAt)}<small>{order.changeSummary}</small></span>
              <span>{formatBusinessDate(order.deliveryDate || order.dueAt)}<small>{order.requestedDeliveryBusinessDay}</small></span>
              <span><Pill tone={syncTone(order.syncStatus)}>{syncStatusLabel(order.syncStatus)}</Pill></span>
              <span><Pill tone={impactTone(order.changeImpact)}>{changeImpactLabel(order.changeImpact)}</Pill></span>
              <span className="row-actions">
                {order.status === 'MAPPING_EXCEPTION' ? <button className="soft-button" type="button" onClick={() => clearException(order.id)}>Resolve</button> : null}
                {order.status === 'RELEASE_READY' ? <button className="soft-button" type="button" onClick={() => releaseOrder(order.id)}>Release</button> : null}
                {order.status !== 'MAPPING_EXCEPTION' && order.status !== 'RELEASE_READY' ? <StatusPill status={order.status} /> : null}
              </span>
            </div>
          ))}
          {!bucketRows.length ? <div className="empty-state">No orders in this bucket.</div> : null}
        </div>
      </section>

      <section className="split-grid">
        <div className="panel">
          <div className="panel-head"><h2>Exception control</h2><Pill tone={visibleExceptions.length ? 'danger' : 'good'}>{visibleExceptions.length} open</Pill></div>
          <div className="list-stack">
            {visibleExceptions.slice(0, 14).map((exception) => (
              <article className="exception-card" key={exception.id}>
                <div><strong>{exception.orderNo}</strong><span>{exception.store} · {exception.category.replace(/_/g, ' ')}</span></div>
                <p>{exception.summary}</p>
                <small>{exception.detail}</small>
                <button className="soft-button" type="button" onClick={() => clearException(exception.orderId)}>{exception.action}</button>
              </article>
            ))}
            {!visibleExceptions.length ? <div className="empty-state">No open exception.</div> : null}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Release queue</h2><button className="primary-small" type="button" disabled={!selectedReady} onClick={releaseSelected}>Release {selectedReady}</button></div>
          <div className="list-stack">
            {ready.slice(0, 12).map((order) => <OrderListItem key={order.id} order={order} selectable onToggle={() => setOrders((current) => current.map((item) => item.id === order.id ? { ...item, selected: !item.selected } : item))} />)}
            {!ready.length ? <div className="empty-state">No order ready for release.</div> : null}
          </div>
        </div>
      </section>

      <section className="split-grid">
        <div className="panel">
          <div className="panel-head"><h2>Import checks</h2><Pill tone={data.dataQuality.some((item) => item.severity === 'danger') ? 'danger' : 'warn'}>{data.dataQuality.length} checks</Pill></div>
          <div className="quality-stack compact-quality-stack">
            {data.dataQuality.map((item) => <QualityRow key={`${item.area}-${item.message}`} item={item} />)}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Price groups</h2><span>{data.priceGroups.length} active</span></div>
          <div className="price-group-list">
            {data.priceGroups.map((group) => (
              <article className="price-group-card" key={group.id}>
                <div><strong>{group.name}</strong><span>{group.default ? 'Default group' : 'Custom group'}</span></div>
                <Pill tone={group.default ? 'good' : 'blue'}>{group.retailersTotal} retailers</Pill>
              </article>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}

function OrdersPanel({ orders, setOrders }: { orders: ImportedOrder[]; setOrders: React.Dispatch<React.SetStateAction<ImportedOrder[]>> }) {
  function advance(orderId: string) {
    const flow: OrderStatus[] = ['RELEASE_READY', 'RELEASED', 'PICKING', 'PACKED', 'STAGED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CLOSED'];
    setOrders((current) => current.map((order) => {
      if (order.id !== orderId) return order;
      const index = flow.indexOf(order.status);
      if (index < 0 || index >= flow.length - 1) return order;
      return { ...order, status: flow[index + 1], podStatus: flow[index + 1] === 'DELIVERED' ? 'captured' : order.podStatus };
    }));
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Order control</h2><span>{orders.length} orders from Ordermentum</span></div>
      <div className="table-like">
        <div className="table-head"><span>Order</span><span>Store</span><span>Tier</span><span>Status</span><span>Value</span><span>Action</span></div>
        {orders.map((order) => (
          <div className="table-row" key={order.id}>
            <span><strong>{order.orderNo}</strong><small>{order.invoiceNo}</small></span>
            <span><strong>{order.store}</strong><small>{order.suburb}</small></span>
            <span>{order.priceTier}</span>
            <span><StatusPill status={order.status} /></span>
            <span>{money(order.amount)}</span>
            <span><button className="soft-button" type="button" onClick={() => advance(order.id)}>Next</button></span>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeliveryPanel({ orders }: { orders: ImportedOrder[] }) {
  const routeOrders = [...orders].sort((a, b) => a.sequence - b.sequence).slice(0, 12);
  return (
    <section className="split-grid delivery-layout">
      <div className="panel">
        <div className="panel-head"><h2>Today run</h2><Pill tone="blue">{routeOrders.length} stops</Pill></div>
        <div className="route-map">
          {routeOrders.map((order, index) => <div key={order.id} className="map-pin" style={{ left: `${18 + index * 16}%`, top: `${26 + (index % 3) * 18}%` }}>{index + 1}</div>)}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Stop order</h2><span>Driver run order</span></div>
        <div className="list-stack">
          {routeOrders.map((order) => (
            <article className="stop-row" key={order.id}>
              <b>{order.sequence}</b>
              <div><strong>{order.store}</strong><span>{order.address}</span></div>
              <StatusPill status={order.status} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function InventoryPanel({ stock, catalog, summary }: { stock: StockRow[]; catalog: CatalogRow[]; summary: EcoFlowDataSet['summary'] }) {
  return (
    <section className="workspace-stack">
      <section className="quick-stats">
        <MetricCard label="STOCK ROWS" value={stock.length} tone="green" />
        <MetricCard label="CATALOG COVERAGE" value={catalog.length} tone="blue" />
        <MetricCard label="PRODUCT TOTAL" value={summary.productCatalogTotal} tone="gold" />
        <MetricCard label="VARIANT TOTAL" value={summary.variantCatalogTotal} tone="mint" />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Inventory watch</h2><span>location, reserved, reorder pressure</span></div>
        <div className="table-like inventory-table-like">
          <div className="table-head"><span>SKU</span><span>Location</span><span>On hand</span><span>Reserved</span><span>Signal</span></div>
          {stock.slice(0, 18).map((row) => {
            const signal = row.onHand < row.reserved ? 'INSUFFICIENT' : row.onHand <= row.reorderPoint ? 'LOW' : 'OK';
            return (
              <div className="table-row" key={row.sku}>
                <span><strong>{row.sku}</strong><small>{row.name}</small></span>
                <span>{row.location}</span>
                <span>{row.onHand}</span>
                <span>{row.reserved}</span>
                <span><Pill tone={signal === 'OK' ? 'good' : signal === 'LOW' ? 'warn' : 'danger'}>{signal}</Pill></span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Ordermentum catalog</h2><span>products + variants + detail order lines</span></div>
        <div className="table-like catalog-table-like">
          <div className="table-head"><span>SKU</span><span>Name</span><span>Source</span><span>Unit</span><span>Base price</span></div>
          {catalog.slice(0, 18).map((row) => (
            <div className="table-row" key={`${row.source}-${row.id}`}>
              <span><strong>{row.sku}</strong><small>{row.category}</small></span>
              <span>{row.name}</span>
              <span><Pill tone={row.source === 'order-detail' ? 'good' : row.source === 'variant' ? 'blue' : 'neutral'}>{sourceLabel(row.source)}</Pill></span>
              <span>{row.unit}</span>
              <span>{money(row.basePrice)}</span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function StoresPanel({ stores, priceGroups }: { stores: StoreProfile[]; priceGroups: PriceGroupRow[] }) {
  const tierCounts = stores.reduce<Record<string, number>>((acc, store) => {
    acc[store.priceTier] = (acc[store.priceTier] || 0) + 1;
    return acc;
  }, {});

  return (
    <section className="workspace-stack">
      <section className="quick-stats tier-stats">
        {priceGroups.map((group) => <MetricCard key={group.id} label={String(group.name).toUpperCase()} value={tierCounts[String(group.name)] || 0} tone={group.default ? 'mint' : 'green'} helper={`${group.retailersTotal} OM retailers`} />)}
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Store and price tier control</h2><span>derived from recent order retailers, linked to Ordermentum price groups</span></div>
        <div className="table-like stores-table">
          <div className="table-head"><span>Store</span><span>Ordermentum ID</span><span>Tier</span><span>Terms</span><span>Statement group</span></div>
          {stores.map((store) => (
            <div className="table-row" key={store.id}>
              <span><strong>{store.name}</strong><small>{store.account} · {store.suburb} · {store.orderCount ?? 0} orders</small></span>
              <span>{store.ordermentumId}</span>
              <span><Pill tone={store.status === 'NEEDS_ADDRESS' ? 'warn' : 'blue'}>{store.priceTier}</Pill></span>
              <span>{store.paymentTerms}</span>
              <span>{store.statementGroup}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Ordermentum price group master</h2><span>active trading tiers</span></div>
        <div className="table-like price-group-table-like">
          <div className="table-head"><span>Group</span><span>Default</span><span>Retailers</span><span>Products</span><span>Action</span></div>
          {priceGroups.map((group) => (
            <div className="table-row" key={group.id}>
              <span><strong>{group.name}</strong><small>{group.id}</small></span>
              <span>{group.default ? 'Yes' : 'No'}</span>
              <span>{group.retailersTotal}</span>
              <span>{group.productsTotal}</span>
              <span><Pill tone="blue">map</Pill></span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function ReconciliationPanel({ orders, summary }: { orders: ImportedOrder[]; summary: EcoFlowDataSet['summary'] }) {
  const open = orders.filter((order) => order.paymentStatus !== 'PAID');
  return (
    <section className="workspace-stack">
      <section className="panel reconciliation-hero">
        <div>
          <span className="section-eyebrow">STATEMENT CONTROL</span>
          <h2>Ordermentum invoice detail is now part of the data model.</h2>
          <p>{summary.detailInvoiceNo} is linked to {summary.detailOrderNo}, {summary.detailRetailerName}, {summary.detailLineCount} line items and {money(summary.invoiceTotal)} invoice value.</p>
        </div>
        <button className="primary-small" type="button">Generate statement preview</button>
      </section>
      <section className="statement-summary">
        <MetricCard label="OPEN INVOICES" value={open.length} tone="gold" />
        <MetricCard label="OPEN VALUE" value={money(open.reduce((sum, order) => sum + order.amount, 0))} tone="blue" />
        <MetricCard label="POD MISSING" value={orders.filter((order) => order.podStatus === 'missing').length} tone="mint" />
        <MetricCard label="SOURCE INVOICE" value={summary.detailInvoiceNo} tone="green" />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Statement and reconciliation</h2><span>order status, payment and POD checks</span></div>
        <div className="table-like">
          <div className="table-head"><span>Invoice</span><span>Customer</span><span>Ordermentum ref</span><span>Status</span><span>POD</span><span>Amount</span></div>
          {orders.map((order) => (
            <div className="table-row" key={order.id}>
              <span><strong>{order.invoiceNo}</strong><small>{order.account}</small></span>
              <span>{order.store}</span>
              <span>{order.orderNo}</span>
              <span><Pill tone={order.paymentStatus === 'PAID' ? 'good' : order.paymentStatus === 'OVERDUE' ? 'danger' : 'warn'}>{order.paymentStatus.replace(/_/g, ' ')}</Pill></span>
              <span>{order.podStatus}</span>
              <span>{money(order.amount)}</span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function LogsPanel({ logs }: { logs: Activity[] }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2>Activity logs</h2><span>audit trail</span></div>
      <div className="list-stack">
        {logs.map((log) => (
          <article className="log-row" key={`${log.at}-${log.detail}`}>
            <b>{log.at}</b>
            <div><strong>{log.actor} · {log.action}</strong><span>{log.detail}</span></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SettingsPanel({ summary, dataQuality }: { summary: EcoFlowDataSet['summary']; dataQuality: DataQualityItem[] }) {
  const blocking = dataQuality.filter((item) => item.severity === 'danger' || item.severity === 'warn').length;
  return (
    <section className="workspace-stack">
      <section className="panel settings-panel">
        <div><h2>Settings</h2><p>Control how Ordermentum intake, release rules, statements and POD requirements are handled.</p></div>
        <label><span>Ordermentum import mode</span><select defaultValue="current"><option value="current">current Ordermentum data</option><option>manual upload</option><option>scheduled API</option></select></label>
        <label><span>Release rule</span><select defaultValue="review"><option>review</option><option>auto-release safe orders</option></select></label>
        <label><span>Statement period</span><select defaultValue="weekly"><option>weekly</option><option>fortnightly</option><option>monthly</option></select></label>
        <label><span>Driver POD required</span><select defaultValue="photo"><option>photo</option><option>signature + photo</option></select></label>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Integration readiness</h2><Pill tone={blocking ? 'warn' : 'good'}>{blocking} blockers / warnings</Pill></div>
        <div className="readiness-grid">
          <div><strong>{summary.recentOrdersCount}</strong><span>recent order headers</span></div>
          <div><strong>{summary.productCatalogTotal}</strong><span>total products reported</span></div>
          <div><strong>{summary.variantCatalogTotal}</strong><span>total variants reported</span></div>
          <div><strong>{summary.priceGroupCount}</strong><span>price groups detected</span></div>
        </div>
      </section>
    </section>
  );
}

function DesktopWorkspace({ role, data, orders, setOrders, stock, stores, logs, onLogout }: {
  role: Role;
  data: EcoFlowDataSet;
  orders: ImportedOrder[];
  setOrders: React.Dispatch<React.SetStateAction<ImportedOrder[]>>;
  stock: StockRow[];
  stores: StoreProfile[];
  logs: Activity[];
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<DesktopTab>('dashboard');
  return (
    <DesktopShell role={role} tab={tab} setTab={setTab} onLogout={onLogout} onUndo={() => undefined}>
      {tab === 'dashboard' ? <HeroDashboard role={role} orders={orders} stock={stock} dataQuality={data.dataQuality} syncBatch={data.syncBatch} bucketCounts={getOrderBucketCounts(orders, data.businessDay.date)} /> : null}
      {tab === 'ordermentum' ? <OrdermentumPanel orders={orders} setOrders={setOrders} data={data} mappingExceptions={data.mappingExceptions} /> : null}
      {tab === 'orders' ? <OrdersPanel orders={orders} setOrders={setOrders} /> : null}
      {tab === 'delivery' ? <DeliveryPanel orders={orders} /> : null}
      {tab === 'inventory' ? <InventoryPanel stock={stock} catalog={data.catalog} summary={data.summary} /> : null}
      {tab === 'stores' ? <StoresPanel stores={stores} priceGroups={data.priceGroups} /> : null}
      {tab === 'reconciliation' ? <ReconciliationPanel orders={orders} summary={data.summary} /> : null}
      {tab === 'logs' ? <LogsPanel logs={logs} /> : null}
      {tab === 'settings' ? <SettingsPanel summary={data.summary} dataQuality={data.dataQuality} /> : null}
    </DesktopShell>
  );
}

function MobileShell({ role, onLogout, children }: { role: Role; onLogout: () => void; children: ReactNode }) {
  return (
    <main className="mobile-shell">
      <header className="mobile-topbar">
        <div><BrandMark /><strong>{roleLabel(role)}</strong></div>
        <button type="button" onClick={onLogout}>Logout</button>
      </header>
      {children}
    </main>
  );
}

function WarehouseWorkspace({ orders, setOrders, stock }: { orders: ImportedOrder[]; setOrders: React.Dispatch<React.SetStateAction<ImportedOrder[]>>; stock: StockRow[] }) {
  const [tab, setTab] = useState<WarehouseTab>('pick');
  const pickable = orders.filter((order) => ['RELEASED', 'PICKING'].includes(order.status));
  const packed = orders.filter((order) => ['PACKED', 'STAGED'].includes(order.status));

  function markPicked(orderId: string) {
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, status: 'PACKED' } : order));
  }

  return (
    <MobileShell role="warehouse" onLogout={() => { window.localStorage.removeItem('ecoflow-role'); window.location.reload(); }}>
      <section className="mobile-content">
        <div className="mobile-title"><h1>Warehouse</h1><p>Receive, pick, pack and stock control.</p></div>
        <nav className="mobile-tabs">
          {(['receive', 'pick', 'pack', 'stock'] as WarehouseTab[]).map((item) => <button key={item} className={cls(tab === item && 'active')} type="button" onClick={() => setTab(item)}>{item}</button>)}
        </nav>
        {tab === 'receive' ? <div className="mobile-card"><h2>Inbound receiving</h2><p>Confirm received stock and put away to mapped locations.</p><button className="primary-button">Scan receiving dock</button></div> : null}
        {tab === 'pick' ? <div className="mobile-stack"><div className="mobile-card"><h2>A / B / C / D pick wave</h2><p>Released orders become A / B / C / D pick waves. Box letter stays visible on each label.</p></div>{pickable.slice(0, 12).map((order, index) => <article className="mobile-card" key={order.id}><strong>{String.fromCharCode(65 + index)} · {order.orderNo}</strong><span>{order.store}</span><span>{order.lines[0].location} · {order.lines[0].sku}</span><button className="primary-button" onClick={() => markPicked(order.id)} type="button">Confirm picked / packed</button></article>)}{!pickable.length ? <div className="empty-state">No released orders.</div> : null}</div> : null}
        {tab === 'pack' ? <div className="mobile-stack">{packed.slice(0, 12).map((order) => <article className="mobile-card" key={order.id}><strong>{order.orderNo}</strong><span>{order.packageCount} labels · {order.store}</span><button className="primary-button" type="button">Print labels</button></article>)}</div> : null}
        {tab === 'stock' ? <div className="mobile-stack">{stock.slice(0, 18).map((row) => <article className="mobile-card" key={row.sku}><strong>{row.sku}</strong><span>{row.location}</span><span>On hand {row.onHand} · reserved {row.reserved}</span></article>)}</div> : null}
      </section>
    </MobileShell>
  );
}

function DriverWorkspace({ orders, setOrders }: { orders: ImportedOrder[]; setOrders: React.Dispatch<React.SetStateAction<ImportedOrder[]>> }) {
  const [tab, setTab] = useState<DriverTab>('run');
  const runOrders = [...orders].sort((a, b) => a.sequence - b.sequence).filter((order) => order.status !== 'CLOSED').slice(0, 12);

  function markDelivered(orderId: string) {
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, status: 'DELIVERED', podStatus: 'captured' } : order));
  }

  return (
    <MobileShell role="driver" onLogout={() => { window.localStorage.removeItem('ecoflow-role'); window.location.reload(); }}>
      <section className="mobile-content">
        <div className="mobile-title"><h1>Driver Run</h1><p>Load, route, POD and issues.</p></div>
        <nav className="mobile-tabs">
          {(['run', 'route', 'pod', 'issues'] as DriverTab[]).map((item) => <button key={item} className={cls(tab === item && 'active')} type="button" onClick={() => setTab(item)}>{item}</button>)}
        </nav>
        {tab === 'run' ? <div className="mobile-stack">{runOrders.map((order) => <article className="mobile-card" key={order.id}><strong>{order.sequence}. {order.store}</strong><span>{order.orderNo} · {order.packageCount} packages</span><span>{order.address}</span><StatusPill status={order.status} /></article>)}</div> : null}
        {tab === 'route' ? <div className="mobile-card"><h2>Navigation</h2><p>{runOrders.length} stops from EcoFlow warehouse. Navigation queue.</p><div className="route-map mobile-route-map">{runOrders.map((order, index) => <div key={order.id} className="map-pin" style={{ left: `${20 + index * 17}%`, top: `${28 + (index % 2) * 22}%` }}>{index + 1}</div>)}</div></div> : null}
        {tab === 'pod' ? <div className="mobile-stack">{runOrders.filter((order) => order.status === 'OUT_FOR_DELIVERY' || order.status === 'PACKED' || order.status === 'STAGED').map((order) => <article className="mobile-card" key={order.id}><strong>{order.store}</strong><span>{order.orderNo}</span><button className="primary-button" type="button" onClick={() => markDelivered(order.id)}>Take POD photo / mark delivered</button></article>)}</div> : null}
        {tab === 'issues' ? <div className="mobile-card"><h2>Delivery issue</h2><p>Record failed delivery, partial delivery, missing contact, or payment dispute.</p><button className="primary-button" type="button">Create issue note</button></div> : null}
      </section>
    </MobileShell>
  );
}

export function App() {
  const [role, setRole] = useState<Role | null>(() => {
    const stored = window.localStorage.getItem('ecoflow-role') as Role | null;
    return stored && roleOptions.some((item) => item.role === stored) ? stored : null;
  });
  const [data, setData] = useState<EcoFlowDataSet>(initialData);
  const [orders, setOrders] = useState<ImportedOrder[]>(initialData.orders);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    loadSupabaseOrdermentumViews()
      .then((views) => {
        if (!active || !views) return;
        const nextData = applySupabaseOrdermentumViews(initialData, views);
        setData(nextData);
        setOrders(nextData.orders);
        setLoadError('');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'Supabase order inbox is unavailable.');
      });
    return () => { active = false; };
  }, []);

  function logout() {
    window.localStorage.removeItem('ecoflow-role');
    setRole(null);
  }

  if (!role) return <LoginScreen onLogin={setRole} />;

  if (role === 'warehouse') return <WarehouseWorkspace orders={orders} setOrders={setOrders} stock={data.stock} />;
  if (role === 'driver') return <DriverWorkspace orders={orders} setOrders={setOrders} />;

  return <DesktopWorkspace role={role} data={data} orders={orders} setOrders={setOrders} stock={data.stock} stores={data.stores} logs={loadError ? [{ at: 'sync', actor: 'Supabase', action: 'Read fallback active', detail: loadError }, ...data.logs] : data.logs} onLogout={logout} />;
}
