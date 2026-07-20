import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Clock3,
  Mail,
  MapPin,
  MessageSquareText,
  Navigation,
  PhoneCall,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import { PodAssetImage } from '@/app/PodAsset';
import { updateStoreNotificationContact } from '@/data/repositories/driverDeparture';
import {
  loadCustomerOperationalEvents,
  peekCustomerOperationalEvents,
  recordCustomerOperationalEvent,
  type CustomerContactChannel,
  type CustomerOperationalEventRow,
} from '@/data/repositories/customerOperationalEvents';
import { loadCustomerOrderPodIndex, type CustomerOrderPodPreview } from '@/data/repositories/customerOrderPod';
import {
  loadCustomerStoreContacts,
  loadCustomerStoreDirectory,
  loadCustomerStoreOrders,
  type CustomerStoreContactRow,
  type CustomerStoreDirectoryRow,
  type CustomerStoreOrderRow,
} from '@/data/repositories/customerStoreCenter';
import {
  loadOwnerStoreSkuMix,
  loadOwnerStoreStatementSummary,
  type OwnerStoreSkuMixRow,
  type OwnerStoreStatementSummaryRow,
} from '@/data/repositories/storeIntelligence';
import '../industrialCustomerOperations.css';
import '../customerFullWorkspace.css';

export type CustomerWorkContext = {
  storeId?: string;
  storeName: string;
  address?: string;
  deliveryInstruction?: string;
};

type CustomerPanel = 'overview' | 'orders' | 'analytics' | 'contact' | 'delivery' | 'contact-log';

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown, decimals = 0) {
  return numberValue(value).toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function units(value: unknown) {
  return numberValue(value).toLocaleString('en-AU', { maximumFractionDigits: 0 });
}

function normalise(value?: string | null) {
  return String(value || '').trim().toUpperCase();
}

function label(value?: string | null) {
  return String(value || '—').replace(/_/g, ' ');
}

function dateTime(value?: string | null, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function localDateTimeValue() {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function eventLabel(row: CustomerOperationalEventRow) {
  if (row.event_type === 'DELIVERY_INSTRUCTION') return 'Driver instruction';
  return row.contact_channel ? row.contact_channel.replace('_', ' ') : 'Customer contact';
}

function Metric({ value, labelText, helper }: { value: string; labelText: string; helper: string }) {
  return <article className="customer-full-metric"><strong>{value}</strong><span>{labelText}</span><small>{helper}</small></article>;
}

function PodPreview({ pod }: { pod?: CustomerOrderPodPreview }) {
  if (!pod) return <span className="customer-full-no-pod">No POD</span>;
  return (
    <div className="customer-full-pod" title={pod.capturedAt ? `POD captured ${dateTime(pod.capturedAt)}` : 'Proof of delivery'}>
      {pod.pod1Path ? <PodAssetImage path={pod.pod1Path} alt="POD delivery point" /> : null}
      {pod.pod2Path ? <PodAssetImage path={pod.pod2Path} alt="POD delivered goods" /> : null}
    </div>
  );
}

export function CustomerOperationalWorkspace({ context, editable }: { context: CustomerWorkContext; editable: boolean }) {
  const initialRows = peekCustomerOperationalEvents(context.storeName);
  const [panel, setPanel] = useState<CustomerPanel>('overview');
  const [store, setStore] = useState<CustomerStoreDirectoryRow | null>(null);
  const [orders, setOrders] = useState<CustomerStoreOrderRow[]>([]);
  const [mix, setMix] = useState<OwnerStoreSkuMixRow[]>([]);
  const [statement, setStatement] = useState<OwnerStoreStatementSummaryRow | null>(null);
  const [contact, setContact] = useState<CustomerStoreContactRow | null>(null);
  const [podIndex, setPodIndex] = useState<Map<string, CustomerOrderPodPreview>>(new Map());
  const [customerLoading, setCustomerLoading] = useState(true);
  const [customerError, setCustomerError] = useState('');
  const [contactDraft, setContactDraft] = useState({ email: '', name: '', enabled: true });
  const [contactBusy, setContactBusy] = useState(false);
  const [contactNotice, setContactNotice] = useState('');

  const [rows, setRows] = useState<CustomerOperationalEventRow[]>(initialRows);
  const [eventsLoading, setEventsLoading] = useState(!initialRows.length);
  const [busy, setBusy] = useState(false);
  const [eventError, setEventError] = useState('');
  const [eventNotice, setEventNotice] = useState('');
  const [deliveryText, setDeliveryText] = useState(
    initialRows.find((row) => row.event_type === 'DELIVERY_INSTRUCTION')?.note_text
      || context.deliveryInstruction
      || '',
  );
  const [channel, setChannel] = useState<CustomerContactChannel>('PHONE');
  const [contactText, setContactText] = useState('');
  const [occurredAt, setOccurredAt] = useState(localDateTimeValue);

  const deliveryRows = useMemo(() => rows.filter((row) => row.event_type === 'DELIVERY_INSTRUCTION'), [rows]);
  const contactRows = useMemo(() => rows.filter((row) => row.event_type === 'CUSTOMER_CONTACT'), [rows]);
  const latestDelivery = deliveryRows[0];
  const activeInstruction = latestDelivery?.note_text || store?.delivery_instructions || context.deliveryInstruction || '';

  const monthly = useMemo(() => {
    const totals = new Map<string, { value: number; count: number }>();
    orders.forEach((order) => {
      if (!order.order_at) return;
      const date = new Date(order.order_at);
      if (Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const current = totals.get(key) ?? { value: 0, count: 0 };
      current.value += numberValue(order.order_value);
      current.count += 1;
      totals.set(key, current);
    });
    return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-12);
  }, [orders]);
  const maxMonthlyValue = Math.max(1, ...monthly.map(([, value]) => value.value));

  useEffect(() => {
    let active = true;
    setPanel('overview');
    setCustomerLoading(true);
    setCustomerError('');
    setContactNotice('');

    void (async () => {
      const [directoryResult, contactResult, statementResult, mixResult, podResult] = await Promise.allSettled([
        loadCustomerStoreDirectory(),
        loadCustomerStoreContacts(),
        loadOwnerStoreStatementSummary(),
        loadOwnerStoreSkuMix(),
        loadCustomerOrderPodIndex(),
      ]);
      if (!active) return;

      const directory = directoryResult.status === 'fulfilled' ? directoryResult.value : [];
      const selectedStore = directory.find((row) => context.storeId && row.store_id === context.storeId)
        || directory.find((row) => normalise(row.store_name) === normalise(context.storeName))
        || null;
      setStore(selectedStore);

      const contacts = contactResult.status === 'fulfilled' ? contactResult.value : [];
      const selectedContact = contacts.find((row) => selectedStore?.store_id && (row.retailer_id === selectedStore.store_id || row.store_key === selectedStore.store_id))
        || contacts.find((row) => normalise(row.store_name) === normalise(context.storeName))
        || null;
      setContact(selectedContact);
      setContactDraft({
        email: selectedContact?.contact_email || '',
        name: selectedContact?.contact_name || '',
        enabled: selectedContact?.enabled !== false,
      });

      const statements = statementResult.status === 'fulfilled' ? statementResult.value : [];
      setStatement(statements.find((row) => selectedStore?.store_id && row.store_id === selectedStore.store_id)
        || statements.find((row) => normalise(row.store_name) === normalise(context.storeName))
        || null);

      const mixRows = mixResult.status === 'fulfilled' ? mixResult.value : [];
      setMix(mixRows.filter((row) => (selectedStore?.store_id && row.store_id === selectedStore.store_id)
        || normalise(row.store_name) === normalise(context.storeName)));
      if (podResult.status === 'fulfilled') setPodIndex(podResult.value);

      if (selectedStore?.store_id) {
        try {
          const nextOrders = await loadCustomerStoreOrders(selectedStore.store_id);
          if (active) setOrders(nextOrders);
        } catch {
          if (active) setOrders([]);
        }
      } else {
        setOrders([]);
      }

      if (directoryResult.status === 'rejected') setCustomerError('Customer master data is temporarily unavailable.');
      setCustomerLoading(false);
    })();

    return () => { active = false; };
  }, [context.storeId, context.storeName]);

  async function reloadEvents(force = false) {
    const hasVisibleData = rows.length > 0 || Boolean(context.deliveryInstruction);
    if (!hasVisibleData) setEventsLoading(true);
    setEventError('');
    try {
      const next = await loadCustomerOperationalEvents(context.storeName, force);
      setRows(next);
      const latest = next.find((row) => row.event_type === 'DELIVERY_INSTRUCTION')?.note_text;
      setDeliveryText((current) => latest || current || store?.delivery_instructions || context.deliveryInstruction || '');
    } catch {
      setEventError('Customer notes are unavailable.');
    } finally {
      setEventsLoading(false);
    }
  }

  useEffect(() => {
    const cached = peekCustomerOperationalEvents(context.storeName);
    setRows(cached);
    setDeliveryText(cached.find((row) => row.event_type === 'DELIVERY_INSTRUCTION')?.note_text || context.deliveryInstruction || '');
    setContactText('');
    setOccurredAt(localDateTimeValue());
    setEventNotice('');
    setEventError('');
    setEventsLoading(!cached.length && !context.deliveryInstruction);
    void reloadEvents();
  }, [context.storeName, context.deliveryInstruction]);

  async function saveDelivery() {
    if (!editable || !deliveryText.trim() || busy) return;
    setBusy(true); setEventError(''); setEventNotice('');
    try {
      const result = await recordCustomerOperationalEvent({
        storeName: context.storeName,
        eventType: 'DELIVERY_INSTRUCTION',
        noteText: deliveryText,
      });
      setRows(result.rows);
      setEventNotice(result.persistence === 'REMOTE' ? 'Saved' : 'Saved on this browser');
    } catch {
      setEventError('Delivery instruction was not saved.');
    } finally {
      setBusy(false);
    }
  }

  async function addContactEvent() {
    if (!editable || !contactText.trim() || busy) return;
    setBusy(true); setEventError(''); setEventNotice('');
    try {
      const result = await recordCustomerOperationalEvent({
        storeName: context.storeName,
        eventType: 'CUSTOMER_CONTACT',
        noteText: contactText,
        contactChannel: channel,
        occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
      });
      setRows(result.rows);
      setContactText('');
      setOccurredAt(localDateTimeValue());
      setEventNotice(result.persistence === 'REMOTE' ? 'Added' : 'Added on this browser');
    } catch {
      setEventError('Contact event was not saved.');
    } finally {
      setBusy(false);
    }
  }

  async function saveCustomerContact() {
    const storeId = store?.store_id || context.storeId;
    if (!editable || !storeId || contactBusy) return;
    setContactBusy(true);
    setContactNotice('');
    try {
      await updateStoreNotificationContact({
        storeKey: storeId,
        storeName: store?.store_name || context.storeName,
        retailerId: storeId,
        email: contactDraft.email,
        contactName: contactDraft.name,
        enabled: contactDraft.enabled,
      });
      setContact({
        store_key: storeId,
        retailer_id: storeId,
        store_name: store?.store_name || context.storeName,
        contact_email: contactDraft.email || null,
        contact_name: contactDraft.name || null,
        enabled: contactDraft.enabled,
        updated_at: new Date().toISOString(),
      });
      setContactNotice('Saved');
    } catch (error) {
      setContactNotice(error instanceof Error ? error.message : 'Customer contact was not saved.');
    } finally {
      setContactBusy(false);
    }
  }

  const tabs: Array<{ id: CustomerPanel; label: string; icon: typeof UserRound; count?: number }> = [
    { id: 'overview', label: 'Overview', icon: UserRound },
    { id: 'orders', label: 'Orders', icon: ShoppingBag, count: orders.length },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'contact', label: 'Contact', icon: Mail },
    { id: 'delivery', label: 'Delivery instruction', icon: Navigation },
    { id: 'contact-log', label: 'Contact log', icon: MessageSquareText, count: contactRows.length },
  ];

  return (
    <section className="customer-full-workspace">
      <nav className="customer-full-tabs" aria-label="Customer workspace sections">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button type="button" key={item.id} className={panel === item.id ? 'active' : ''} onClick={() => setPanel(item.id)}>
              <Icon size={14} /><span>{item.label}</span>{item.count !== undefined ? <b>{item.count}</b> : null}
            </button>
          );
        })}
      </nav>

      <div className="customer-full-body">
        {customerError ? <div className="customer-ops-error">{customerError}</div> : null}

        {panel === 'overview' ? (
          <div className="customer-full-section">
            <section className="customer-full-metrics">
              <Metric value={money(store?.revenue_30d)} labelText="30d revenue" helper={`${units(store?.orders_30d)} recent orders`} />
              <Metric value={units(store?.lifetime_orders)} labelText="Lifetime orders" helper={`Last ${dateTime(store?.last_order_at, false)}`} />
              <Metric value={money(statement?.open_statement_value)} labelText="Open statement" helper={`${units(statement?.overdue_invoice_count)} overdue invoices`} />
              <Metric value={store?.top_sku_30d || '—'} labelText="Top SKU" helper={`${units(store?.top_sku_units_30d)} units in 30d`} />
            </section>
            <section className="customer-full-overview-grid">
              <article><MapPin size={16} /><div><span>Address</span><strong>{store?.address || context.address || '—'}</strong></div></article>
              <article><PhoneCall size={16} /><div><span>Phone</span><strong>{store?.contact_phone || '—'}</strong></div></article>
              <article><Mail size={16} /><div><span>Email contact</span><strong>{contact?.contact_email || '—'}</strong><small>{contact?.contact_name || 'No contact name'}</small></div></article>
              <article><ReceiptText size={16} /><div><span>Price tier</span><strong>{store?.price_group_id || '—'}</strong><small>{label(statement?.statement_signal)}</small></div></article>
            </section>
            <section className="customer-full-summary-table">
              <div><span>Store source</span><strong>{store?.source || '—'}</strong></div>
              <div><span>Verified</span><strong>{store?.verified ? 'Yes' : 'No'}</strong></div>
              <div><span>First order</span><strong>{dateTime(store?.first_order_at, false)}</strong></div>
              <div><span>Last update</span><strong>{dateTime(store?.site_updated_at)}</strong></div>
              <div><span>Current delivery note</span><strong>{activeInstruction || 'None recorded'}</strong></div>
            </section>
          </div>
        ) : null}

        {panel === 'orders' ? (
          <div className="customer-full-section">
            {customerLoading ? <div className="customer-ops-empty">Loading orders…</div> : null}
            {!customerLoading && !orders.length ? <div className="customer-ops-empty">No linked orders</div> : null}
            <div className="customer-full-orders">
              {orders.map((order) => {
                const orderKey = normalise(order.order_number || order.external_order_id || order.internal_order_id);
                return (
                  <article key={order.internal_order_id}>
                    <div><strong>{order.order_number || order.external_order_id || order.internal_order_id}</strong><small>{dateTime(order.order_at)}</small></div>
                    <div><span>Status</span><strong>{label(order.status)}</strong></div>
                    <div><span>Value</span><strong>{money(order.order_value, 2)}</strong></div>
                    <div><span>Invoice</span><strong>{order.invoice_number || '—'}</strong></div>
                    <div><span>Delivery</span><strong>{dateTime(order.delivery_date, false)}</strong></div>
                    <PodPreview pod={podIndex.get(orderKey)} />
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        {panel === 'analytics' ? (
          <div className="customer-full-section customer-full-analytics">
            <section className="customer-full-metrics">
              <Metric value={units(store?.orders_7d)} labelText="7d orders" helper={money(store?.revenue_7d)} />
              <Metric value={units(store?.units_30d)} labelText="30d units" helper={`${units(store?.sku_count_30d)} distinct SKUs`} />
              <Metric value={store?.top_product_30d || '—'} labelText="Top product" helper={store?.top_sku_30d || '—'} />
              <Metric value={units(store?.legacy_or_cancelled_orders)} labelText="Legacy / cancelled" helper="Historical exceptions" />
            </section>
            <section className="customer-full-chart">
              <h3>Historical order value</h3>
              {monthly.map(([month, value]) => (
                <div key={month}><span>{month}</span><i style={{ width: `${Math.max(3, Math.round((value.value / maxMonthlyValue) * 100))}%` }} /><strong>{money(value.value)} · {value.count}</strong></div>
              ))}
              {!monthly.length ? <div className="customer-ops-empty">No order trend available</div> : null}
            </section>
            <section className="customer-full-mix">
              <h3>Recent product mix</h3>
              {mix.slice(0, 20).map((row) => (
                <article key={`${row.store_id}-${row.sku}`}><div><strong>{row.sku || 'UNKNOWN'}</strong><small>{row.product_name || 'Unknown product'}</small></div><span>{units(row.order_count_30d)} orders</span><span>{units(row.units_30d)} units</span><strong>{money(row.revenue_30d)}</strong></article>
              ))}
              {!mix.length ? <div className="customer-ops-empty">No recent product mix</div> : null}
            </section>
          </div>
        ) : null}

        {panel === 'contact' ? (
          <div className="customer-full-section">
            <section className="customer-full-contact-card">
              <div className="customer-full-contact-heading"><Mail size={17} /><div><strong>Customer contact</strong><small>Operational notices and customer communication</small></div></div>
              <label><span>Email</span><input type="email" disabled={!editable} value={contactDraft.email} onChange={(event) => setContactDraft({ ...contactDraft, email: event.target.value })} placeholder="orders@store.com.au" /></label>
              <label><span>Contact name</span><input disabled={!editable} value={contactDraft.name} onChange={(event) => setContactDraft({ ...contactDraft, name: event.target.value })} placeholder="Store manager or accounts contact" /></label>
              <label className="customer-full-contact-toggle"><input type="checkbox" disabled={!editable} checked={contactDraft.enabled} onChange={(event) => setContactDraft({ ...contactDraft, enabled: event.target.checked })} /><span>Enable operational notices</span></label>
              {contactNotice ? <div className="customer-ops-notice">{contactNotice}</div> : null}
              {editable ? <button type="button" disabled={contactBusy} onClick={() => void saveCustomerContact()}><Save size={14} />{contactBusy ? 'Saving…' : 'Save contact'}</button> : null}
            </section>
          </div>
        ) : null}

        {panel === 'delivery' ? (
          <div className="customer-full-section">
            {eventError ? <div className="customer-ops-error">{eventError}</div> : null}
            {eventNotice ? <div className="customer-ops-notice">{eventNotice}</div> : null}
            <div className="customer-current-instruction">
              <span>DRIVER INSTRUCTION</span>
              <strong>{activeInstruction || 'None recorded'}</strong>
              {latestDelivery ? <small>{dateTime(latestDelivery.occurred_at)} · {latestDelivery.created_by_email || (latestDelivery.persistence === 'LOCAL' ? 'This browser' : 'EcoFlow user')}</small> : null}
            </div>
            {editable ? (
              <div className="customer-ops-compose">
                <textarea value={deliveryText} onChange={(event) => setDeliveryText(event.target.value)} rows={4} placeholder="Parking, entrance, placement point or access note" />
                <button type="button" className="primary" disabled={busy || !deliveryText.trim()} onClick={() => void saveDelivery()}><Save size={15} />{busy ? 'Saving…' : 'Save'}</button>
              </div>
            ) : null}
            <div className="customer-event-list">
              {deliveryRows.slice(0, 12).map((row) => (
                <article key={row.id}><i><Navigation size={13} /></i><div><strong>{row.note_text}</strong><small>{dateTime(row.occurred_at)} · {row.created_by_email || (row.persistence === 'LOCAL' ? 'This browser' : 'EcoFlow user')}</small></div></article>
              ))}
              {!eventsLoading && !deliveryRows.length ? <div className="customer-ops-empty">No instruction history</div> : null}
            </div>
          </div>
        ) : null}

        {panel === 'contact-log' ? (
          <div className="customer-full-section">
            {eventError ? <div className="customer-ops-error">{eventError}</div> : null}
            {eventNotice ? <div className="customer-ops-notice">{eventNotice}</div> : null}
            {editable ? (
              <div className="customer-contact-compose">
                <div>
                  <label><span>Channel</span><select value={channel} onChange={(event) => setChannel(event.target.value as CustomerContactChannel)}><option value="PHONE">Phone</option><option value="EMAIL">Email</option><option value="IN_PERSON">In person</option><option value="SMS">SMS</option><option value="OTHER">Other</option></select></label>
                  <label><span>When</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
                </div>
                <textarea value={contactText} onChange={(event) => setContactText(event.target.value)} rows={4} placeholder="Request, issue, agreement or follow-up" />
                <button type="button" className="primary" disabled={busy || !contactText.trim()} onClick={() => void addContactEvent()}><Plus size={15} />{busy ? 'Adding…' : 'Add event'}</button>
              </div>
            ) : null}
            <div className="customer-event-list">
              {contactRows.map((row) => (
                <article key={row.id}><i>{row.contact_channel === 'PHONE' ? <PhoneCall size={13} /> : <MessageSquareText size={13} />}</i><div><strong>{row.note_text}</strong><span>{eventLabel(row)}</span><small><Clock3 size={11} />{dateTime(row.occurred_at)} · {row.created_by_email || (row.persistence === 'LOCAL' ? 'This browser' : 'EcoFlow user')}</small></div></article>
              ))}
              {!eventsLoading && !contactRows.length ? <div className="customer-ops-empty">No contact events</div> : null}
            </div>
          </div>
        ) : null}
      </div>

      <button type="button" className="customer-full-refresh" onClick={() => void Promise.all([reloadEvents(true), loadCustomerOrderPodIndex(true).then(setPodIndex)])} aria-label="Refresh customer workspace"><RefreshCw size={14} /></button>
    </section>
  );
}
