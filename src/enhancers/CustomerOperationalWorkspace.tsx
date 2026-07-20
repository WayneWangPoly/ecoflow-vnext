import { useEffect, useMemo, useState } from 'react';
import { Clock3, MessageSquareText, Navigation, PhoneCall, Plus, RefreshCw, Save } from 'lucide-react';
import {
  loadCustomerOperationalEvents,
  peekCustomerOperationalEvents,
  recordCustomerOperationalEvent,
  type CustomerContactChannel,
  type CustomerOperationalEventRow,
} from '@/data/repositories/customerOperationalEvents';
import '../industrialCustomerOperations.css';

export type CustomerWorkContext = {
  storeId?: string;
  storeName: string;
  address?: string;
  deliveryInstruction?: string;
};

type CustomerPanel = 'delivery' | 'contact';

function dateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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

export function CustomerOperationalWorkspace({ context, editable }: { context: CustomerWorkContext; editable: boolean }) {
  const initialRows = peekCustomerOperationalEvents(context.storeName);
  const [panel, setPanel] = useState<CustomerPanel>('delivery');
  const [rows, setRows] = useState<CustomerOperationalEventRow[]>(initialRows);
  const [loading, setLoading] = useState(!initialRows.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
  const activeInstruction = latestDelivery?.note_text || context.deliveryInstruction || '';

  async function reload(force = false) {
    const hasVisibleData = rows.length > 0 || Boolean(context.deliveryInstruction);
    if (!hasVisibleData) setLoading(true);
    setError('');
    try {
      const next = await loadCustomerOperationalEvents(context.storeName, force);
      setRows(next);
      const latest = next.find((row) => row.event_type === 'DELIVERY_INSTRUCTION')?.note_text;
      setDeliveryText((current) => latest || current || context.deliveryInstruction || '');
    } catch {
      setError('Customer notes are unavailable.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const cached = peekCustomerOperationalEvents(context.storeName);
    setRows(cached);
    setDeliveryText(cached.find((row) => row.event_type === 'DELIVERY_INSTRUCTION')?.note_text || context.deliveryInstruction || '');
    setContactText('');
    setOccurredAt(localDateTimeValue());
    setNotice('');
    setError('');
    setLoading(!cached.length && !context.deliveryInstruction);
    void reload();
  }, [context.storeName, context.deliveryInstruction]);

  async function saveDelivery() {
    if (!editable || !deliveryText.trim() || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await recordCustomerOperationalEvent({
        storeName: context.storeName,
        eventType: 'DELIVERY_INSTRUCTION',
        noteText: deliveryText,
      });
      setRows(result.rows);
      setNotice(result.persistence === 'REMOTE' ? 'Saved' : 'Saved on this browser');
    } catch {
      setError('Delivery instruction was not saved.');
    } finally {
      setBusy(false);
    }
  }

  async function addContact() {
    if (!editable || !contactText.trim() || busy) return;
    setBusy(true); setError(''); setNotice('');
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
      setNotice(result.persistence === 'REMOTE' ? 'Added' : 'Added on this browser');
    } catch {
      setError('Contact event was not saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="customer-ops-workspace">
      <nav className="customer-ops-tabs">
        <button type="button" className={panel === 'delivery' ? 'active' : ''} onClick={() => setPanel('delivery')}><Navigation size={14} />Delivery</button>
        <button type="button" className={panel === 'contact' ? 'active' : ''} onClick={() => setPanel('contact')}><MessageSquareText size={14} />Contact log <b>{contactRows.length}</b></button>
        <button type="button" className="customer-ops-refresh" onClick={() => void reload(true)} disabled={loading} aria-label="Refresh customer events"><RefreshCw size={14} /></button>
      </nav>

      {context.address ? <div className="customer-ops-address">{context.address}</div> : null}
      {error ? <div className="customer-ops-error">{error}</div> : null}
      {notice ? <div className="customer-ops-notice">{notice}</div> : null}

      {panel === 'delivery' ? (
        <div className="customer-ops-panel">
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
            {!loading && !deliveryRows.length ? <div className="customer-ops-empty">No instruction history</div> : null}
          </div>
        </div>
      ) : (
        <div className="customer-ops-panel">
          {editable ? (
            <div className="customer-contact-compose">
              <div>
                <label><span>Channel</span><select value={channel} onChange={(event) => setChannel(event.target.value as CustomerContactChannel)}><option value="PHONE">Phone</option><option value="EMAIL">Email</option><option value="IN_PERSON">In person</option><option value="SMS">SMS</option><option value="OTHER">Other</option></select></label>
                <label><span>When</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
              </div>
              <textarea value={contactText} onChange={(event) => setContactText(event.target.value)} rows={4} placeholder="Request, issue, agreement or follow-up" />
              <button type="button" className="primary" disabled={busy || !contactText.trim()} onClick={() => void addContact()}><Plus size={15} />{busy ? 'Adding…' : 'Add event'}</button>
            </div>
          ) : null}
          <div className="customer-event-list">
            {contactRows.map((row) => (
              <article key={row.id}><i>{row.contact_channel === 'PHONE' ? <PhoneCall size={13} /> : <MessageSquareText size={13} />}</i><div><strong>{row.note_text}</strong><span>{eventLabel(row)}</span><small><Clock3 size={11} />{dateTime(row.occurred_at)} · {row.created_by_email || (row.persistence === 'LOCAL' ? 'This browser' : 'EcoFlow user')}</small></div></article>
            ))}
            {!loading && !contactRows.length ? <div className="customer-ops-empty">No contact events</div> : null}
          </div>
        </div>
      )}
    </section>
  );
}
