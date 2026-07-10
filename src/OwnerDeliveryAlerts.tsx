import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadOwnerDeliveryNotifications, type DeliveryNotificationRow } from '@/data/repositories/deliveryOperations';

function title(value?: string | null) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function dateText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function AlertRow({ row }: { row: DeliveryNotificationRow }) {
  const exception = row.delivery_outcome !== 'DELIVERED';
  return (
    <article className={`owner-delivery-alert ${exception ? 'exception' : 'delivered'}`}>
      <div><strong>{row.store_name || 'Unknown store'}</strong><span>{row.subject || title(row.delivery_outcome)}</span><small>{row.message_text}</small></div>
      <div><b>{title(row.delivery_outcome)}</b><span>{row.box_code || 'No box'} · stop {row.stop_number || '—'}</span><small>{dateText(row.queued_at)}</small></div>
    </article>
  );
}

export function OwnerDeliveryAlerts() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [rows, setRows] = useState<DeliveryNotificationRow[]>([]);
  const [error, setError] = useState('');

  async function reload() {
    try {
      setRows(await loadOwnerDeliveryNotifications());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    function locate() {
      const shell = document.querySelector<HTMLElement>('.owner-command-shell');
      if (!shell) { setHost(null); return; }
      let mount = shell.querySelector<HTMLElement>('.owner-delivery-alerts-mount');
      if (!mount) {
        mount = document.createElement('section');
        mount.className = 'owner-delivery-alerts-mount';
        shell.appendChild(mount);
      }
      setHost(mount);
    }
    locate();
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => { pending = false; locate(); }, 140);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!host) return;
    void reload();
    const timer = window.setInterval(() => void reload(), 15000);
    return () => window.clearInterval(timer);
  }, [host]);

  if (!host) return null;
  return createPortal(
    <section className="owner-delivery-alerts-panel">
      <header><div><h3>Delivery confirmations</h3><p>Internal delivery outcomes, POD confirmation and return exceptions.</p></div><button type="button" onClick={() => void reload()}>Refresh</button></header>
      {error ? <div className="owner-delivery-alert-error">{error}</div> : null}
      <div>{rows.slice(0, 12).map((row) => <AlertRow key={row.id} row={row} />)}{!rows.length ? <div className="owner-delivery-alert-empty">No delivery confirmations yet.</div> : null}</div>
    </section>,
    host,
  );
}
