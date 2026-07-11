import { useCallback, useEffect, useMemo, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';
import { CheckCircle2, Mail, RefreshCw, Save, ShieldCheck, Store, TriangleAlert } from 'lucide-react';
import { buildEcoFlowData } from '@/domain/ecoflowData';
import { loadDriverIdentity } from '@/data/repositories/driverLocation';
import {
  loadDeliveryNotificationLog,
  loadOwnerDepartureAcknowledgements,
  updateStoreNotificationContact,
  type DriverDepartureAcknowledgement,
} from '@/data/repositories/driverDeparture';
import { supabase } from '@/lib/supabaseClient';

type StoreSite = {
  retailer_id: string | null;
  store_name: string | null;
  suburb: string | null;
  verified: boolean | null;
};

type StoreContact = {
  store_key: string;
  retailer_id: string | null;
  store_name: string;
  contact_email: string | null;
  contact_name: string | null;
  enabled: boolean;
};

type NotificationRow = {
  id: string;
  store_name: string;
  recipient_email: string | null;
  status: string;
  order_numbers: string[] | null;
  requested_at: string;
  sent_at: string | null;
  provider_error: string | null;
};

function activeDesktopTab() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button'))
    .find((button) => button.classList.contains('active'))?.textContent?.trim() ?? '';
}

function workspaceHost() {
  return document.querySelector<HTMLElement>('.desktop-content > .workspace-stack');
}

function time(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusClass(status: string) {
  if (status === 'SENT') return 'good';
  if (status === 'PENDING') return 'pending';
  return 'warn';
}

function DeliveryAuditPanel({ businessDay }: { businessDay: string }) {
  const [acknowledgements, setAcknowledgements] = useState<DriverDepartureAcknowledgement[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [acks, logs] = await Promise.all([
        loadOwnerDepartureAcknowledgements(businessDay),
        loadDeliveryNotificationLog(businessDay),
      ]);
      setAcknowledgements(acks);
      setNotifications(logs as NotificationRow[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [businessDay]);

  useEffect(() => { void reload(); }, [reload]);

  const totals = useMemo(() => ({
    sent: notifications.filter((row) => row.status === 'SENT').length,
    missing: notifications.filter((row) => row.status === 'MISSING_CONTACT').length,
    failed: notifications.filter((row) => row.status === 'FAILED' || row.status === 'CONFIGURATION_REQUIRED').length,
  }), [notifications]);

  return (
    <section className="owner-governance panel">
      <div className="panel-head">
        <div>
          <span className="section-eyebrow">DEPARTURE GOVERNANCE</span>
          <h2>Driver declaration &amp; customer notices</h2>
          <p>Auditable route-start checks, location consent and one notice per store.</p>
        </div>
        <button type="button" onClick={() => void reload()} disabled={loading}><RefreshCw size={15} /> {loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      {error ? <div className="governance-error"><TriangleAlert size={17} /> {error}</div> : null}

      <div className="governance-metrics">
        <div><ShieldCheck size={18} /><strong>{acknowledgements.length}</strong><span>driver declarations</span></div>
        <div><Mail size={18} /><strong>{totals.sent}</strong><span>store notices sent</span></div>
        <div className={totals.missing ? 'warn' : ''}><Store size={18} /><strong>{totals.missing}</strong><span>missing emails</span></div>
        <div className={totals.failed ? 'warn' : ''}><TriangleAlert size={18} /><strong>{totals.failed}</strong><span>send/config failures</span></div>
      </div>

      <div className="governance-columns">
        <div>
          <h3>Pre-departure records</h3>
          {acknowledgements.map((row) => (
            <article className="governance-record" key={row.id ?? row.acknowledgement_id}>
              <CheckCircle2 size={18} />
              <div>
                <strong>{row.typed_name || row.driver_label || 'Driver'}</strong>
                <span>{time(row.accepted_at)} · location consent recorded</span>
                <small>{row.route_id} · policy {row.policy_version}</small>
              </div>
            </article>
          ))}
          {!acknowledgements.length ? <p className="governance-empty">No departure declaration recorded for today.</p> : null}
        </div>

        <div>
          <h3>Customer notification log</h3>
          {notifications.slice(0, 30).map((row) => (
            <article className="governance-record" key={row.id}>
              <span className={`governance-status ${statusClass(row.status)}`}>{row.status.replace(/_/g, ' ')}</span>
              <div>
                <strong>{row.store_name}</strong>
                <span>{row.recipient_email || 'No customer email configured'} · {time(row.sent_at || row.requested_at)}</span>
                <small>{row.order_numbers?.join(', ') || 'Order reference unavailable'}{row.provider_error ? ` · ${row.provider_error}` : ''}</small>
              </div>
            </article>
          ))}
          {!notifications.length ? <p className="governance-empty">No route-start notices recorded for today.</p> : null}
        </div>
      </div>
    </section>
  );
}

function StoreNotificationContacts() {
  const [stores, setStores] = useState<StoreSite[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { email: string; name: string; enabled: boolean }>>({});
  const [savingKey, setSavingKey] = useState('');
  const [message, setMessage] = useState('');

  const reload = useCallback(async () => {
    if (!supabase) return;
    const [siteResult, contactResult] = await Promise.all([
      supabase
        .from('ecoflow_store_sites')
        .select('retailer_id,store_name,suburb,verified')
        .order('store_name', { ascending: true })
        .limit(1000),
      supabase
        .from('ecoflow_delivery_notification_contacts')
        .select('store_key,retailer_id,store_name,contact_email,contact_name,enabled')
        .limit(1000),
    ]);
    if (siteResult.error) throw siteResult.error;
    if (contactResult.error) throw contactResult.error;
    const rows = (siteResult.data ?? []) as StoreSite[];
    const contacts = (contactResult.data ?? []) as StoreContact[];
    const contactByKey = new Map<string, StoreContact>();
    contacts.forEach((contact) => {
      contactByKey.set(contact.store_key, contact);
      if (contact.retailer_id) contactByKey.set(contact.retailer_id, contact);
    });
    setStores(rows);
    setDrafts(Object.fromEntries(rows.map((store) => {
      const key = store.retailer_id || String(store.store_name || '').toUpperCase();
      const contact = contactByKey.get(key);
      return [key, {
        email: contact?.contact_email || '',
        name: contact?.contact_name || '',
        enabled: contact?.enabled !== false,
      }];
    })));
  }, []);

  useEffect(() => { void reload().catch((error) => setMessage(error instanceof Error ? error.message : String(error))); }, [reload]);

  async function save(store: StoreSite) {
    const key = store.retailer_id || String(store.store_name || '').toUpperCase();
    const draft = drafts[key];
    if (!draft) return;
    setSavingKey(key);
    setMessage('');
    try {
      await updateStoreNotificationContact({
        storeKey: key,
        storeName: store.store_name || key,
        retailerId: store.retailer_id,
        email: draft.email,
        contactName: draft.name,
        enabled: draft.enabled,
      });
      setMessage(`${store.store_name || key} notification contact saved.`);
      await reload();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingKey('');
    }
  }

  return (
    <section className="owner-governance panel store-notification-panel">
      <div className="panel-head">
        <div>
          <span className="section-eyebrow">DELIVERY CARE</span>
          <h2>Store delivery-notification emails</h2>
          <p>One route-start email is sent per enabled store. Contact addresses are Owner-only and are not exposed to the driver.</p>
        </div>
        <button type="button" onClick={() => void reload()}><RefreshCw size={15} /> Refresh</button>
      </div>
      {message ? <div className="governance-message">{message}</div> : null}
      <div className="store-contact-grid">
        {stores.map((store) => {
          const key = store.retailer_id || String(store.store_name || '').toUpperCase();
          const draft = drafts[key] ?? { email: '', name: '', enabled: true };
          return (
            <article className="store-contact-row" key={key}>
              <div className="store-contact-title"><strong>{store.store_name || key}</strong><span>{store.suburb || 'Suburb unavailable'} · {store.verified ? 'verified site' : 'site review'}</span></div>
              <input
                type="email"
                value={draft.email}
                placeholder="delivery@store.com.au"
                onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...draft, email: event.target.value } }))}
              />
              <input
                value={draft.name}
                placeholder="Contact name (optional)"
                onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...draft, name: event.target.value } }))}
              />
              <label className="store-notify-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...draft, enabled: event.target.checked } }))} /><span>Send today notice</span></label>
              <button type="button" disabled={savingKey === key} onClick={() => void save(store)}><Save size={15} /> {savingKey === key ? 'Saving…' : 'Save'}</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function OwnerDeliveryGovernance() {
  const [owner, setOwner] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [tab, setTab] = useState('');
  const businessDay = buildEcoFlowData().businessDay.date;

  useEffect(() => {
    let active = true;
    loadDriverIdentity().then((profile) => {
      if (active) setOwner(profile?.is_active === true && (profile.app_role === 'OWNER' || profile.app_role === 'ADMIN'));
    }).catch(() => setOwner(window.localStorage.getItem('ecoflow-role') === 'owner'));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const locate = () => {
      setTab(activeDesktopTab());
      setHost(workspaceHost());
    };
    const stopObserving = observeBody(locate);
    return stopObserving;
  }, []);

  if (!owner || !host) return null;
  if (tab === 'Delivery') return createPortal(<DeliveryAuditPanel businessDay={businessDay} />, host);
  if (tab === 'Stores') return createPortal(<StoreNotificationContacts />, host);
  return null;
}
