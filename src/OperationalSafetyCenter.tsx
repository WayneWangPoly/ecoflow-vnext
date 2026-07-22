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
  cleanOperationalText,
  guardedButtonSpec,
  guardedForm,
  guardedFormSpec,
  guardedRoleChangeSpec,
  type GuardedAction,
} from '@/operational/guardedActionSpecs';
import {
  clearOperationalActions,
  clearOperationalSession,
  readOperationalActions,
  recordOperationalAction,
  subscribeOperationalActions,
  type OperationalActionRecord,
} from '@/operational/operationalActionJournal';
import './operationalSafetyCenter.css';

type PendingAction = {
  spec: GuardedAction;
  proceed: () => void;
};

const bypassButtons = new WeakSet<HTMLButtonElement>();
const bypassForms = new WeakSet<HTMLFormElement>();
const bypassSelects = new WeakSet<HTMLSelectElement>();

function firstText(root: Element | null, selectors: string) {
  return cleanOperationalText(root?.querySelector<HTMLElement>(selectors)?.textContent);
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
  const objectPreviewComplete = Boolean(
    !pending?.spec.requireExactObjects
    || (pending.spec.count > 0 && pending.spec.objects.length === pending.spec.count),
  );
  const canConfirm = Boolean(
    pending
    && objectPreviewComplete
    && acknowledged
    && (!pending.spec.confirmToken || token.trim().toUpperCase() === pending.spec.confirmToken),
  );

  function ask(spec: GuardedAction, proceed: () => void) {
    recordOperationalAction({
      action: spec.actionLabel,
      entity: spec.entity,
      detail: `Review requested · ${spec.count} affected`,
      status: 'REQUESTED',
    });
    setAcknowledged(false);
    setToken('');
    setPending({ spec, proceed });
  }

  function cancelPending() {
    if (pending) {
      recordOperationalAction({
        action: pending.spec.actionLabel,
        entity: pending.spec.entity,
        detail: 'Cancelled before execution',
        status: 'CANCELLED',
      });
    }
    setPending(null);
  }

  function confirmPending() {
    if (!pending || !canConfirm) return;
    const current = pending;
    recordOperationalAction({
      action: current.spec.actionLabel,
      entity: current.spec.entity,
      detail: `${current.spec.count} affected · user confirmed`,
      status: 'CONFIRMED',
    });
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
    function capturePreviousRole(event: Event) {
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
      if (/^logout$/i.test(cleanOperationalText(button.textContent))) clearOperationalSession();
      if (bypassButtons.has(button)) {
        bypassButtons.delete(button);
        return;
      }
      const spec = guardedButtonSpec(button);
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
      const spec = guardedFormSpec(form);
      if (!spec) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const submitter = event.submitter instanceof HTMLButtonElement
        ? event.submitter
        : form.querySelector<HTMLButtonElement>('button[type="submit"]');
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
      const previous = select.dataset.operationalPreviousValue;
      const next = select.value;
      if (!previous || previous === next) {
        select.dataset.operationalPreviousValue = next;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      select.value = previous;
      ask(guardedRoleChangeSpec(select, previous, next), () => {
        bypassSelects.add(select);
        select.value = next;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    document.addEventListener('focusin', capturePreviousRole, true);
    document.addEventListener('pointerdown', capturePreviousRole, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('change', onChange, true);
    return () => {
      document.removeEventListener('focusin', capturePreviousRole, true);
      document.removeEventListener('pointerdown', capturePreviousRole, true);
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
        const text = cleanOperationalText(element.textContent);
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
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (pending) cancelPending();
      else if (recentOpen) setRecentOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pending, recentOpen]);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) clearOperationalSession();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const topbar = mount ? createPortal(
    <button
      type="button"
      className="operational-actions-button"
      onClick={() => setRecentOpen((value) => !value)}
      aria-expanded={recentOpen}
    >
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
        {!objectPreviewComplete ? (
          <div className="operational-confirm-preview-error" role="alert">
            The interface could not enumerate all {pending.spec.count} affected records. Close this review, refresh the queue and select the records again.
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
