import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import {
  createStatementDocument,
  dispatchStatement,
  loadAccountsArKpis,
  loadAccountsFollowupQueue,
  loadAccountsStatementCustomers,
  loadAccountsStatementExportRows,
  loadAccountsStatementLines,
  loadStatementDocuments,
  recordAccountsStatementAction,
  saveBillingContact,
  statementSignedUrl,
  type AccountsArKpis,
  type AccountsFollowupRow,
  type AccountsStatementAction,
  type AccountsStatementCustomerRow,
  type AccountsStatementLineRow,
  type StatementDocumentRow,
} from '@/data/repositories/accountsStatement';

type PriorityFilter = 'ALL' | 'URGENT_COLLECTION' | 'COLLECTION' | 'SEND_STATEMENT' | 'ON_HOLD' | 'CLEAR';
type CustomerSort = 'priority' | 'open' | 'overdue' | 'recent' | 'name';

function num(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function money(value: unknown) { return num(value).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 }); }
function units(value: unknown) { return num(value).toLocaleString('en-AU', { maximumFractionDigits: 0 }); }
function dateText(value?: string | null) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }); }
function title(value?: string | null) { return String(value || 'UNKNOWN').replace(/_/g, ' '); }
function tone(value?: string | null): 'good' | 'warn' | 'danger' | 'blue' | 'neutral' {
  if (value === 'CLEAR' || value === 'PAID' || value === 'SENT' || value === 'GENERATED') return 'good';
  if (value?.includes('URGENT') || value?.includes('30 PLUS') || value === 'ON_HOLD' || value === 'FAILED') return 'danger';
  if (value?.includes('OVERDUE') || value?.includes('COLLECTION') || value?.includes('HOLD') || value === 'CONFIGURATION_REQUIRED') return 'warn';
  if (value?.includes('OPEN') || value?.includes('SEND') || value?.includes('DUE') || value === 'DRAFT') return 'blue';
  return 'neutral';
}
function priorityWeight(value?: string | null) { return value === 'ON_HOLD' ? 0 : value === 'URGENT_COLLECTION' ? 1 : value === 'COLLECTION' ? 2 : value === 'SEND_STATEMENT' ? 3 : 4; }

function Pill({ children, tone: pillTone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'danger' | 'blue' | 'neutral' }) {
  return <span className={`accounts-pill accounts-pill-${pillTone}`}>{children}</span>;
}
function Metric({ label, value, helper, tone: metricTone = 'neutral' }: { label: string; value: string | number; helper: string; tone?: 'good' | 'warn' | 'danger' | 'blue' | 'neutral' }) {
  return <article className={`accounts-metric accounts-metric-${metricTone}`}><strong>{value}</strong><span>{label}</span><small>{helper}</small></article>;
}

function useAccountsHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => observeBody(() => {
    const heading = Array.from(document.querySelectorAll<HTMLElement>('h2')).find((node) => node.textContent?.trim() === 'Reconciliation queue');
    const panel = heading?.closest<HTMLElement>('.panel');
    if (!panel) { setHost(null); return; }
    panel.classList.add('accounts-native-reconciliation-panel-soft-hide');
    let mount = document.querySelector<HTMLElement>('.accounts-statement-workbench-mount');
    if (!mount) {
      mount = document.createElement('section');
      mount.className = 'accounts-statement-workbench-mount';
      panel.insertAdjacentElement('beforebegin', mount);
    }
    setHost(mount);
  }), []);
  return host;
}

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function CustomerRow({ row, selected, onSelect }: { row: AccountsStatementCustomerRow; selected: boolean; onSelect: () => void }) {
  return (
    <article className={`accounts-customer-row ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div><strong>{row.store_name || 'Unknown store'}</strong><span>{row.suburb || 'Suburb pending'} · {row.billing_email || row.contact_phone || 'billing delivery contact pending'}</span><small>{row.latest_action ? `${title(row.latest_action)} · ${dateText(row.latest_action_at)}` : 'No EcoFlow collection action yet'}</small></div>
      <div><strong>{money(row.open_statement_value)}</strong><span>source amount due</span></div>
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
      <strong>{money(row.outstanding_amount)}</strong>
      <span>{money(row.invoice_value)} invoice</span>
      <Pill tone={tone(row.accounts_signal)}>{title(row.accounts_signal)}</Pill>
    </article>
  );
}

function FollowupRow({ row }: { row: AccountsFollowupRow }) {
  return <article className="accounts-followup-row"><div><strong>{row.store_name}</strong><span>{title(row.next_action)} · {row.billing_email || row.contact_phone || 'contact pending'}</span></div><span>{money(row.open_statement_value)}</span><span>{money(row.overdue_statement_value)}</span><Pill tone={tone(row.accounts_priority)}>{title(row.accounts_priority)}</Pill></article>;
}

function StatementHistory({ documents, onOpen }: { documents: StatementDocumentRow[]; onOpen: (row: StatementDocumentRow) => void }) {
  return (
    <div className="accounts-document-list">
      {documents.slice(0, 12).map((row) => (
        <article key={row.id}>
          <div><strong>{row.statement_number}</strong><span>{dateText(row.period_start)} – {dateText(row.period_end)} · {row.line_count} lines</span></div>
          <strong>{money(row.closing_balance)}</strong>
          <Pill tone={tone(row.document_status)}>{title(row.document_status)}</Pill>
          {row.storage_path ? <button type="button" onClick={() => onOpen(row)}>Open PDF</button> : null}
          {row.error_message ? <small>{row.error_message}</small> : null}
        </article>
      ))}
      {!documents.length ? <p className="accounts-empty">No formal statement has been generated for this customer.</p> : null}
    </div>
  );
}

function CustomerDetail({ customer, lines, documents, busy, onAction, onReload }: {
  customer?: AccountsStatementCustomerRow;
  lines: AccountsStatementLineRow[];
  documents: StatementDocumentRow[];
  busy: string;
  onAction: (action: AccountsStatementAction, note?: string, value?: string) => void;
  onReload: () => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [periodStart, setPeriodStart] = useState(() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`; });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [localBusy, setLocalBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setNote('');
    setEmail(customer?.billing_email || '');
    setContact(customer?.billing_contact_name || '');
    setEmailEnabled(customer?.billing_enabled !== false);
    setMessage(''); setError('');
  }, [customer?.store_id]);

  if (!customer?.store_id) return <section className="accounts-detail accounts-empty">Select a customer to review mirrored invoice detail.</section>;

  async function saveContact() {
    setLocalBusy('contact'); setError('');
    try {
      await saveBillingContact({ storeId: customer!.store_id!, storeName: customer!.store_name || customer!.store_id!, email, contactName: contact, enabled: emailEnabled });
      setMessage('Statement delivery preference saved in EcoFlow. This does not change the Ordermentum customer master.');
      await onReload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLocalBusy(''); }
  }

  async function generate(send: boolean) {
    setLocalBusy(send ? 'send' : 'generate'); setError(''); setMessage('');
    try {
      const created = await createStatementDocument({ storeId: customer!.store_id!, periodStart, periodEnd });
      const statement = created[0];
      if (!statement?.id) throw new Error('Statement snapshot was not created.');
      const result = await dispatchStatement({ statementId: statement.id, send });
      setMessage(send ? `Statement ${statement.statement_number} processed: ${title(String(result.status || 'GENERATED'))}.` : `Statement ${statement.statement_number} PDF generated.`);
      await onReload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLocalBusy(''); }
  }

  async function openPdf(row: StatementDocumentRow) {
    if (!row.storage_path) return;
    try { window.open(await statementSignedUrl(row.storage_path), '_blank', 'noopener,noreferrer'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  return (
    <section className="accounts-detail">
      <section className="accounts-detail-hero"><div><span>ORDERMENTUM FINANCE MIRROR</span><h3>{customer.store_name}</h3><p>{customer.address || 'Address pending'} · invoice and payment facts are read-only</p></div><Pill tone={tone(customer.accounts_priority)}>{title(customer.accounts_priority)}</Pill></section>
      {error ? <div className="accounts-error">{error}</div> : null}{message ? <div className="accounts-notice">{message}</div> : null}
      <div className="accounts-notice">Invoice total, payment status, amount due and due date come from Ordermentum. Correct or record a payment there, then refresh this mirror.</div>
      <section className="accounts-detail-metrics"><div><strong>{money(customer.open_statement_value)}</strong><span>mirrored amount due</span></div><div><strong>{money(customer.overdue_statement_value)}</strong><span>overdue</span></div><div><strong>{units(customer.open_invoice_count)}</strong><span>open invoices</span></div><div><strong>{units(customer.worst_overdue_days)}</strong><span>worst days</span></div></section>
      <section className="accounts-commercial-grid">
        <div className="accounts-form-card"><h4>Statement delivery preference</h4><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="accounts@customer.com"/><input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="Contact name (optional)"/><label><input type="checkbox" checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)}/> Enable EcoFlow statement email</label><button type="button" disabled={localBusy === 'contact'} onClick={() => void saveContact()}>Save delivery preference</button></div>
        <div className="accounts-form-card"><h4>Formal statement</h4><label>Period start<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)}/></label><label>Period end<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)}/></label><div><button type="button" disabled={Boolean(localBusy)} onClick={() => void generate(false)}>Generate PDF</button><button type="button" disabled={Boolean(localBusy) || !emailEnabled || !email} onClick={() => void generate(true)}>Generate &amp; send</button></div></div>
      </section>
      <section className="accounts-action-card"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="EcoFlow collection note, promise, dispute or operational hold reason…"/><div><button type="button" disabled={busy === 'MARK_REVIEWED'} onClick={() => onAction('MARK_REVIEWED', note || 'Statement reviewed')}>Mark reviewed</button><button type="button" disabled={busy === 'PROMISE_TO_PAY'} onClick={() => onAction('PROMISE_TO_PAY', note || 'Promise to pay recorded')}>Promise to pay</button><button type="button" disabled={busy === 'DISPUTE_RAISED'} onClick={() => onAction('DISPUTE_RAISED', note || 'Dispute raised')}>Dispute</button><button type="button" disabled={busy === 'HOLD_ACCOUNT'} onClick={() => onAction('HOLD_ACCOUNT', note || 'Operational release hold recorded')}>Hold release</button><button type="button" disabled={busy === 'CLEAR_HOLD'} onClick={() => onAction('CLEAR_HOLD', note || 'Operational release hold cleared')}>Clear hold</button></div></section>
      <section className="accounts-invoice-list">{lines.filter((line) => num(line.outstanding_amount) > 0).slice(0, 24).map((line) => <InvoiceRow key={`${line.internal_order_id}-${line.invoice_number}`} row={line}/>)}{!lines.some((line) => num(line.outstanding_amount) > 0) ? <div className="accounts-empty">No outstanding mirrored invoices.</div> : null}</section>
      <section className="accounts-history-grid"><div><h4>Statement history</h4><StatementHistory documents={documents} onOpen={openPdf}/></div></section>
    </section>
  );
}

function AccountsContent() {
  const [kpis, setKpis] = useState<AccountsArKpis | null>(null);
  const [customers, setCustomers] = useState<AccountsStatementCustomerRow[]>([]);
  const [lines, setLines] = useState<AccountsStatementLineRow[]>([]);
  const [followups, setFollowups] = useState<AccountsFollowupRow[]>([]);
  const [documents, setDocuments] = useState<StatementDocumentRow[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PriorityFilter>('ALL');
  const [sort, setSort] = useState<CustomerSort>('priority');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [latest, setLatest] = useState('');

  async function reload() {
    setError('');
    try {
      const [nextKpis, nextCustomers, nextLines, nextFollowups, nextDocuments] = await Promise.all([
        loadAccountsArKpis(), loadAccountsStatementCustomers(), loadAccountsStatementLines(), loadAccountsFollowupQueue(), loadStatementDocuments(),
      ]);
      setKpis(nextKpis); setCustomers(nextCustomers); setLines(nextLines); setFollowups(nextFollowups); setDocuments(nextDocuments);
      setSelectedStoreId((current) => current || nextCustomers[0]?.store_id || '');
      setLatest(new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  useEffect(() => { void reload(); }, []);

  const visibleCustomers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = customers.filter((customer) => (filter === 'ALL' || customer.accounts_priority === filter)
      && (!needle || [customer.store_name, customer.suburb, customer.contact_phone, customer.billing_email, customer.top_sku_30d, customer.latest_action].filter(Boolean).join(' ').toLowerCase().includes(needle)));
    return [...filtered].sort((left, right) => sort === 'open' ? num(right.open_statement_value) - num(left.open_statement_value)
      : sort === 'overdue' ? num(right.overdue_statement_value) - num(left.overdue_statement_value)
        : sort === 'recent' ? new Date(right.latest_invoice_at || 0).getTime() - new Date(left.latest_invoice_at || 0).getTime()
          : sort === 'name' ? String(left.store_name).localeCompare(String(right.store_name))
            : priorityWeight(left.accounts_priority) - priorityWeight(right.accounts_priority) || num(right.open_statement_value) - num(left.open_statement_value));
  }, [customers, filter, query, sort]);

  const selectedCustomer = customers.find((customer) => customer.store_id === selectedStoreId) || visibleCustomers[0];
  const selectedLines = lines.filter((line) => line.store_id === selectedCustomer?.store_id);
  const selectedDocs = documents.filter((document) => document.store_id === selectedCustomer?.store_id);

  async function runAction(action: AccountsStatementAction, note?: string, value?: string) {
    if (!selectedCustomer?.store_id) return;
    setBusy(action); setError('');
    try {
      const result = await recordAccountsStatementAction({ storeId: selectedCustomer.store_id, action, note, value });
      setNotice(`${selectedCustomer.store_name}: ${title(result[0]?.action_status || 'RECORDED')}.`);
      await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  }

  async function exportCsv() {
    try {
      const rows = await loadAccountsStatementExportRows();
      downloadCsv(`ecoflow-ordermentum-finance-mirror-${new Date().toISOString().slice(0, 10)}.csv`, rows);
      setNotice(`${rows.length} mirrored invoice rows exported.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  return (
    <section className="accounts-shell">
      <section className="accounts-hero"><div><span>ACCOUNTS · VERIFIED ORDERMENTUM MIRROR</span><h2>Invoice truth from Ordermentum. Workflow and statements in EcoFlow.</h2><p>EcoFlow does not edit invoices, mark payments or allocate substitute receipts. It mirrors amount due and supports collection notes, release holds and immutable statement documents.</p></div><div className="accounts-actions"><button type="button" onClick={() => void reload()}>Refresh mirror</button><button type="button" onClick={() => void exportCsv()}>Export CSV</button><small>{latest}</small></div></section>
      {error ? <div className="accounts-error">{error}</div> : null}{notice ? <div className="accounts-notice">{notice}</div> : null}
      <section className="accounts-metrics"><Metric label="Open AR" value={money(kpis?.open_ar_value)} helper={`${units(kpis?.open_invoices)} mirrored open invoices`} tone="blue"/><Metric label="Overdue AR" value={money(kpis?.overdue_ar_value)} helper={`${units(kpis?.overdue_customers)} overdue customers`} tone={num(kpis?.overdue_ar_value) ? 'warn' : 'good'}/><Metric label="Urgent customers" value={units(kpis?.urgent_customers)} helper={`worst ${units(kpis?.worst_overdue_days)} days`} tone={num(kpis?.urgent_customers) ? 'danger' : 'good'}/><Metric label="30d invoiced" value={money(kpis?.statement_value_30d)} helper={`latest ${dateText(kpis?.latest_invoice_at)}`} tone="good"/></section>
      <section className="accounts-controlbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, statement contact, phone or SKU"/><select value={filter} onChange={(event) => setFilter(event.target.value as PriorityFilter)}><option value="ALL">All priorities</option><option value="URGENT_COLLECTION">Urgent collection</option><option value="COLLECTION">Collection</option><option value="SEND_STATEMENT">Send statement</option><option value="ON_HOLD">On hold</option><option value="CLEAR">Clear</option></select><select value={sort} onChange={(event) => setSort(event.target.value as CustomerSort)}><option value="priority">Sort by priority</option><option value="open">Sort by open value</option><option value="overdue">Sort by overdue</option><option value="recent">Most recent invoice</option><option value="name">Customer name</option></select></section>
      <section className="accounts-grid"><section className="accounts-panel"><header><div><h3>Customer statement queue</h3><p>Balances reflect the latest mirrored Ordermentum amount due.</p></div><Pill tone="blue">{visibleCustomers.length}</Pill></header><div className="accounts-customer-list">{visibleCustomers.slice(0, 50).map((customer) => <CustomerRow key={customer.store_id || customer.store_name || 'unknown'} row={customer} selected={customer.store_id === selectedCustomer?.store_id} onSelect={() => setSelectedStoreId(customer.store_id || '')}/>)}{!visibleCustomers.length ? <div className="accounts-empty">No customers match this filter.</div> : null}</div></section><CustomerDetail customer={selectedCustomer} lines={selectedLines} documents={selectedDocs} busy={busy} onAction={runAction} onReload={reload}/></section>
      <section className="accounts-panel"><header><div><h3>Follow-up queue</h3><p>EcoFlow collection and statement actions based on mirrored finance facts.</p></div><Pill tone={followups.length ? 'warn' : 'good'}>{followups.length}</Pill></header><div className="accounts-followup-list">{followups.slice(0, 20).map((row) => <FollowupRow key={row.store_id || row.store_name || 'unknown'} row={row}/>)}{!followups.length ? <div className="accounts-empty">No accounts follow-up is required.</div> : null}</div></section>
    </section>
  );
}

export function AccountsStatementWorkbench() {
  const host = useAccountsHost();
  return host ? createPortal(<AccountsContent />, host) : null;
}
