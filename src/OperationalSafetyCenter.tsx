import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { observeBody } from '@/lib/domObserver';
import { supabase } from '@/lib/supabaseClient';
import {
  clearOperationalActions,
  clearOperationalSession,
  readOperationalActions,
  recordOperationalAction,
  subscribeOperationalActions,
  type OperationalActionRecord,
} from '@/operational/operationalActionJournal';
import './operationalSafetyCenter.css';

type GuardedAction = {
  title: string;
  actionLabel: string;
  entity: string;
  count: number;
  objects: string[];
  impacts: string[];
  confirmToken?: string;
  suppressNativeConfirm?: boolean;
};

type PendingAction = {
  spec: GuardedAction;
  proceed: () => void;
};

const bypassButtons = new WeakSet<HTMLButtonElement>();
const bypassForms = new WeakSet<HTMLFormElement>();
const bypassSelects = new WeakSet<HTMLSelectElement>();

function clean(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values: string[]) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function firstText(root: Element | null, selectors: string) {
  return clean(root?.querySelector<HTMLElement>(selectors)?.textContent);
}

function rowObjects(root: Element | null) {
  if (!root) return [];
  return unique(Array.from(root.querySelectorAll<HTMLElement>('.order-list-item input:checked, .table-row input:checked'))
    .map((input) => firstText(input.closest('.order-list-item, .table-row'), 'strong')));
}

function guardedForm(form: HTMLFormElement) {
  return form.matches('.team-create-row, .team-password-row');
}

function buttonSpec(button: HTMLButtonElement): GuardedAction | null {
  const label = clean(button.textContent || button.getAttribute('aria-label'));
  if (!label || button.disabled) return null;
  if (button.type === 'submit' && button.form && guardedForm(button.form)) return null;

  if (/^release to run$/i.test(label)) {
    const row = button.closest('.table-row');
    const order = firstText(row, 'strong') || 'Selected order';
    const store = firstText(row, 'span:nth-child(2) strong');
    return {
      title: 'Release order to today’s run',
      actionLabel: 'Release to run',
      entity: order,
      count: 1,
      objects: [store ? `${order} · ${store}` : order],
      impacts: [
        'The order becomes visible to warehouse picking and route planning.',
        'This does not deduct stock or start the driver route.',
      ],
    };
  }

  const releaseMatch = label.match(/^release\s+(\d+)$/i);
  if (releaseMatch) {
    const count = Number(releaseMatch[1]);
    const panel = button.closest('.panel');
    const objects = rowObjects(panel);
    return {
      title: 'Release selected orders to today’s run',
      actionLabel: label,
      entity: `${count} selected orders`,
      count,
      objects,
      impacts: [
        'Every selected order enters the shared warehouse and delivery run.',
        'Only orders already passing the release gate are included.',
      ],
      confirmToken: count > 1 ? `RELEASE ${count}` : undefined,
    };
  }

  if (/^lock route$/i.test(label)) {
    const workspace = button.closest('.workspace-stack');
    const countText = firstText(workspace, '.quick-stats .metric-card strong');
    const count = Number(countText) || workspace?.querySelectorAll('.route-order-row, .route-stop-row').length || 0;
    return {
      title: 'Lock the warehouse and driver route',
      actionLabel: 'Lock route',
      entity: count ? `${count} stops` : 'Current delivery run',
      count,
      objects: unique(Array.from(workspace?.querySelectorAll<HTMLElement>('.route-order-row strong, .route-stop-row strong') || []).map((node) => node.textContent || '')).slice(0, 12),
      impacts: [
        'Stop order and box codes become the shared picking plan.',
        'Labels printed after this point depend on the locked order.',
      ],
    };
  }

  if (/^unlock(?: route)?$/i.test(label)) {
    return {
      title: 'Unlock the current route',
      actionLabel: label,
      entity: 'Current delivery run',
      count: 1,
      objects: [],
      impacts: [
        'Printed labels become invalid and must be reprinted.',
        'Unlocking is blocked after picking, staging or route execution has started.',
      ],
      confirmToken: 'UNLOCK',
      suppressNativeConfirm: true,
    };
  }

  if (/^start next delivery run$/i.test(label)) {
    const title = firstText(button.closest('.panel'), 'h2') || 'Completed run';
    return {
      title: 'Start the next delivery run',
      actionLabel: label,
      entity: title,
      count: 1,
      objects: [],
      impacts: [
        'The completed run remains in server history.',
        'Newly released orders will belong to the new run code.',
      ],
      confirmToken: 'NEXT RUN',
      suppressNativeConfirm: true,
    };
  }

  if (/^generate\s*&\s*send$/i.test(label)) {
    const detail = button.closest('.accounts-detail');
    const customer = firstText(detail, '.accounts-detail-hero h3') || 'Selected customer';
    const email = (detail?.querySelector<HTMLInputElement>('input[type="email"]')?.value || '').trim();
    const dates = Array.from(detail?.querySelectorAll<HTMLInputElement>('input[type="date"]') || []).map((input) => input.value).filter(Boolean);
    return {
      title: 'Generate and send customer statement',
      actionLabel: label,
      entity: customer,
      count: 1,
      objects: [email || 'No recipient email', dates.length === 2 ? `${dates[0]} → ${dates[1]}` : 'Selected statement period'],
      impacts: [
        'A statement snapshot and PDF will be created.',
        'The email dispatch is attempted immediately after generation.',
      ],
    };
  }

  if (/^(suspend|activate)$/i.test(label)) {
    const entry = button.closest('.team-account-entry');
    const email = firstText(entry, '.team-account-row small') || firstText(entry, '.team-account-row strong') || 'Selected account';
    const suspend = /^suspend$/i.test(label);
    return {
      title: suspend ? 'Suspend team account' : 'Activate team account',
      actionLabel: label,
      entity: email.replace(/\s*·\s*YOU$/i, ''),
      count: 1,
      objects: [],
      impacts: [suspend ? 'The user will lose application access.' : 'The user will regain application access.', 'The account record and audit history remain available.'],
      confirmToken: suspend ? 'SUSPEND' : undefined,
    };
  }

  if (/^(delete|remove|clear all|reset layout|reset warehouse layout|archive all)$/i.test(label)) {
    const entity = firstText(button.closest('.panel, article, section'), 'h2, h3, strong') || 'Selected records';
    return {
      title: label,
      actionLabel: label,
      entity,
      count: 1,
      objects: [],
      impacts: ['This action may remove, reset or archive operational state.', 'Review the selected object before continuing.'],
      confirmToken: 'CONFIRM',
    };
  }

  return null;
}

function formSpec(form: HTMLFormElement): GuardedAction | null {
  if (form.matches('.team-create-row')) {
    const email = form.querySelector<HTMLInputElement>('input[type="email"]')?.value.trim() || 'New account';
    const role = form.querySelector<HTMLSelectElement>('select')?.value || 'Role pending';
    return {
      title: 'Create team login',
      actionLabel: 'Create account',
      entity: email,
      count: 1,
      objects: [role],
      impacts: ['The login can access EcoFlow immediately with the selected role.', 'The email is an internal login identifier and does not need a working inbox.'],
    };
  }
  if (form.matches('.team-password-row')) {
    const email = firstText(form, 'strong').replace(/^new password for\s+/i, '') || 'Selected account';
    return {
      title: 'Reset team account password',
      actionLabel: 'Save password',
      entity: email,
      count: 1,
      objects: [],
      impacts: ['The previous password stops working immediately.', 'Existing access role and account history are unchanged.'],
    };
  }
  return null;
}

function roleChangeSpec(select: HTMLSelectElement, previousRole: string, nextRole: string): GuardedAction {
  const entry = select.closest('.team-account-entry');
  const email = firstText(entry, '.team-account-row small') || firstText(entry, '.team-account-row strong') || 'Selected account';
  return {
    title: 'Change team role',
    actionLabel: `${previousRole} → ${nextRole}`,
    entity: email.replace(/\s*·\s*YOU$/i, ''),
    count: 1,
    objects: [`Current: ${previousRole}`, `New: ${nextRole}`],
    impacts: ['Navigation, read access and write permissions change immediately.', 'The account remains active unless its status is changed separately.'],
    confirmToken: nextRole === 'OWNER' ? 'OWNER' : undefined,
  };
}

function feedbackEntity(element: HTMLElement) {
  const customerWindow = element.closest('.industrial-customer-work-window');
  if (customerWindow) return firstText(customerWindow, ':scope > header strong') || 'Customer';
  const accounts = element.closest('.accounts-detail');
  if (accounts) return firstText(accounts, '.accounts-detail-hero h3') || 'Accounts';
  const team = element.closest('.team-account-entry, .team-access-direct');
  if (team) return firstText(team, '.team-account-row small, .system-workspace-bar span') || 'System';
  const panel = element.closest('.panel, .driver-card, .pick-task');
  return firstText(panel, 'h2, h3, strong') || 'EcoFlow';
}

function actionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusTone(status: OperationalActionRecord['status']) {
  if (status === 'SUCCEEDED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'CANCELLED') return 'muted';
  if (status === 'CONFIRMED') return 'confirmed';
  return 'info';
}

export function OperationalSafetyCenter() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [rows, setRows] = useState<OperationalActionRecord[]>(readOperationalActions);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [token, setToken] = useState('');
  const feedbackSeen = useRef(new WeakMap<HTMLElement, string>());

  const failedCount = useMemo(() => rows.filter((row) => row.status === 'FAILED').length, [rows]);
  const canConfirm = Boolean(pending && acknowledged && (!pending.spec.confirmToken || token.trim().toUpperCase() === pending.spec.confirmToken));

  function ask(spec: GuardedAction, proceed: () => void) {
    recordOperationalAction({ action: spec.actionLabel, entity: spec.entity, detail: `Review requested · ${spec.count} affected`, status: 'REQUESTED' });
    setAcknowledged(false);
    setToken('');
    setPending({ spec, proceed });
  }

  function cancelPending() {
    if (pending) recordOperationalAction({ action: pending.spec.actionLabel, entity: pending.spec.entity, detail: 'Cancelled before execution', status: 'CANCELLED' });
    setPending(null);
  }

  function confirmPending() {
    if (!pending || !canConfirm) return;
    const current = pending;
    recordOperationalAction({ action: current.spec.actionLabel, entity: current.spec.entity, detail: `${current.spec.count} affected · user confirmed`, status: 'CONFIRMED' });
    setPending(null);
    current.proceed();
  }

  useEffect(() => subscribeOperationalActions(setRows), []);

  useEffect(() => {
    function syncMount() {
      const actions = document.querySelector<HTMLElement>('.topbar-actions');
      if (!actions) return;
      let node = actions.querySelector<HTMLElement>(':scope > .operational-actions-mount');
      if (!node) {
        node = document.createElement('div');
        node.className = 'operational-actions-mount';
        actions.insertBefore(node, actions.lastElementChild);
      }
      setMount(node);
    }
    const stop = observeBody(syncMount);
    syncMount();
    return () => {
      stop();
      document.querySelector('.operational-actions-mount')?.remove();
    };
  }, []);

  useEffect(() => {
    function onFocus(event: FocusEvent) {
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.matches('.team-account-row select')) {
        target.dataset.operationalPreviousValue = target.value;
      }
    }

    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest<HTMLButtonElement>('button');
      if (!button) return;
      if (/^logout$/i.test(clean(button.textContent))) clearOperationalSession();
      if (bypassButtons.has(button)) {
        bypassButtons.delete(button);
        return;
      }
      const spec = buttonSpec(button);
      if (!spec) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      ask(spec, () => {
        bypassButtons.add(button);
        const originalConfirm = window.confirm;
        if (spec.suppressNativeConfirm) window.confirm = () => true;
        try { button.click(); }
        finally { window.confirm = originalConfirm; }
      });
    }

    function onSubmit(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !guardedForm(form)) return;
      if (bypassForms.has(form)) {
        bypassForms.delete(form);
        return;
      }
      const spec = formSpec(form);
      if (!spec) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const submitter = event.submitter instanceof HTMLButtonElement ? event.submitter : form.querySelector<HTMLButtonElement>('button[type="submit"]');
      ask(spec, () => {
        bypassForms.add(form);
        form.requestSubmit(submitter || undefined);
      });
    }

    function onChange(event: Event) {
      const select = event.target;
      if (!(select instanceof HTMLSelectElement) || !select.matches('.team-account-row select')) return;
      if (bypassSelects.has(select)) {
        bypassSelects.delete(select);
        select.dataset.operationalPreviousValue = select.value;
        return;
      }
      const previous = select.dataset.operationalPreviousValue || select.defaultValue || select.value;
      const next = select.value;
      if (previous === next) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      select.value = previous;
      ask(roleChangeSpec(select, previous, next), () => {
        bypassSelects.add(select);
        select.value = next;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('change', onChange, true);
    return () => {
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('change', onChange, true);
    };
  }, []);

  useEffect(() => {
    const selector = [
      '.success-message',
      '.error-message',
      '.accounts-notice',
      '.accounts-error',
      '.customer-ops-notice',
      '.customer-ops-error',
      '.pick-persist-message',
      '.pick-persist-error',
      '.sync-error-banner',
    ].join(',');

    function captureFeedback() {
      document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        const text = clean(element.textContent);
        if (!text || /loading|checking|please wait/i.test(text)) return;
        if (feedbackSeen.current.get(element) === text) return;
        feedbackSeen.current.set(element, text);
        const failed = element.matches('.error-message, .accounts-error, .customer-ops-error, .pick-persist-error, .sync-error-banner')
          || /failed|not saved|unavailable|error|denied/i.test(text);
        recordOperationalAction({
          action: failed ? 'Operation failed' : 'Operation completed',
          entity: feedbackEntity(element),
          detail: text,
          status: failed ? 'FAILED' : 'SUCCEEDED',
        });
      });
    }

    const stop = observeBody(captureFeedback);
    captureFeedback();
    return stop;
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) clearOperationalSession();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const topbar = mount ? createPortal(
    <button type="button" className="operational-actions-button" onClick={() => setRecentOpen((value) => !value)} aria-expanded={recentOpen}>
      <History size={15} />
      <span>Recent actions</span>
      {failedCount ? <b>{failedCount}</b> : rows.length ? <i>{Math.min(rows.length, 99)}</i> : null}
    </button>,
    mount,
  ) : null;

  const recentPanel = recentOpen ? createPortal(
    <aside className="operational-recent-panel" aria-label="Recent operational actions">
      <header>
        <div><Clock3 size={16} /><strong>Recent actions</strong><span>This login session</span></div>
        <div>
          <button type="button" onClick={() => clearOperationalActions()} disabled={!rows.length} aria-label="Clear recent actions"><Trash2 size={15} /></button>
          <button type="button" onClick={() => setRecentOpen(false)} aria-label="Close recent actions"><X size={16} /></button>
        </div>
      </header>
      <div className="operational-recent-list">
        {rows.map((row) => (
          <article key={row.id} className={`operational-action-${statusTone(row.status)}`}>
            <i>{row.status === 'SUCCEEDED' ? <CheckCircle2 size={14} /> : row.status === 'FAILED' ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}</i>
            <div><strong>{row.action}</strong><span>{row.entity}</span><small>{row.detail || row.status} · {actionTime(row.at)}</small></div>
            <b>{row.status}</b>
          </article>
        ))}
        {!rows.length ? <div className="operational-actions-empty">No operational actions in this session.</div> : null}
      </div>
    </aside>,
    document.body,
  ) : null;

  const confirmation = pending ? createPortal(
    <div className="operational-confirm-backdrop" role="presentation">
      <section className="operational-confirm-dialog" role="dialog" aria-modal="true" aria-label={pending.spec.title}>
        <header>
          <div><ShieldCheck size={19} /><span>OPERATIONAL REVIEW</span><strong>{pending.spec.title}</strong></div>
          <button type="button" onClick={cancelPending} aria-label="Cancel"><X size={18} /></button>
        </header>
        <div className="operational-confirm-summary">
          <div><span>Affected</span><strong>{pending.spec.count}</strong></div>
          <div><span>Target</span><strong>{pending.spec.entity}</strong></div>
        </div>
        {pending.spec.objects.length ? (
          <div className="operational-confirm-objects">
            {pending.spec.objects.slice(0, 12).map((item) => <span key={item}>{item}</span>)}
            {pending.spec.objects.length > 12 ? <span>+{pending.spec.objects.length - 12} more</span> : null}
          </div>
        ) : null}
        <div className="operational-confirm-impact">
          {pending.spec.impacts.map((impact) => <p key={impact}><AlertTriangle size={14} />{impact}</p>)}
        </div>
        <label className="operational-confirm-check">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>I reviewed the affected object and impact.</span>
        </label>
        {pending.spec.confirmToken ? (
          <label className="operational-confirm-token">
            <span>Type <b>{pending.spec.confirmToken}</b> to continue</span>
            <input value={token} onChange={(event) => setToken(event.target.value.toUpperCase())} autoFocus />
          </label>
        ) : null}
        <footer>
          <button type="button" onClick={cancelPending}>Cancel</button>
          <button type="button" className="primary" disabled={!canConfirm} onClick={confirmPending}>{pending.spec.actionLabel}</button>
        </footer>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{topbar}{recentPanel}{confirmation}</>;
}
