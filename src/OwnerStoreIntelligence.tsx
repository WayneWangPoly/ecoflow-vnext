import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import { loadDriverIdentity } from '@/data/repositories/driverLocation';
import { updateStoreNotificationContact } from '@/data/repositories/driverDeparture';
import {
  applyStoreOwnerAction,
  loadOwnerStoreExperienceGaps,
  loadOwnerStoreReorderWatch,
  loadOwnerStoreSkuMix,
  loadOwnerStoreStatementSummary,
  type OwnerStoreExperienceGapRow,
  type OwnerStoreReorderWatchRow,
  type OwnerStoreSkuMixRow,
  type OwnerStoreStatementSummaryRow,
  type StoreOwnerAction,
} from '@/data/repositories/storeIntelligence';
import {
  loadCustomerStoreContacts,
  loadCustomerStoreDirectory,
  loadCustomerStoreOrders,
  loadStoreCampaignHistory,
  loadStoreSyncSnapshot,
  projectCurrentOrdermentumStores,
  sendStoreCampaign,
  triggerStoreMasterRefresh,
  type CustomerStoreContactRow,
  type CustomerStoreDirectoryRow,
  type CustomerStoreOrderRow,
  type StoreEmailCampaignRow,
} from '@/data/repositories/customerStoreCenter';

type StoreSort = 'name' | 'revenue' | 'orders' | 'attention' | 'recent' | 'statement';
type StoreSegment = 'all' | 'active' | 'quiet' | 'attention' | 'email_ready' | 'no_email';
type DetailTab = 'overview' | 'orders' | 'analytics' | 'contact';
type StoreDrafts = { priceTier: string; delivery: string; address: string; phone: string };
type ContactDraft = { email: string; name: string; enabled: boolean };
type CampaignTemplate = 'service' | 'new_product' | 'price_update' | 'custom';

const CAMPAIGN_TEMPLATES: Record<CampaignTemplate, { name: string; subject: string; body: string }> = {
  service: {
    name: 'Service update',
    subject: 'An update from EcoFlow Packaging',
    body: 'We are writing to share an important service update with {{store_name}}.\n\nPlease review the information below and contact us with any questions.\n\n[Add service update here]',
  },
  new_product: {
    name: 'New product update',
    subject: 'New packaging options available from EcoFlow Packaging',
    body: 'We have new packaging options available that may suit {{store_name}}.\n\n[Add product names, benefits and availability here]\n\nReply to this email and our team will help with pricing and samples.',
  },
  price_update: {
    name: 'Price update',
    subject: 'EcoFlow Packaging pricing update',
    body: 'We are writing to advise {{store_name}} of an upcoming pricing update.\n\n[Add effective date, affected products and explanation here]\n\nPlease contact us if you would like to review alternatives or your current product mix.',
  },
  custom: { name: 'Custom message', subject: '', body: '' },
};

function num(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown, decimals = 0) {
  return num(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: decimals });
}

function units(value: unknown) {
  return num(value).toLocaleString('en-AU', { maximumFractionDigits: 0 });
}

function dateText(value?: string | null, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

function title(value: string | null | undefined) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function signalTone(signal?: string | null): 'good' | 'warn' | 'blue' | 'neutral' {
  if (signal === 'ACTIVE' || signal === 'READY' || signal === 'CLEAR') return 'good';
  if (signal?.includes('NEEDS') || signal?.includes('MISSING') || signal?.includes('OVERDUE') || signal?.includes('HIGH')) return 'warn';
  if (signal === 'QUIET' || signal?.includes('WATCH') || signal?.includes('OPEN')) return 'blue';
  return 'neutral';
}

function StorePill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'blue' | 'neutral' }) {
  return <span className={`owner-store-pill owner-store-pill-${tone}`}>{children}</span>;
}

function Metric({ label, value, helper, tone = 'neutral' }: { label: string; value: string | number; helper: string; tone?: 'good' | 'warn' | 'blue' | 'neutral' }) {
  return <article className={`owner-store-metric owner-store-metric-${tone}`}><strong>{value}</strong><span>{label}</span><small>{helper}</small></article>;
}

function useStoresHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    function locate() {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((node) => node.textContent?.trim() === 'Store master');
      const panel = heading?.closest<HTMLElement>('.panel');
      if (!panel) { setHost(null); return; }
      panel.classList.add('stores-native-master-panel-soft-hide');
      let mount = document.querySelector<HTMLElement>('.owner-store-intelligence-mount');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'owner-store-intelligence-mount';
        panel.insertAdjacentElement('beforebegin', mount);
      }
      setHost(mount);
    }
    return observeBody(locate);
  }, []);
  return host;
}

function StoreActionPanel({ drafts, setDrafts, busyAction, onAction, statement, editable }: {
  drafts: StoreDrafts;
  setDrafts: (drafts: StoreDrafts) => void;
  busyAction: string;
  onAction: (action: StoreOwnerAction, value?: string, note?: string) => void;
  statement?: OwnerStoreStatementSummaryRow;
  editable: boolean;
}) {
  if (!editable) return <div className="owner-store-readonly-note">Owner/Admin access is required to change store master data.</div>;
  const set = (key: keyof StoreDrafts, value: string) => setDrafts({ ...drafts, [key]: value });
  const busy = (action: StoreOwnerAction) => busyAction === action;
  return (
    <section className="owner-store-action-panel">
      <header><h4>Store master actions</h4><StorePill tone="blue">Owner editable</StorePill></header>
      <div className="owner-store-action-row"><input value={drafts.priceTier} onChange={(event) => set('priceTier', event.target.value)} placeholder="Price tier / price group ID" /><button type="button" disabled={busy('SET_PRICE_TIER')} onClick={() => onAction('SET_PRICE_TIER', drafts.priceTier, 'Owner updated store price tier')}>{busy('SET_PRICE_TIER') ? 'Saving…' : 'Set price tier'}</button></div>
      <div className="owner-store-action-row"><input value={drafts.delivery} onChange={(event) => set('delivery', event.target.value)} placeholder="Delivery instructions" /><button type="button" disabled={busy('SET_DELIVERY_INSTRUCTIONS')} onClick={() => onAction('SET_DELIVERY_INSTRUCTIONS', drafts.delivery, 'Owner updated delivery instructions')}>{busy('SET_DELIVERY_INSTRUCTIONS') ? 'Saving…' : 'Save delivery'}</button></div>
      <div className="owner-store-action-row"><input value={drafts.address} onChange={(event) => set('address', event.target.value)} placeholder="Formatted delivery address" /><button type="button" disabled={busy('SET_ADDRESS')} onClick={() => onAction('SET_ADDRESS', drafts.address, 'Owner updated store address')}>{busy('SET_ADDRESS') ? 'Saving…' : 'Save address'}</button></div>
      <div className="owner-store-action-row"><input value={drafts.phone} onChange={(event) => set('phone', event.target.value)} placeholder="Contact phone" /><button type="button" disabled={busy('SET_CONTACT_PHONE')} onClick={() => onAction('SET_CONTACT_PHONE', drafts.phone, 'Owner updated contact phone')}>{busy('SET_CONTACT_PHONE') ? 'Saving…' : 'Save phone'}</button></div>
      <div className="owner-store-action-buttons"><button type="button" disabled={busy('MARK_VERIFIED')} onClick={() => onAction('MARK_VERIFIED', undefined, 'Owner verified store data')}>{busy('MARK_VERIFIED') ? 'Saving…' : 'Mark verified'}</button><button type="button" disabled={busy('ACK_STATEMENT_REVIEW')} onClick={() => onAction('ACK_STATEMENT_REVIEW', undefined, `Statement reviewed: ${money(statement?.open_statement_value)} open`)}>{busy('ACK_STATEMENT_REVIEW') ? 'Saving…' : 'Acknowledge statement'}</button></div>
    </section>
  );
}

function StoreRow({ row, statement, contact, checked, selectable, selected, onCheck, onSelect }: {
  row: CustomerStoreDirectoryRow;
  statement?: OwnerStoreStatementSummaryRow;
  contact?: CustomerStoreContactRow;
  checked: boolean;
  selectable: boolean;
  selected: boolean;
  onCheck: () => void;
  onSelect: () => void;
}) {
  return (
    <article className={`owner-store-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      {selectable ? <input type="checkbox" checked={checked} aria-label={`Select ${row.store_name}`} onClick={(event) => event.stopPropagation()} onChange={onCheck} /> : <span className="owner-store-rank">#{units(row.revenue_rank_30d)}</span>}
      <div className="owner-store-main"><strong>{row.store_name || 'Unknown store'}</strong><span>{row.suburb || 'Suburb pending'} · {row.address || 'Address pending'}</span><small>{row.delivery_instructions || 'No delivery instructions captured'}</small></div>
      <div><strong>{money(row.revenue_30d)}</strong><span>30d value</span></div>
      <div><strong>{units(row.lifetime_orders)}</strong><span>lifetime orders</span></div>
      <div><strong>{money(statement?.open_statement_value)}</strong><span>statement</span></div>
      <div className="owner-store-row-signals"><StorePill tone={signalTone(statement?.statement_signal || row.store_signal)}>{title(statement?.statement_signal || row.store_signal)}</StorePill><small>{contact?.contact_email ? 'email ready' : 'email missing'}</small></div>
    </article>
  );
}

function StoreOrders({ orders, loading }: { orders: CustomerStoreOrderRow[]; loading: boolean }) {
  if (loading) return <div className="owner-store-empty">Loading order history…</div>;
  if (!orders.length) return <div className="owner-store-empty">No historical orders have been linked to this store yet.</div>;
  return (
    <div className="customer-order-history">
      {orders.map((order) => (
        <article key={order.internal_order_id}>
          <div><strong>{order.order_number || order.external_order_id || order.internal_order_id}</strong><span>{dateText(order.order_at, true)}</span></div>
          <div><strong>{money(order.order_value, 2)}</strong><span>{title(order.status)}</span></div>
          <div><strong>{order.invoice_number || '—'}</strong><span>invoice</span></div>
          <div><strong>{order.delivery_date ? dateText(order.delivery_date) : '—'}</strong><span>delivery</span></div>
        </article>
      ))}
    </div>
  );
}

function StoreAnalytics({ store, orders, mix }: { store: CustomerStoreDirectoryRow; orders: CustomerStoreOrderRow[]; mix: OwnerStoreSkuMixRow[] }) {
  const monthly = useMemo(() => {
    const totals = new Map<string, { value: number; count: number }>();
    orders.forEach((order) => {
      if (!order.order_at) return;
      const date = new Date(order.order_at);
      if (Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const current = totals.get(key) ?? { value: 0, count: 0 };
      current.value += num(order.order_value);
      current.count += 1;
      totals.set(key, current);
    });
    return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-12);
  }, [orders]);
  const maxValue = Math.max(1, ...monthly.map(([, value]) => value.value));
  return (
    <div className="customer-analytics-stack">
      <section className="customer-analytics-summary"><Metric label="Lifetime orders" value={units(store.lifetime_orders)} helper={`First order ${dateText(store.first_order_at)}`} tone="blue" /><Metric label="30d revenue" value={money(store.revenue_30d)} helper={`${units(store.orders_30d)} recent orders`} tone="good" /><Metric label="30d units" value={units(store.units_30d)} helper={`${units(store.sku_count_30d)} distinct SKUs`} /><Metric label="Top product" value={store.top_sku_30d || '—'} helper={`${units(store.top_sku_units_30d)} units`} tone="good" /></section>
      <section className="customer-monthly-chart"><h4>Historical order value</h4>{monthly.length ? monthly.map(([month, value]) => <div key={month}><span>{month}</span><i style={{ width: `${Math.max(3, Math.round((value.value / maxValue) * 100))}%` }} /><strong>{money(value.value)} · {value.count} orders</strong></div>) : <div className="owner-store-empty">Order history will build this trend as orders are linked.</div>}</section>
      <section><h4>Recent product mix</h4><div className="owner-store-sku-list">{mix.slice(0, 20).map((row) => <article className="owner-store-sku-row" key={`${row.store_id}-${row.sku}`}><div><strong>{row.sku || 'UNKNOWN'}</strong><span>{row.product_name || 'Unknown product'}</span></div><span>{units(row.order_count_30d)} orders</span><span>{units(row.units_30d)} units</span><strong>{money(row.revenue_30d)}</strong></article>)}{!mix.length ? <div className="owner-store-empty">No product movement in the last 30 days.</div> : null}</div></section>
    </div>
  );
}

function StoreContact({ store, contact, editable, onSaved }: { store: CustomerStoreDirectoryRow; contact?: CustomerStoreContactRow; editable: boolean; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<ContactDraft>({ email: '', name: '', enabled: true });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => setDraft({ email: contact?.contact_email || '', name: contact?.contact_name || '', enabled: contact?.enabled !== false }), [store.store_id, contact?.updated_at]);

  async function save() {
    if (!editable) return;
    setBusy(true); setNotice('');
    try {
      await updateStoreNotificationContact({ storeKey: store.store_id, storeName: store.store_name, retailerId: store.store_id, email: draft.email, contactName: draft.name, enabled: draft.enabled });
      setNotice('Customer email contact saved.');
      await onSaved();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return (
    <section className="customer-contact-card">
      <div><h4>Customer communication contact</h4><p>This address is used for delivery notices and owner-approved customer campaigns. Drivers never see it.</p></div>
      <label><span>Email</span><input type="email" disabled={!editable} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="orders@store.com.au" /></label>
      <label><span>Contact name</span><input disabled={!editable} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Store manager or accounts contact" /></label>
      <label className="customer-contact-toggle"><input type="checkbox" disabled={!editable} checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span>Enable operational notices and campaigns</span></label>
      {notice ? <div className="owner-store-notice">{notice}</div> : null}
      {editable ? <button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save customer contact'}</button> : <div className="owner-store-readonly-note">Owner/Admin access is required to edit customer contacts.</div>}
    </section>
  );
}

function StoreDetail({ store, statement, mix, orders, ordersLoading, tab, setTab, drafts, setDrafts, busyAction, onAction, editable, contact, onContactSaved }: {
  store?: CustomerStoreDirectoryRow;
  statement?: OwnerStoreStatementSummaryRow;
  mix: OwnerStoreSkuMixRow[];
  orders: CustomerStoreOrderRow[];
  ordersLoading: boolean;
  tab: DetailTab;
  setTab: (tab: DetailTab) => void;
  drafts: StoreDrafts;
  setDrafts: (drafts: StoreDrafts) => void;
  busyAction: string;
  onAction: (action: StoreOwnerAction, value?: string, note?: string) => void;
  editable: boolean;
  contact?: CustomerStoreContactRow;
  onContactSaved: () => Promise<void>;
}) {
  if (!store) return <div className="owner-store-empty">Select a customer to see order history, analytics and communication settings.</div>;
  return (
    <section className="owner-store-detail">
      <div className="owner-store-detail-hero"><div><span>CUSTOMER ACCOUNT</span><h3>{store.store_name}</h3><p>{store.address || 'Address pending'} · {store.contact_phone || 'phone pending'}</p></div><StorePill tone={signalTone(statement?.statement_signal || store.store_signal)}>{title(statement?.statement_signal || store.store_signal)}</StorePill></div>
      <nav className="customer-detail-tabs">{(['overview', 'orders', 'analytics', 'contact'] as DetailTab[]).map((item) => <button type="button" key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item === 'orders' ? `Orders (${units(store.lifetime_orders)})` : item === 'contact' ? 'Contact & email' : item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
      {tab === 'overview' ? <>
        <div className="owner-store-detail-grid"><div><strong>{money(store.revenue_30d)}</strong><span>30d revenue</span></div><div><strong>{units(store.orders_30d)}</strong><span>30d orders</span></div><div><strong>{money(statement?.open_statement_value)}</strong><span>open statement</span></div><div><strong>{dateText(store.last_order_at)}</strong><span>last order</span></div></div>
        <div className="owner-store-notes"><p><strong>Price tier:</strong> {store.price_group_id || 'needs price tier'}</p><p><strong>Delivery:</strong> {store.delivery_instructions || 'needs delivery instructions'}</p><p><strong>Statement:</strong> {title(statement?.statement_signal)} · overdue {money(statement?.overdue_statement_value)} · {units(statement?.overdue_invoice_count)} overdue invoices</p><p><strong>Top SKU:</strong> {store.top_sku_30d} · {store.top_product_30d} · {units(store.top_sku_units_30d)} units</p><p><strong>Source:</strong> {store.source || 'unknown'} · last store update {dateText(store.site_updated_at, true)}</p></div>
        <StoreActionPanel drafts={drafts} setDrafts={setDrafts} busyAction={busyAction} onAction={onAction} statement={statement} editable={editable} />
      </> : null}
      {tab === 'orders' ? <StoreOrders orders={orders} loading={ordersLoading} /> : null}
      {tab === 'analytics' ? <StoreAnalytics store={store} orders={orders} mix={mix} /> : null}
      {tab === 'contact' ? <StoreContact store={store} contact={contact} editable={editable} onSaved={onContactSaved} /> : null}
    </section>
  );
}

function CampaignWorkbench({ stores, contacts, selectedIds, setSelectedIds, editable, history, onReload }: {
  stores: CustomerStoreDirectoryRow[];
  contacts: CustomerStoreContactRow[];
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  editable: boolean;
  history: StoreEmailCampaignRow[];
  onReload: () => Promise<void>;
}) {
  const [template, setTemplate] = useState<CampaignTemplate>('service');
  const [campaignName, setCampaignName] = useState(CAMPAIGN_TEMPLATES.service.name);
  const [subject, setSubject] = useState(CAMPAIGN_TEMPLATES.service.subject);
  const [body, setBody] = useState(CAMPAIGN_TEMPLATES.service.body);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const contactByStore = useMemo(() => new Map(contacts.filter((row) => row.retailer_id).map((row) => [String(row.retailer_id), row])), [contacts]);
  const selectedStores = stores.filter((store) => selectedIds.has(store.store_id));
  const emailReady = selectedStores.filter((store) => {
    const contact = contactByStore.get(store.store_id);
    return contact?.enabled !== false && Boolean(contact?.contact_email);
  }).length;

  function applyTemplate(next: CampaignTemplate) {
    const value = CAMPAIGN_TEMPLATES[next];
    setTemplate(next); setCampaignName(value.name); setSubject(value.subject); setBody(value.body);
  }

  async function send() {
    if (!editable || !selectedIds.size || !subject.trim() || !body.trim()) return;
    const confirmed = window.confirm(`Send this message separately to ${emailReady} email-ready customer${emailReady === 1 ? '' : 's'}? Missing or disabled contacts will be logged and skipped.`);
    if (!confirmed) return;
    setBusy(true); setNotice('');
    try {
      const result = await sendStoreCampaign({ storeIds: [...selectedIds], campaignName, subject, bodyText: body });
      setNotice(`${result.status}: ${result.sent} sent, ${result.missingContact} missing contact, ${result.disabled} disabled, ${result.failed} failed.`);
      await onReload();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return (
    <section className="customer-campaign-workbench">
      <header><div><span>CUSTOMER COMMUNICATIONS</span><h3>Bulk email with store-level privacy</h3><p>Select customers in the directory, choose a template, review the content and send one separate email per store.</p></div><StorePill tone={selectedIds.size ? 'blue' : 'neutral'}>{selectedIds.size} selected · {emailReady} email ready</StorePill></header>
      <div className="customer-campaign-grid">
        <section className="customer-campaign-composer">
          <label><span>Template</span><select value={template} onChange={(event) => applyTemplate(event.target.value as CampaignTemplate)}><option value="service">Service update</option><option value="new_product">New product</option><option value="price_update">Price update</option><option value="custom">Custom</option></select></label>
          <label><span>Campaign name</span><input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} /></label>
          <label><span>Subject</span><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Email subject" /></label>
          <label><span>Message</span><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={9} placeholder="Write the customer message. Use {{store_name}} and {{contact_name}} for personalisation." /></label>
          <div className="customer-campaign-actions"><button type="button" onClick={() => setSelectedIds(new Set())}>Clear selection</button><button className="primary" type="button" disabled={!editable || busy || !selectedIds.size || !emailReady} onClick={() => void send()}>{busy ? 'Sending…' : `Send to ${emailReady} stores`}</button></div>
          {!editable ? <div className="owner-store-readonly-note">Only Owner/Admin can send customer campaigns. Accounts can review campaign history.</div> : null}
          {notice ? <div className="owner-store-notice">{notice}</div> : null}
        </section>
        <section className="customer-campaign-preview"><span>PREVIEW</span><h4>{subject || 'Subject preview'}</h4><p>Hi {selectedStores[0]?.store_name || '{{contact_name}}'},</p><div>{body || 'Message preview'}</div><p>Kind regards,<br />EcoFlow Packaging</p></section>
      </div>
      <section className="customer-campaign-history"><h4>Campaign history</h4>{history.length ? history.map((row) => <article key={row.id}><div><strong>{row.campaign_name}</strong><span>{row.subject}</span></div><StorePill tone={row.status === 'COMPLETED' ? 'good' : row.status === 'PARTIAL' ? 'warn' : 'neutral'}>{row.status}</StorePill><span>{row.sent_count}/{row.selected_store_count} sent</span><small>{dateText(row.created_at, true)}</small></article>) : <div className="owner-store-empty">No customer campaigns have been sent yet.</div>}</section>
    </section>
  );
}

function StoreContent() {
  const [role, setRole] = useState('');
  const [stores, setStores] = useState<CustomerStoreDirectoryRow[]>([]);
  const [mix, setMix] = useState<OwnerStoreSkuMixRow[]>([]);
  const [statements, setStatements] = useState<OwnerStoreStatementSummaryRow[]>([]);
  const [reorder, setReorder] = useState<OwnerStoreReorderWatchRow[]>([]);
  const [gaps, setGaps] = useState<OwnerStoreExperienceGapRow[]>([]);
  const [contacts, setContacts] = useState<CustomerStoreContactRow[]>([]);
  const [campaigns, setCampaigns] = useState<StoreEmailCampaignRow[]>([]);
  const [orders, setOrders] = useState<CustomerStoreOrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StoreSort>('revenue');
  const [segment, setSegment] = useState<StoreSegment>('all');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<DetailTab>('overview');
  const [drafts, setDrafts] = useState<StoreDrafts>({ priceTier: '', delivery: '', address: '', phone: '' });
  const [busyAction, setBusyAction] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  const editable = role === 'OWNER' || role === 'ADMIN';

  const reloadContactsAndCampaigns = useCallback(async () => {
    if (!editable) {
      try { setCampaigns(await loadStoreCampaignHistory()); } catch { setCampaigns([]); }
      return;
    }
    const [contactResult, campaignResult] = await Promise.allSettled([loadCustomerStoreContacts(), loadStoreCampaignHistory()]);
    setContacts(contactResult.status === 'fulfilled' ? contactResult.value : []);
    setCampaigns(campaignResult.status === 'fulfilled' ? campaignResult.value : []);
  }, [editable]);

  const reload = useCallback(async () => {
    setError('');
    try {
      const [directoryResult, mixResult, statementResult, reorderResult, gapResult] = await Promise.allSettled([
        loadCustomerStoreDirectory(),
        loadOwnerStoreSkuMix(),
        loadOwnerStoreStatementSummary(),
        loadOwnerStoreReorderWatch(),
        loadOwnerStoreExperienceGaps(),
      ]);
      if (directoryResult.status === 'rejected') throw directoryResult.reason;
      const nextStores = directoryResult.value;
      setStores(nextStores);
      setMix(mixResult.status === 'fulfilled' ? mixResult.value : []);
      setStatements(statementResult.status === 'fulfilled' ? statementResult.value : []);
      setReorder(reorderResult.status === 'fulfilled' ? reorderResult.value : []);
      setGaps(gapResult.status === 'fulfilled' ? gapResult.value : []);
      setSelectedStoreId((current) => current && nextStores.some((store) => store.store_id === current) ? current : nextStores[0]?.store_id || '');
      setLoadedAt(new Date().toISOString());
      await reloadContactsAndCampaigns();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [reloadContactsAndCampaigns]);

  useEffect(() => {
    let active = true;
    loadDriverIdentity().then((profile) => {
      if (active) setRole(profile?.app_role || '');
    }).catch(() => {
      if (active) setRole(window.localStorage.getItem('ecoflow-role') === 'owner' ? 'OWNER' : 'ACCOUNT');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => { if (role) void reload(); }, [role, reload]);

  const statementByStore = useMemo(() => new Map(statements.map((row) => [String(row.store_id), row])), [statements]);
  const contactByStore = useMemo(() => new Map(contacts.filter((row) => row.retailer_id).map((row) => [String(row.retailer_id), row])), [contacts]);

  const visibleStores = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let filtered = stores.filter((store) => {
      const contact = contactByStore.get(store.store_id);
      if (segment === 'active' && num(store.orders_30d) <= 0) return false;
      if (segment === 'quiet' && num(store.orders_30d) > 0) return false;
      if (segment === 'attention' && signalTone(store.store_signal) !== 'warn') return false;
      if (segment === 'email_ready' && (!contact?.contact_email || contact.enabled === false)) return false;
      if (segment === 'no_email' && contact?.contact_email) return false;
      if (!needle) return true;
      return [store.store_name, store.address, store.suburb, store.price_group_id, store.store_signal, store.top_sku_30d, store.top_product_30d, contact?.contact_email, statementByStore.get(store.store_id)?.statement_signal].filter(Boolean).join(' ').toLowerCase().includes(needle);
    });
    filtered = [...filtered].sort((a, b) => {
      if (sort === 'name') return a.store_name.localeCompare(b.store_name);
      if (sort === 'orders') return num(b.lifetime_orders) - num(a.lifetime_orders);
      if (sort === 'statement') return num(statementByStore.get(b.store_id)?.open_statement_value) - num(statementByStore.get(a.store_id)?.open_statement_value);
      if (sort === 'attention') return Number(signalTone(b.store_signal) === 'warn') - Number(signalTone(a.store_signal) === 'warn') || num(b.revenue_30d) - num(a.revenue_30d);
      if (sort === 'recent') return new Date(b.last_order_at || 0).getTime() - new Date(a.last_order_at || 0).getTime();
      return num(b.revenue_30d) - num(a.revenue_30d);
    });
    return filtered;
  }, [stores, query, segment, sort, contactByStore, statementByStore]);

  const selectedStore = stores.find((store) => store.store_id === selectedStoreId) || visibleStores[0];
  const selectedMix = mix.filter((row) => String(row.store_id) === selectedStore?.store_id);
  const selectedStatement = statementByStore.get(selectedStore?.store_id || '');
  const selectedContact = contactByStore.get(selectedStore?.store_id || '');

  useEffect(() => {
    setDrafts({ priceTier: selectedStore?.price_group_id || '', delivery: selectedStore?.delivery_instructions || '', address: selectedStore?.address || '', phone: selectedStore?.contact_phone || '' });
    setTab('overview');
  }, [selectedStore?.store_id]);

  useEffect(() => {
    if (!selectedStore?.store_id) { setOrders([]); return; }
    let active = true;
    setOrdersLoading(true);
    loadCustomerStoreOrders(selectedStore.store_id)
      .then((rows) => { if (active) setOrders(rows); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (active) setOrdersLoading(false); });
    return () => { active = false; };
  }, [selectedStore?.store_id]);

  async function runStoreAction(action: StoreOwnerAction, value?: string, note?: string) {
    if (!editable || !selectedStore?.store_id) return;
    setBusyAction(action); setError(''); setNotice('');
    try {
      const result = await applyStoreOwnerAction({ storeId: selectedStore.store_id, action, value, note });
      const first = result[0];
      if (first?.error_message) setError(first.error_message);
      else setNotice(`${selectedStore.store_name}: ${title(first?.execution_status || 'UPDATED')}.`);
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusyAction(''); }
  }

  async function importCurrentMaster() {
    if (!editable) return;
    setSyncBusy(true); setError(''); setNotice('Projecting all purchaser records already synced from Ordermentum…');
    try {
      const result = await projectCurrentOrdermentumStores();
      await reload();
      setNotice(`${units(result?.projected_count)} stores updated from ${units(result?.source_count)} Ordermentum purchaser records.`);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSyncBusy(false); }
  }

  async function refreshFromOrdermentum() {
    if (!editable) return;
    setSyncBusy(true); setError(''); setNotice('Starting Ordermentum store and price-tier refresh…');
    const requestedAt = Date.now();
    try {
      await triggerStoreMasterRefresh();
      setNotice('Store refresh queued. EcoFlow is waiting for the new purchaser master…');
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        const snapshot = await loadStoreSyncSnapshot();
        const purchaser = snapshot.masterHealth.find((row) => String(row.resource_type || '').toLowerCase().includes('purchaser'));
        const latest = purchaser?.latest_synced_at ? new Date(purchaser.latest_synced_at).getTime() : 0;
        if (latest >= requestedAt - 2000) {
          const projected = await projectCurrentOrdermentumStores();
          await reload();
          setNotice(`Ordermentum refresh complete. ${units(projected?.projected_count)} customer stores projected into EcoFlow.`);
          return;
        }
      }
      setNotice('Ordermentum refresh is still running in the cloud. Use “Import latest synced stores” after the workflow completes.');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setSyncBusy(false); }
  }

  const latest = loadedAt ? dateText(loadedAt, true) : 'loading';
  const activeCount = stores.filter((store) => num(store.orders_30d) > 0).length;
  const attention = stores.filter((store) => signalTone(store.store_signal) === 'warn').length + gaps.length;
  const revenue30d = stores.reduce((sum, store) => sum + num(store.revenue_30d), 0);
  const openStatement = statements.reduce((sum, row) => sum + num(row.open_statement_value), 0);
  const emailReadyCount = stores.filter((store) => {
    const contact = contactByStore.get(store.store_id);
    return Boolean(contact?.contact_email) && contact?.enabled !== false;
  }).length;

  function toggleSelected(storeId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(storeId)) next.delete(storeId); else next.add(storeId);
      return next;
    });
  }

  function selectVisible() {
    setSelectedIds(new Set(visibleStores.map((store) => store.store_id)));
  }

  return (
    <section className="owner-store-shell">
      <section className="owner-store-hero">
        <div><span>CUSTOMER STORE CENTRE</span><h2>Every customer, their value, their history and the next action.</h2><p>The directory starts from the full Ordermentum purchaser master—not only stores that ordered recently.</p></div>
        <div className="owner-store-actions">
          <button type="button" onClick={() => void reload()}>Refresh view</button>
          {editable ? <button className="primary" type="button" disabled={syncBusy} onClick={() => void refreshFromOrdermentum()}>{syncBusy ? 'Refreshing…' : 'Refresh stores from Ordermentum'}</button> : null}
          {editable ? <button type="button" disabled={syncBusy} onClick={() => void importCurrentMaster()}>Import latest synced stores</button> : null}
          <small>{stores.length} stores · loaded {latest}</small>
        </div>
      </section>
      {error ? <div className="owner-store-error">{error}</div> : null}
      {notice ? <div className="owner-store-notice">{notice}</div> : null}
      <section className="owner-store-metrics"><Metric label="All customer stores" value={units(stores.length)} helper={`${activeCount} ordered in 30 days`} tone="good" /><Metric label="30d store revenue" value={money(revenue30d)} helper={`${units(stores.reduce((sum, store) => sum + num(store.orders_30d), 0))} orders`} tone="good" /><Metric label="Email ready" value={units(emailReadyCount)} helper={`${stores.length - emailReadyCount} need contact setup`} tone={emailReadyCount === stores.length ? 'good' : 'blue'} /><Metric label="Customer attention" value={units(attention)} helper={`${money(openStatement)} open statements`} tone={attention ? 'warn' : 'good'} /></section>
      <section className="owner-store-controlbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search store, suburb, SKU, price tier, email or statement…" />
        <select value={segment} onChange={(event) => setSegment(event.target.value as StoreSegment)}><option value="all">All stores</option><option value="active">Active in 30 days</option><option value="quiet">Quiet / no recent order</option><option value="attention">Needs data attention</option><option value="email_ready">Email ready</option><option value="no_email">Missing email</option></select>
        <select value={sort} onChange={(event) => setSort(event.target.value as StoreSort)}><option value="revenue">Sort by 30d revenue</option><option value="name">Sort by name</option><option value="orders">Sort by lifetime orders</option><option value="statement">Sort by statement</option><option value="attention">Data attention first</option><option value="recent">Most recent order</option></select>
        {editable ? <button type="button" onClick={selectVisible}>Select visible ({visibleStores.length})</button> : null}
      </section>
      <section className="owner-store-grid">
        <section className="owner-store-panel customer-directory-panel"><header><div><h3>Customer directory</h3><p>Showing every matching store in the EcoFlow store master.</p></div><StorePill tone="blue">{visibleStores.length} of {stores.length}</StorePill></header><div className="owner-store-list">{visibleStores.map((store) => <StoreRow key={store.store_id} row={store} statement={statementByStore.get(store.store_id)} contact={contactByStore.get(store.store_id)} checked={selectedIds.has(store.store_id)} selectable={editable} selected={selectedStore?.store_id === store.store_id} onCheck={() => toggleSelected(store.store_id)} onSelect={() => setSelectedStoreId(store.store_id)} />)}{!visibleStores.length ? <div className="owner-store-empty">No store matches this filter.</div> : null}</div></section>
        <StoreDetail store={selectedStore} statement={selectedStatement} mix={selectedMix} orders={orders} ordersLoading={ordersLoading} tab={tab} setTab={setTab} drafts={drafts} setDrafts={setDrafts} busyAction={busyAction} onAction={runStoreAction} editable={editable} contact={selectedContact} onContactSaved={reloadContactsAndCampaigns} />
      </section>
      <section className="owner-store-bottom-grid"><section className="owner-store-panel"><header><div><h3>Reorder pressure</h3><p>Customer/SKU pairs with repeat demand.</p></div><StorePill tone={reorder.length ? 'warn' : 'good'}>{reorder.length}</StorePill></header><div className="owner-store-sku-list">{reorder.slice(0, 20).map((row: OwnerStoreReorderWatchRow) => <article className="owner-store-pressure-row" key={`${row.store_id}-${row.sku}`}><div><strong>{row.store_name}</strong><span>{row.sku} · {row.product_name}</span></div><span>{units(row.units_30d)} units</span><strong>{money(row.revenue_30d)}</strong><StorePill tone={signalTone(row.reorder_signal)}>{title(row.reorder_signal)}</StorePill></article>)}{!reorder.length ? <div className="owner-store-empty">No reorder pressure yet.</div> : null}</div></section><section className="owner-store-panel"><header><div><h3>Owner customer action list</h3><p>Address, tier, verification and statement gaps.</p></div><StorePill tone={gaps.length ? 'warn' : 'good'}>{gaps.length}</StorePill></header><div className="owner-store-sku-list">{gaps.slice(0, 20).map((row: OwnerStoreExperienceGapRow) => <article className="owner-store-gap-row" key={`${row.store_id}-${row.owner_action}`}><div><strong>{row.store_name}</strong><span>{row.suburb || 'Suburb pending'} · {money(row.revenue_30d)}</span></div><StorePill tone={signalTone(row.owner_action)}>{title(row.owner_action)}</StorePill><small>{title(row.store_signal)} · {title(row.statement_signal)}</small></article>)}{!gaps.length ? <div className="owner-store-empty">No customer data gaps.</div> : null}</div></section></section>
      <CampaignWorkbench stores={stores} contacts={contacts} selectedIds={selectedIds} setSelectedIds={setSelectedIds} editable={editable} history={campaigns} onReload={reloadContactsAndCampaigns} />
    </section>
  );
}

export function OwnerStoreIntelligence() {
  const host = useStoresHost();
  return host ? createPortal(<StoreContent />, host) : null;
}
