import { useEffect, useMemo, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  loadAccountsArKpis,
  loadAccountsFollowupQueue,
  loadAccountsStatementCustomers,
  loadAccountsStatementExportRows,
  loadAccountsStatementLines,
  recordAccountsStatementAction,
  type AccountsArKpis,
  type AccountsFollowupRow,
  type AccountsStatementAction,
  type AccountsStatementCustomerRow,
  type AccountsStatementLineRow,
} from '@/data/repositories/accountsStatement';

type PriorityFilter = 'ALL' | 'URGENT_COLLECTION' | 'COLLECTION' | 'SEND_STATEMENT' | 'ON_HOLD' | 'CLEAR';
type CustomerSort = 'priority' | 'open' | 'overdue' | 'recent' | 'name';

function num(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown) {
  return num(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}

function units(value: unknown) {
  return num(value).toLocaleString('en-AU', { maximumFractionDigits: 0 });
}

function dateText(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
}

function title(value: string | null | undefined) {
  return String(value || 'UNKNOWN').replace(/_/g, ' ');
}

function tone(value?: string | null): 'good' | 'warn' | 'danger' | 'blue' | 'neutral' {
  if (value === 'CLEAR' || value === 'MARK_REVIEWED') return 'good';
  if (value?.includes('URGENT') || value?.includes('OVERDUE_30') || value === 'ON_HOLD') return 'danger';
  if (value?.includes('OVERDUE') || value?.includes('COLLECTION') || value?.includes('HOLD')) return 'warn';
  if (value?.includes('OPEN') || value?.includes('SEND') || value?.includes('DUE')) return 'blue';
  return 'neutral';
}

function priorityWeight(value?: string | null) {
  if (value === 'ON_HOLD') return 0;
  if (value === 'URGENT_COLLECTION') return 1;
  if (value === 'COLLECTION') return 2;
  if (value === 'SEND_STATEMENT') return 3;
  return 4;
}

function Pill({ children, tone: pillTone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'danger' | 'blue' | 'neutral' }) {
  return <span className={`accounts-pill accounts-pill-${pillTone}`}>{children}</span>;
}

function Metric({ label, value, helper, tone: metricTone = 'neutral' }: { label: string; value: string | number; helper: string; tone?: 'good' | 'warn' | 'danger' | 'blue' | 'neutral' }) {
  return <article className={`accounts-metric accounts-metric-${metricTone}`}><strong>{value}</strong><span>{label}</span><small>{helper}</small></article>;
}

function useAccountsHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    function locate() {
      const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((node) => node.textContent?.trim() === 'Reconciliation queue');
      const panel = heading?.closest<HTMLElement>('.panel');
      if (!panel) { setHost(null); return; }
      panel.classList.add('accounts-native-reconciliation-panel-soft-hide');
      let mount = document.querySelector<HTMLElement>('.accounts-statement-workbench-mount');
      if (!mount) { mount = document.createElement('section'); mount.className = 'accounts-statement-workbench-mount'; panel.insertAdjacentElement('beforebegin', mount); }
      setHost(mount);
    }
    const stopObserving = observeBody(locate);
    return stopObserving;
  }, []);
  return host;
}

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function CustomerRow({ row, selected, onSelect }: { row: AccountsStatementCustomerRow; selected: boolean; onSelect: () => void }) {
  return (
    <article className={`accounts-customer-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div><strong>{row.store_name || 'Unknown store'}</strong><span>{row.suburb || 'Suburb pending'} · {row.contact_phone || 'phone pending'}</span><small>{row.latest_action ? `${title(row.latest_action)} · ${dateText(row.latest_action_at)}` : 'No accounts action yet'}</small></div>
      <div><strong>{money(row.open_statement_value)}</strong><span>open</span></div>
      <div><strong>{money(row.overdue_statement_value)}</strong><span>overdue</span></div>
      <div><strong>{units(row.worst_overdue_days)}</strong><span>days</span></div>
      <Pill tone={tone(row.accounts_priority)}>{title(row.accounts_priority)}</Pill>
    </article>
  );
}

function InvoiceRow({ row }: { row: AccountsStatementLineRow }) {
  return (
    <article className="accounts-invoice-row">
      <div><strong>{row.invoice_number || 'No invoice'}</strong><span>{row.order_number || 'order pending'} · {dateText(row.order_ts)}</span></div>
      <span>{dateText(row.due_at)}</span>
      <strong>{money(row.invoice_value)}</strong>
      <span>{units(row.overdue_days)} days</span>
      <Pill tone={tone(row.accounts_signal)}>{title(row.accounts_signal)}</Pill>
    </article>
  );
}

function FollowupRow({ row }: { row: AccountsFollowupRow }) {
  return (
    <article className="accounts-followup-row">
      <div><strong>{row.store_name}</strong><span>{title(row.next_action)} · {row.contact_phone || 'phone pending'}</span></div>
      <span>{money(row.open_statement_value)}</span>
      <span>{money(row.overdue_statement_value)}</span>
      <Pill tone={tone(row.accounts_priority)}>{title(row.accounts_priority)}</Pill>
    </article>
  );
}

function CustomerDetail({ customer, lines, busy, onAction }: { customer?: AccountsStatementCustomerRow; lines: AccountsStatementLineRow[]; busy: string; onAction: (action: AccountsStatementAction, note?: string, value?: string) => void }) {
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [customer?.store_id]);
  if (!customer) return <section className="accounts-detail accounts-empty">Select a customer to review statement detail.</section>;
  return (
    <section className="accounts-detail">
      <section className="accounts-detail-hero">
        <div><span>STATEMENT DETAIL</span><h3>{customer.store_name}</h3><p>{customer.address || 'Address pending'} · {customer.contact_phone || 'phone pending'}</p></div>
        <Pill tone={tone(customer.accounts_priority)}>{title(customer.accounts_priority)}</Pill>
      </section>
      <section className="accounts-detail-metrics">
        <div><strong>{money(customer.open_statement_value)}</strong><span>open statement</span></div>
        <div><strong>{money(customer.overdue_statement_value)}</strong><span>overdue</span></div>
        <div><strong>{units(customer.open_invoice_count)}</strong><span>open invoices</span></div>
        <div><strong>{units(customer.worst_overdue_days)}</strong><span>worst days</span></div>
      </section>
      <section className="accounts-action-card">
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Accounts note, reminder, promised payment date, dispute reason…" />
        <div>
          <button type="button" disabled={busy === 'SEND_STATEMENT_DRAFT'} onClick={() => onAction('SEND_STATEMENT_DRAFT', note || 'Statement draft prepared')}>{busy === 'SEND_STATEMENT_DRAFT' ? 'Recording…' : 'Send statement draft'}</button>
          <button type="button" disabled={busy === 'MARK_REVIEWED'} onClick={() => onAction('MARK_REVIEWED', note || 'Statement reviewed')}>{busy === 'MARK_REVIEWED' ? 'Recording…' : 'Mark reviewed'}</button>
          <button type="button" disabled={busy === 'PROMISE_TO_PAY'} onClick={() => onAction('PROMISE_TO_PAY', note || 'Promise to pay recorded')}>{busy === 'PROMISE_TO_PAY' ? 'Recording…' : 'Promise to pay'}</button>
          <button type="button" disabled={busy === 'DISPUTE_RAISED'} onClick={() => onAction('DISPUTE_RAISED', note || 'Dispute raised')}>{busy === 'DISPUTE_RAISED' ? 'Recording…' : 'Dispute'}</button>
          <button type="button" disabled={busy === 'HOLD_ACCOUNT'} onClick={() => onAction('HOLD_ACCOUNT', note || 'Account hold recorded')}>{busy === 'HOLD_ACCOUNT' ? 'Recording…' : 'Hold account'}</button>
          <button type="button" disabled={busy === 'CLEAR_HOLD'} onClick={() => onAction('CLEAR_HOLD', note || 'Account hold cleared')}>{busy === 'CLEAR_HOLD' ? 'Recording…' : 'Clear hold'}</button>
        </div>
      </section>
      <section className="accounts-invoice-list">
        {lines.slice(0, 12).map((line) => <InvoiceRow key={`${line.internal_order_id}-${line.invoice_number}`} row={line} />)}
        {!lines.length ? <div className="accounts-empty">No statement lines for this customer.</div> : null}
      </section>
    </section>
  );
}

function AccountsContent() {
  const [kpis, setKpis] = useState<AccountsArKpis | null>(null);
  const [customers, setCustomers] = useState<AccountsStatementCustomerRow[]>([]);
  const [lines, setLines] = useState<AccountsStatementLineRow[]>([]);
  const [followups, setFollowups] = useState<AccountsFollowupRow[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PriorityFilter>('ALL');
  const [sort, setSort] = useState<CustomerSort>('priority');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');

  async function reload() {
    setError('');
    try {
      const [nextKpis, nextCustomers, nextLines, nextFollowups] = await Promise.all([loadAccountsArKpis(), loadAccountsStatementCustomers(), loadAccountsStatementLines(), loadAccountsFollowupQueue()]);
      setKpis(nextKpis); setCustomers(nextCustomers); setLines(nextLines); setFollowups(nextFollowups); setSelectedStoreId((current) => current || nextCustomers[0]?.store_id || ''); setLoadedAt(new Date().toISOString());
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  useEffect(() => { void reload(); }, []);

  const visibleCustomers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = customers.filter((customer) => {
      if (filter !== 'ALL' && customer.accounts_priority !== filter) return false;
      if (!needle) return true;
      return [customer.store_name, customer.suburb, customer.contact_phone, customer.invoice_count, customer.accounts_priority, customer.statement_signal, customer.latest_action, customer.top_sku_30d].filter(Boolean).join(' ').toLowerCase().includes(needle);
    });
    return [...filtered].sort((a, b) => {
      if (sort === 'open') return num(b.open_statement_value) - num(a.open_statement_value);
      if (sort === 'overdue') return num(b.overdue_statement_value) - num(a.overdue_statement_value);
      if (sort === 'recent') return new Date(b.latest_invoice_at || 0).getTime() - new Date(a.latest_invoice_at || 0).getTime();
      if (sort === 'name') return String(a.store_name || '').localeCompare(String(b.store_name || ''));
      return priorityWeight(a.accounts_priority) - priorityWeight(b.accounts_priority) || num(b.open_statement_value) - num(a.open_statement_value);
    });
  }, [customers, filter, query, sort]);

  const selectedCustomer = customers.find((customer) => customer.store_id === selectedStoreId) || visibleCustomers[0];
  const selectedLines = lines.filter((line) => line.store_id === selectedCustomer?.store_id);
  const latest = loadedAt ? new Date(loadedAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'loading';

  async function runAction(action: AccountsStatementAction, note?: string, value?: string) {
    if (!selectedCustomer?.store_id) return;
    setBusy(action); setError(''); setNotice('');
    try {
      const result = await recordAccountsStatementAction({ storeId: selectedCustomer.store_id, action, note, value });
      setNotice(`${selectedCustomer.store_name || selectedCustomer.store_id}: ${title(result[0]?.action_status || 'RECORDED')}.`);
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(''); }
  }

  async function exportCsv() {
    try {
      const rows = await loadAccountsStatementExportRows();
      downloadCsv(`ecoflow-statement-${new Date().toISOString().slice(0, 10)}.csv`, rows);
      setNotice(`${rows.length} statement rows exported.`);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  return (
    <section className="accounts-shell">
      <section className="accounts-hero"><div><span>ACCOUNTS STATEMENT WORKBENCH</span><h2>Statements, overdue risk and customer follow-up in one place.</h2><p>Built from imported invoices and store intelligence, with auditable accounts actions.</p></div><div className="accounts-actions"><button type="button" onClick={() => void reload()}>Refresh accounts</button><button type="button" onClick={() => void exportCsv()}>Export CSV</button><small>{latest}</small></div></section>
      {error ? <div className="accounts-error">{error}</div> : null}
      {notice ? <div className="accounts-notice">{notice}</div> : null}
      <section className="accounts-metrics"><Metric label="Open AR" value={money(kpis?.open_ar_value)} helper={`${units(kpis?.open_invoices)} open invoices`} tone="blue" /><Metric label="Overdue AR" value={money(kpis?.overdue_ar_value)} helper={`${units(kpis?.overdue_customers)} overdue customers`} tone={num(kpis?.overdue_ar_value) ? 'warn' : 'good'} /><Metric label="Urgent customers" value={units(kpis?.urgent_customers)} helper={`worst ${units(kpis?.worst_overdue_days)} days`} tone={num(kpis?.urgent_customers) ? 'danger' : 'good'} /><Metric label="30d statement" value={money(kpis?.statement_value_30d)} helper={`latest ${dateText(kpis?.latest_invoice_at)}`} tone="good" /></section>
      <section className="accounts-controlbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, phone, SKU, action…" /><select value={filter} onChange={(event) => setFilter(event.target.value as PriorityFilter)}><option value="ALL">All priorities</option><option value="URGENT_COLLECTION">Urgent collection</option><option value="COLLECTION">Collection</option><option value="SEND_STATEMENT">Send statement</option><option value="ON_HOLD">On hold</option><option value="CLEAR">Clear</option></select><select value={sort} onChange={(event) => setSort(event.target.value as CustomerSort)}><option value="priority">Sort by priority</option><option value="open">Sort by open value</option><option value="overdue">Sort by overdue</option><option value="recent">Most recent invoice</option><option value="name">Customer name</option></select></section>
      <section className="accounts-grid"><section className="accounts-panel"><header><div><h3>Customer statement queue</h3><p>Accounts ranked by collection risk and open value.</p></div><Pill tone="blue">{visibleCustomers.length}</Pill></header><div className="accounts-customer-list">{visibleCustomers.slice(0, 22).map((customer) => <CustomerRow key={customer.store_id || customer.store_name || Math.random()} row={customer} selected={customer.store_id === selectedCustomer?.store_id} onSelect={() => setSelectedStoreId(customer.store_id || '')} />)}{!visibleCustomers.length ? <div className="accounts-empty">No customers match this filter.</div> : null}</div></section><CustomerDetail customer={selectedCustomer} lines={selectedLines} busy={busy} onAction={runAction} /></section>
      <section className="accounts-panel"><header><div><h3>Follow-up queue</h3><p>What accounts should do next.</p></div><Pill tone={followups.length ? 'warn' : 'good'}>{followups.length}</Pill></header><div className="accounts-followup-list">{followups.slice(0, 12).map((row) => <FollowupRow key={`${row.store_id}-${row.next_action}`} row={row} />)}{!followups.length ? <div className="accounts-empty">No statement follow-up required.</div> : null}</div></section>
    </section>
  );
}

export function AccountsStatementWorkbench() {
  const host = useAccountsHost();
  return host ? createPortal(<AccountsContent />, host) : null;
}
