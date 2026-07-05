import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { buildEcoFlowData } from '@/domain/ecoflowData';
import { applySupabaseOrdermentumViews, loadSupabaseOrdermentumViews } from '@/data/repositories/supabaseOrdermentumViews';
import { callInternaliseOrders, podAssetUrl } from '@/data/repositories/pickSync';
import { bucketOrders, getOrderBucketCounts, orderBucketDefinitions } from '@/domain/orderBuckets';
import { changeImpactLabel, formatBusinessDate, formatDateTime, sortOrdersForOperations, syncStatusLabel } from '@/domain/syncModel';
import { BrandMark } from './Brand';
import { DriverApp } from './DriverApp';
import { PickBoard } from './PickBoard';
import { applyDayStateToOrders, buildDriverRun, formatClockTime, loadDriverDayState, saveDriverDayState, stopsInLockedOrder } from '@/domain/driverRun';
import type { DriverDayState } from '@/domain/driverRun';
import { usePickSync } from './usePickSync';
import { AuthCallbackScreen } from '@/features/auth/AuthCallbackScreen';
import { EmailLoginScreen } from '@/features/auth/EmailLoginScreen';
import { SetPasswordScreen } from '@/features/auth/SetPasswordScreen';
import type { EcoFlowAppRole, EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { TeamInviteSettingsPanel } from '@/features/settings/TeamInviteSettingsPanel';
import { hasSupabaseAuthClient, supabase } from '@/lib/supabaseClient';
import type {
  Activity,
  CatalogRow,
  DataQualityItem,
  DesktopTab,
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

function roleFromAppRole(appRole: EcoFlowAppRole): Role {
  if (appRole === 'WAREHOUSE') return 'warehouse';
  if (appRole === 'DRIVER') return 'driver';
  if (appRole === 'ACCOUNT') return 'account';
  return 'owner';
}

function canManageTeam(profile?: EcoFlowAuthProfile | null) {
  return profile?.is_active === true && (profile.app_role === 'OWNER' || profile.app_role === 'ADMIN');
}

function appRoleDisplay(profile?: EcoFlowAuthProfile | null) {
  return profile ? `${profile.app_role}${profile.email ? ` · ${profile.email}` : ''}` : 'Legacy local role';
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

function releaseGateTone(status: ImportedOrder['releaseGateStatus']): 'good' | 'warn' | 'danger' | 'neutral' | 'blue' {
  if (status === 'READY_TO_RELEASE') return 'good';
  if (status === 'REVIEW_PAYMENT') return 'warn';
  if (status === 'BLOCKED_DATA' || status === 'BLOCKED_MAPPING' || status === 'BLOCKED_STOCK') return 'danger';
  return 'neutral';
}

function releaseGateLabel(status: ImportedOrder['releaseGateStatus']) {
  return status ? status.replace(/_/g, ' ') : 'RELEASE CHECK';
}

function sourceLabel(source: CatalogRow['source'] | OrderLine['source']) {
  if (source === 'order-detail') return 'order detail';
  if (source === 'variant') return 'variant';
  if (source === 'product') return 'product';
  if (source === 'catalog-sample') return 'catalog';
  return 'fallback';
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

function LoadingScreen({ message = 'Loading secure session…' }: { message?: string }) {
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand-row">
          <BrandMark large />
          <div>
            <div className="login-brand-name">EcoFlow</div>
            <div className="login-brand-subtitle">SECURE ACCESS</div>
          </div>
        </div>
        <h1>{message}</h1>
        <p>Please wait while EcoFlow checks your account and role.</p>
      </section>
    </main>
  );
}

function AccessPendingScreen({ profile, onLogout }: { profile?: EcoFlowAuthProfile | null; onLogout: () => void }) {
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand-row">
          <BrandMark large />
          <div>
            <div className="login-brand-name">EcoFlow</div>
            <div className="login-brand-subtitle">ACCESS REVIEW</div>
          </div>
        </div>
        <h1>Access is not active yet</h1>
        <p>{profile?.email ?? 'This account'} is signed in, but the team profile is missing, suspended, or waiting for approval.</p>
        <button className="primary-button" type="button" onClick={onLogout}>Logout</button>
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
  const tone = status === 'DELIVERED' || status === 'CLOSED' ? 'good' : status === 'MAPPING_EXCEPTION' || status === 'FAILED' ? 'danger' : status === 'OUT_FOR_DELIVERY' || status === 'PACKED' || status === 'STAGED' ? 'blue' : status === 'RELEASE_READY' ? 'warn' : 'neutral';
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
        <div className="order-title-line"><strong>{order.orderNo}</strong><StatusPill status={order.status} /><Pill tone={syncTone(order.syncStatus)}>{syncStatusLabel(order.syncStatus)}</Pill>{order.releaseGateStatus ? <Pill tone={releaseGateTone(order.releaseGateStatus)}>{releaseGateLabel(order.releaseGateStatus)}</Pill> : null}</div>
        <span>{order.store} · {order.suburb} · {order.priceTier}</span>
        <small>{order.lines.map((line) => `${line.sku} × ${line.qty} ${line.unit}`).join(' · ')}</small>
        {order.releaseBlockers ? <small className="release-blockers">{order.releaseBlockers}</small> : null}
      </div>
      <div className="order-side-copy">
        <strong>{money(order.amount)}</strong>
        <small>{order.packageCount} labels · due {formatBusinessDate(order.deliveryDate || order.dueAt)}</small>
      </div>
    </article>
  );
}

function OrdermentumPanel({ orders, setOrders, data, mappingExceptions, day, setDay, onReload }: {
  orders: ImportedOrder[];
  setOrders: React.Dispatch<React.SetStateAction<ImportedOrder[]>>;
  data: EcoFlowDataSet;
  mappingExceptions: MappingException[];
  day: DriverDayState;
  setDay: React.Dispatch<React.SetStateAction<DriverDayState>>;
  onReload: () => Promise<void>;
}) {
  const [bucket, setBucket] = useState<OrderBucketKey>('newToday');
  const [internalising, setInternalising] = useState(false);
  const [internaliseResult, setInternaliseResult] = useState('');
  const bucketCounts = getOrderBucketCounts(orders, data.businessDay.date);
  const bucketRows = sortOrdersForOperations(bucketOrders(orders, bucket, data.businessDay.date));
  const visibleExceptions = mappingExceptions.filter((exception) => {
    const order = orders.find((item) => item.id === exception.orderId);
    return order ? order.status === 'MAPPING_EXCEPTION' || order.openExceptionCount > 0 : true;
  });
  const ready = orders.filter((order) => order.status === 'RELEASE_READY' && order.canCreateInternalOrder !== false && !day.releasedOrders[order.id]);
  const selectedReady = ready.filter((order) => order.selected).length;
  const releasedCount = Object.keys(day.releasedOrders).length;

  // Formal internal-order creation lives in the database RPC — never a front-end status flip.
  async function internaliseEligible() {
    setInternalising(true);
    setInternaliseResult('');
    try {
      const rows = await callInternaliseOrders(50, false);
      const created = rows.filter((row) => row.internal_order_id).length;
      setInternaliseResult(`${created} internal orders created/updated via RPC.`);
      await onReload();
    } catch (error) {
      setInternaliseResult(error instanceof Error ? `RPC failed: ${error.message}` : 'RPC failed.');
    } finally {
      setInternalising(false);
    }
  }

  /** Adds the order to today's shared run — synced to every device through day state. */
  function releaseToRun(orderId: string) {
    setDay((current) => ({ ...current, releasedOrders: { ...current.releasedOrders, [orderId]: new Date().toISOString() } }));
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, selected: false } : order));
  }

  function releaseSelected() {
    const now = new Date().toISOString();
    const ids = ready.filter((order) => order.selected).map((order) => order.id);
    void now;
    setDay((current) => ({
      ...current,
      releasedOrders: { ...current.releasedOrders, ...Object.fromEntries(ids.map((id, index) => [id, new Date(Date.now() + index).toISOString()])) }
    }));
    setOrders((current) => current.map((order) => ids.includes(order.id) ? { ...order, selected: false } : order));
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
        <div className="release-gate-strip">
          <div><strong>{orders.filter((order) => order.releaseGateStatus === 'READY_TO_RELEASE').length}</strong><span>ready to internalise</span></div>
          <div><strong>{orders.filter((order) => order.releaseGateStatus === 'BLOCKED_MAPPING').length}</strong><span>mapping blocked</span></div>
          <div><strong>{releasedCount}</strong><span>in today’s run</span></div>
          <div><strong>{orders.filter((order) => order.releaseGateStatus === 'REVIEW_PAYMENT').length}</strong><span>payment review</span></div>
          <div><strong>{orders.filter((order) => order.releaseGateStatus === 'BLOCKED_DATA').length}</strong><span>data blocked</span></div>
        </div>
        <div className="internalise-row">
          <button className="primary-small" type="button" disabled={internalising} onClick={() => void internaliseEligible()}>
            {internalising ? 'Internalising…' : 'Internalise eligible (RPC)'}
          </button>
          {internaliseResult ? <span className="internalise-result">{internaliseResult}</span> : null}
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
          <div className="table-head"><span>Order</span><span>Store</span><span>Received</span><span>Updated</span><span>Due</span><span>Sync</span><span>Release</span><span>Action</span></div>
          {bucketRows.map((order) => (
            <div className="table-row" key={order.id}>
              <span><strong>{order.orderNo}</strong><small>{order.invoiceNo}</small></span>
              <span><strong>{order.store}</strong><small>{order.priceTier} · {order.suburb}</small></span>
              <span>{formatDateTime(order.firstSeenAt)}<small>{order.firstSeenBusinessDay}</small></span>
              <span>{formatDateTime(order.lastSeenAt)}<small>{order.changeSummary}</small></span>
              <span>{formatBusinessDate(order.deliveryDate || order.dueAt)}<small>{order.requestedDeliveryBusinessDay}</small></span>
              <span><Pill tone={syncTone(order.syncStatus)}>{syncStatusLabel(order.syncStatus)}</Pill></span>
              <span><Pill tone={releaseGateTone(order.releaseGateStatus)}>{releaseGateLabel(order.releaseGateStatus)}</Pill><small>{order.unmappedLineCount ? `${order.unmappedLineCount} unmapped` : order.stockShortageCount ? `${order.stockShortageCount} stock short` : changeImpactLabel(order.changeImpact)}</small></span>
              <span className="row-actions">
                {day.releasedOrders[order.id] ? <Pill tone="good">IN RUN</Pill>
                  : order.status === 'RELEASE_READY' && order.canCreateInternalOrder !== false
                    ? <button className="soft-button" type="button" onClick={() => releaseToRun(order.id)}>Release to run</button>
                    : <StatusPill status={order.status} />}
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
                <small>{exception.detail} Fix the underlying data (mapping / invoice detail) — exceptions clear on the next sync.</small>
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

function OrdersPanel({ orders }: { orders: ImportedOrder[] }) {
  // Read-only: status changes only happen through release, picking and delivery actions.
  return (
    <section className="panel">
      <div className="panel-head"><h2>Order control</h2><span>{orders.length} orders from Ordermentum · status follows the real workflow</span></div>
      <div className="table-like">
        <div className="table-head"><span>Order</span><span>Store</span><span>Tier</span><span>Status</span><span>Value</span><span>POD</span></div>
        {orders.map((order) => (
          <div className="table-row" key={order.id}>
            <span><strong>{order.orderNo}</strong><small>{order.invoiceNo}</small></span>
            <span><strong>{order.store}</strong><small>{order.suburb}</small></span>
            <span>{order.priceTier}</span>
            <span><StatusPill status={order.status} /></span>
            <span>{money(order.amount)}</span>
            <span>{order.podStatus}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function stopStatusLabelDesk(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function DeliveryBoard({ orders, day, businessDay }: { orders: ImportedOrder[]; day: DriverDayState; businessDay: EcoFlowDataSet['businessDay'] }) {
  const run = buildDriverRun(orders, businessDay.date, day.releasedOrders);
  const stops = day.pick ? stopsInLockedOrder(run.stops, day.pick) : run.stops;
  const stagedCount = day.pick ? stops.filter((stop) => day.pick?.stagedStops[stop.orderId]).length : 0;
  const progressFor = (orderId: string) => day.stopProgress[orderId];
  const deliveredCount = stops.filter((stop) => progressFor(stop.orderId)?.status === 'DELIVERED').length;
  const failedCount = stops.filter((stop) => progressFor(stop.orderId)?.status === 'FAILED').length;

  return (
    <section className="workspace-stack">
      <section className="quick-stats">
        <MetricCard label="RELEASED TO RUN" value={stops.length} tone="green" helper={businessDay.label} />
        <MetricCard label="ROUTE" value={day.pick ? `Locked ${formatClockTime(day.pick.lockedAt)}` : 'Not locked'} tone="gold" helper={day.routeStartedAt ? `started ${formatClockTime(day.routeStartedAt)}` : 'driver locks remotely'} />
        <MetricCard label="STAGED" value={`${stagedCount}/${stops.length}`} tone="blue" helper="warehouse progress" />
        <MetricCard label="DELIVERED" value={`${deliveredCount}${failedCount ? ` · ${failedCount} failed` : ''}`} tone="mint" helper={day.routeEndedAt ? `run finished ${formatClockTime(day.routeEndedAt)}` : 'live from driver'} />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Run board</h2><span>shared facts — same data the driver and warehouse see</span></div>
        <div className="list-stack">
          {stops.map((stop) => {
            const progress = progressFor(stop.orderId);
            const staged = day.pick?.stagedStops[stop.orderId];
            const status = progress?.status === 'DELIVERED' ? 'DELIVERED'
              : progress?.status === 'FAILED' ? 'FAILED'
              : progress?.status === 'ARRIVED' ? 'ARRIVED'
              : day.routeStartedAt ? 'ON THE WAY'
              : staged ? 'STAGED'
              : day.pick ? 'PICKING'
              : 'RELEASED';
            const pod = progress?.pod;
            return (
              <article className="stop-row" key={stop.orderId}>
                <b>{stop.stopNumber}</b>
                <div>
                  <strong>{stop.boxCode} · {stop.store}</strong>
                  <span>
                    {stop.cartons} ctn · {stopStatusLabelDesk(status)}
                    {progress?.completedAt ? ` ${formatClockTime(progress.completedAt)}` : ''}
                    {pod?.receiverName ? ` · received by ${pod.receiverName}` : ''}
                  </span>
                  {pod?.photoPath || pod?.signaturePath ? (
                    <span className="pod-links">
                      {pod.photoPath ? <a href={podAssetUrl(pod.photoPath)} target="_blank" rel="noreferrer">POD photo</a> : null}
                      {pod.signaturePath ? <a href={podAssetUrl(pod.signaturePath)} target="_blank" rel="noreferrer">signature</a> : null}
                    </span>
                  ) : pod ? <span className="pod-links">POD captured on driver device</span> : null}
                </div>
                <Pill tone={status === 'DELIVERED' ? 'good' : status === 'FAILED' ? 'danger' : status === 'STAGED' || status === 'ON THE WAY' || status === 'ARRIVED' ? 'blue' : 'neutral'}>{status}</Pill>
              </article>
            );
          })}
          {!stops.length ? <div className="empty-state">No orders released into today’s run yet — release them from the Ordermentum tab.</div> : null}
        </div>
      </section>
    </section>
  );
}

function InventoryPanel({ stock, catalog, summary }: { stock: StockRow[]; catalog: CatalogRow[]; summary: EcoFlowDataSet['summary'] }) {
  return (
    <section className="workspace-stack">
      {!stock.length ? (
        <section className="panel">
          <div className="panel-head"><h2>Stock ledger not connected</h2><Pill tone="warn">NO LIVE STOCK</Pill></div>
          <p className="panel-note">Real stock levels need the inventory ledger (receive / reserve / pick movements). Until then this page will not show fabricated numbers.</p>
        </section>
      ) : null}
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

function SettingsPanel({ summary, dataQuality, authProfile }: { summary: EcoFlowDataSet['summary']; dataQuality: DataQualityItem[]; authProfile?: EcoFlowAuthProfile | null }) {
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
      <section className="panel">
        <div className="panel-head">
          <h2>Secure access</h2>
          <Pill tone={authProfile ? 'good' : 'warn'}>{authProfile ? authProfile.app_role : 'LEGACY'}</Pill>
        </div>
        <div className="readiness-grid">
          <div><strong>{authProfile?.display_name ?? authProfile?.email ?? 'Local fallback'}</strong><span>signed-in user</span></div>
          <div><strong>{appRoleDisplay(authProfile)}</strong><span>application role</span></div>
          <div><strong>{authProfile?.team_status ?? 'legacy passcode'}</strong><span>team status</span></div>
          <div><strong>{authProfile?.is_active ? 'Active' : authProfile ? 'Inactive' : 'Not connected'}</strong><span>access state</span></div>
        </div>
      </section>
      {authProfile && canManageTeam(authProfile) && supabase ? (
        <TeamInviteSettingsPanel supabase={supabase} />
      ) : authProfile ? (
        <section className="panel">
          <div className="panel-head"><h2>Team access</h2><Pill tone="neutral">Owner/Admin only</Pill></div>
          <p>Your account can use EcoFlow, but only OWNER or ADMIN can invite employees or change team roles.</p>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-head"><h2>Team access</h2><Pill tone="warn">Supabase Auth not active</Pill></div>
          <p>The old role/passcode fallback is still running because VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not available to the browser.</p>
        </section>
      )}
    </section>
  );
}

function DesktopWorkspace({ role, data, orders, setOrders, stock, stores, logs, onLogout, loadError, authProfile, onReload }: {
  role: Role;
  data: EcoFlowDataSet;
  orders: ImportedOrder[];
  setOrders: React.Dispatch<React.SetStateAction<ImportedOrder[]>>;
  stock: StockRow[];
  stores: StoreProfile[];
  logs: Activity[];
  onLogout: () => void;
  loadError?: string;
  authProfile?: EcoFlowAuthProfile | null;
  onReload: () => Promise<void>;
}) {
  const [tab, setTab] = useState<DesktopTab>('dashboard');
  const [day, setDay] = useState<DriverDayState>(() => loadDriverDayState(data.businessDay.date));
  useEffect(() => saveDriverDayState(day), [day]);
  usePickSync(data.businessDay.date, day, setDay, authProfile?.display_name || authProfile?.email || 'Office');

  // Shared day facts (release, staging, delivery, POD) projected onto orders for every panel.
  const effectiveOrders = useMemo(() => applyDayStateToOrders(orders, day), [orders, day]);

  return (
    <DesktopShell role={role} tab={tab} setTab={setTab} onLogout={onLogout} onUndo={() => undefined}>
      {loadError ? <div className="sync-error-banner desktop-error-banner">Supabase orders failed to load — the data below is fallback/demo, not live. {loadError}</div> : null}
      {tab === 'dashboard' ? <HeroDashboard role={role} orders={effectiveOrders} stock={stock} dataQuality={data.dataQuality} syncBatch={data.syncBatch} bucketCounts={getOrderBucketCounts(effectiveOrders, data.businessDay.date)} /> : null}
      {tab === 'ordermentum' ? <OrdermentumPanel orders={effectiveOrders} setOrders={setOrders} data={data} mappingExceptions={data.mappingExceptions} day={day} setDay={setDay} onReload={onReload} /> : null}
      {tab === 'orders' ? <OrdersPanel orders={effectiveOrders} /> : null}
      {tab === 'delivery' ? <DeliveryBoard orders={effectiveOrders} day={day} businessDay={data.businessDay} /> : null}
      {tab === 'inventory' ? <InventoryPanel stock={stock} catalog={data.catalog} summary={data.summary} /> : null}
      {tab === 'stores' ? <StoresPanel stores={stores} priceGroups={data.priceGroups} /> : null}
      {tab === 'reconciliation' ? <ReconciliationPanel orders={effectiveOrders} summary={data.summary} /> : null}
      {tab === 'logs' ? <LogsPanel logs={logs} /> : null}
      {tab === 'settings' ? <SettingsPanel summary={data.summary} dataQuality={data.dataQuality} authProfile={authProfile} /> : null}
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

function WarehouseWorkspace({ orders, stock, businessDay, loadError, onLogout, actorLabel }: { orders: ImportedOrder[]; stock: StockRow[]; businessDay: EcoFlowDataSet['businessDay']; loadError?: string; onLogout?: () => void; actorLabel?: string }) {
  const [tab, setTab] = useState<WarehouseTab>('pick');
  const [day, setDay] = useState(() => loadDriverDayState(businessDay.date));
  useEffect(() => saveDriverDayState(day), [day]);
  const syncStatus = usePickSync(businessDay.date, day, setDay, actorLabel || 'Warehouse');

  return (
    <MobileShell role="warehouse" onLogout={onLogout ?? (() => { window.localStorage.removeItem('ecoflow-role'); window.location.reload(); })}>
      <section className="mobile-content">
        {loadError ? <div className="sync-error-banner">Supabase orders failed to load — showing fallback data. {loadError}</div> : null}
        <div className="mobile-title"><h1>Warehouse</h1><p>Receive, pick and stock control.</p></div>
        <nav className="mobile-tabs">
          {(['receive', 'pick', 'stock'] as WarehouseTab[]).map((item) => <button key={item} className={cls(tab === item && 'active')} type="button" onClick={() => setTab(item)}>{item}</button>)}
        </nav>
        {tab === 'receive' ? <div className="mobile-card"><h2>Inbound receiving</h2><p>Confirm received stock and put away to mapped locations.</p><button className="primary-button">Scan receiving dock</button></div> : null}
        {tab === 'pick' ? <PickBoard orders={orders} businessDay={businessDay} day={day} setDay={setDay} syncStatus={syncStatus} /> : null}
        {tab === 'stock' ? <div className="mobile-stack">{stock.slice(0, 18).map((row) => <article className="mobile-card" key={row.sku}><strong>{row.sku}</strong><span>{row.location}</span><span>On hand {row.onHand} · reserved {row.reserved}</span></article>)}</div> : null}
      </section>
    </MobileShell>
  );
}

export function App() {
  const authEnabled = hasSupabaseAuthClient() && Boolean(supabase);
  const [legacyRole, setLegacyRole] = useState<Role | null>(() => {
    if (authEnabled) return null;
    const stored = window.localStorage.getItem('ecoflow-role') as Role | null;
    return stored && roleOptions.some((item) => item.role === stored) ? stored : null;
  });
  const [authChecked, setAuthChecked] = useState(!authEnabled);
  const [authProfile, setAuthProfile] = useState<EcoFlowAuthProfile | null>(null);
  const [authError, setAuthError] = useState('');
  const [data, setData] = useState<EcoFlowDataSet>(initialData);
  const [orders, setOrders] = useState<ImportedOrder[]>(initialData.orders);
  const [loadError, setLoadError] = useState('');

  async function refreshAuthProfile() {
    if (!supabase) return null;
    const { data: currentUser, error } = await supabase
      .from('v_ecoflow_current_user')
      .select('*')
      .maybeSingle();

    if (error) {
      setAuthError(error.message);
      setAuthProfile(null);
      return null;
    }

    const profile = (currentUser ?? null) as EcoFlowAuthProfile | null;
    setAuthProfile(profile);
    setAuthError('');
    return profile;
  }

  useEffect(() => {
    if (!authEnabled || !supabase) return;

    const client = supabase;
    let active = true;

    async function initialiseAuth(authClient: NonNullable<typeof supabase>) {
      const { data: sessionResult, error } = await authClient.auth.getSession();
      if (!active) return;

      if (error) {
        setAuthError(error.message);
        setAuthChecked(true);
        return;
      }

      if (sessionResult.session) {
        await refreshAuthProfile();
      } else {
        setAuthProfile(null);
      }

      if (active) setAuthChecked(true);
    }

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) {
        void refreshAuthProfile().finally(() => setAuthChecked(true));
      } else {
        setAuthProfile(null);
        setAuthChecked(true);
      }
    });

    void initialiseAuth(client);

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [authEnabled]);

  const reloadViews = useCallback(async () => {
    try {
      const views = await loadSupabaseOrdermentumViews();
      if (!views) return;
      const nextData = applySupabaseOrdermentumViews(initialData, views);
      setData(nextData);
      setOrders(nextData.orders);
      setLoadError('');
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'Supabase order inbox is unavailable.');
    }
  }, []);

  useEffect(() => {
    void reloadViews();
  }, [reloadViews, authProfile?.user_id]);

  async function logout() {
    window.localStorage.removeItem('ecoflow-role');
    if (supabase) await supabase.auth.signOut();
    setLegacyRole(null);
    setAuthProfile(null);
  }

  const path = window.location.pathname;
  if (authEnabled && supabase && path === '/auth/callback') return <AuthCallbackScreen supabase={supabase} />;
  if (authEnabled && supabase && path === '/auth/set-password') return <SetPasswordScreen supabase={supabase} />;

  if (!authEnabled) {
    if (!legacyRole) return <LoginScreen onLogin={setLegacyRole} />;
    if (legacyRole === 'warehouse') return <WarehouseWorkspace orders={orders} stock={data.stock} businessDay={data.businessDay} loadError={loadError || undefined} onLogout={logout} />;
    if (legacyRole === 'driver') return <DriverApp orders={orders} setOrders={setOrders} businessDay={data.businessDay} onLogout={logout} loadError={loadError || undefined} />;
    return <DesktopWorkspace role={legacyRole} data={data} orders={orders} setOrders={setOrders} stock={data.stock} stores={data.stores} logs={loadError ? [{ at: 'sync', actor: 'Supabase', action: 'Read fallback active', detail: loadError }, ...data.logs] : data.logs} onLogout={logout} loadError={loadError || undefined} authProfile={null} onReload={reloadViews} />;
  }

  if (!authChecked) return <LoadingScreen />;
  if (!authProfile) return <EmailLoginScreen supabase={supabase!} authError={authError} onSignedIn={() => void refreshAuthProfile()} />;
  if (!authProfile.is_active || authProfile.team_status === 'SUSPENDED' || authProfile.team_status === 'DISABLED') return <AccessPendingScreen profile={authProfile} onLogout={() => void logout()} />;

  const role = roleFromAppRole(authProfile.app_role);
  if (role === 'warehouse') return <WarehouseWorkspace orders={orders} stock={data.stock} businessDay={data.businessDay} loadError={loadError || undefined} onLogout={logout} actorLabel={authProfile.display_name || authProfile.email} />;
  if (role === 'driver') return <DriverApp orders={orders} setOrders={setOrders} businessDay={data.businessDay} onLogout={logout} loadError={loadError || undefined} actorLabel={authProfile.display_name || authProfile.email} />;

  return <DesktopWorkspace role={role} data={data} orders={orders} setOrders={setOrders} stock={data.stock} stores={data.stores} logs={loadError ? [{ at: 'sync', actor: 'Supabase', action: 'Read fallback active', detail: loadError }, ...data.logs] : data.logs} onLogout={logout} loadError={loadError || undefined} authProfile={authProfile} onReload={reloadViews} />;
}
