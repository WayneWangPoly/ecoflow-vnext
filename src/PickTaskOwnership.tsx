import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Clock3, LockKeyhole, Unlock } from 'lucide-react';
import { observeBody } from '@/lib/domObserver';
import { supabase } from '@/lib/supabaseClient';
import {
  claimPickTask,
  loadActivePickTaskClaims,
  releasePickTask,
  type PickTaskClaim,
} from '@/data/repositories/pickTaskClaims';

type TaskMount = {
  sku: string;
  card: HTMLElement;
  host: HTMLElement;
  done: boolean;
};

function adelaideToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Adelaide',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function activeBusinessDay() {
  const candidates: Array<{ day: string; active: boolean }> = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith('ecoflow-driver-day:')) continue;
    try {
      const state = JSON.parse(window.localStorage.getItem(key) || '{}') as { businessDay?: string; routeStartedAt?: string; routeEndedAt?: string };
      const day = state.businessDay || key.slice('ecoflow-driver-day:'.length);
      if (day) candidates.push({ day, active: Boolean(state.routeStartedAt && !state.routeEndedAt) });
    } catch {
      const day = key.slice('ecoflow-driver-day:'.length);
      if (day) candidates.push({ day, active: false });
    }
  }
  return candidates.sort((left, right) => Number(right.active) - Number(left.active) || right.day.localeCompare(left.day))[0]?.day || adelaideToday();
}

function taskSku(card: HTMLElement) {
  return card.querySelector<HTMLElement>('.pick-task-copy strong')?.textContent?.trim().toUpperCase() || '';
}

function sameMounts(left: TaskMount[], right: TaskMount[]) {
  return left.length === right.length && left.every((item, index) => {
    const candidate = right[index];
    return item.sku === candidate.sku && item.card === candidate.card && item.host === candidate.host && item.done === candidate.done;
  });
}

function expiryText(value: string) {
  const minutes = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 60000));
  return `${minutes}m`;
}

function TaskGate({ mount, claim, userId, busy, onClaim, onRelease, onBlocked }: {
  mount: TaskMount;
  claim?: PickTaskClaim;
  userId: string;
  busy: boolean;
  onClaim: () => void;
  onRelease: () => void;
  onBlocked: (message: string) => void;
}) {
  const own = Boolean(claim && claim.claimed_by === userId);
  const blocked = !mount.done && !own;

  useEffect(() => {
    const card = mount.card;
    card.classList.toggle('pick-task-claim-owned', own);
    card.classList.toggle('pick-task-claim-blocked', blocked);
    card.dataset.pickClaim = mount.done ? 'done' : own ? 'owned' : claim ? 'other' : 'unclaimed';

    const actionButtons = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).filter((button) => !button.closest('.pick-task-claim-mount'));
    actionButtons.forEach((button) => {
      if (blocked) {
        button.setAttribute('aria-disabled', 'true');
        button.dataset.pickClaimBlocked = 'true';
      } else if (button.dataset.pickClaimBlocked === 'true') {
        button.removeAttribute('aria-disabled');
        delete button.dataset.pickClaimBlocked;
      }
    });

    const intercept = (event: Event) => {
      if (!blocked) return;
      const target = event.target instanceof Element ? event.target.closest('button, a') : null;
      if (!target || target.closest('.pick-task-claim-mount')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onBlocked(claim ? `${mount.sku} is being picked by ${claim.claimed_by_label}.` : `Take ${mount.sku} before scanning or picking.`);
    };
    card.addEventListener('click', intercept, true);
    return () => {
      card.removeEventListener('click', intercept, true);
      card.classList.remove('pick-task-claim-owned', 'pick-task-claim-blocked');
      delete card.dataset.pickClaim;
      actionButtons.forEach((button) => {
        if (button.dataset.pickClaimBlocked === 'true') {
          button.removeAttribute('aria-disabled');
          delete button.dataset.pickClaimBlocked;
        }
      });
    };
  }, [mount, own, blocked, claim, onBlocked]);

  if (mount.done) {
    return (
      <div className="pick-claim-chip pick-claim-complete">
        <CheckCircle2 size={14} /> Completed
      </div>
    );
  }

  if (!claim) {
    return (
      <button type="button" className="pick-claim-button" disabled={busy || !userId} onClick={onClaim}>
        <LockKeyhole size={15} /> {busy ? 'Taking…' : 'Take task'}
      </button>
    );
  }

  if (own) {
    return (
      <div className="pick-claim-owned-row">
        <span className="pick-claim-chip pick-claim-yours"><CheckCircle2 size={14} /> Yours · {expiryText(claim.expires_at)}</span>
        <button type="button" className="pick-claim-release" disabled={busy} onClick={onRelease}><Unlock size={14} /> Release</button>
      </div>
    );
  }

  return (
    <div className="pick-claim-chip pick-claim-other">
      <Clock3 size={14} /> {claim.claimed_by_label} · {expiryText(claim.expires_at)}
    </div>
  );
}

export function PickTaskOwnership() {
  const [mounts, setMounts] = useState<TaskMount[]>([]);
  const [claims, setClaims] = useState<PickTaskClaim[]>([]);
  const [businessDay, setBusinessDay] = useState(activeBusinessDay);
  const [userId, setUserId] = useState('');
  const [actorLabel, setActorLabel] = useState('Warehouse operator');
  const [busySku, setBusySku] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const releasedCompletedRef = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    void supabase?.auth.getUser().then(({ data }) => {
      if (!active) return;
      const user = data.user;
      setUserId(user?.id || '');
      setActorLabel(String(user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email || 'Warehouse operator'));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function locate() {
      const day = activeBusinessDay();
      setBusinessDay((current) => current === day ? current : day);
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.pick-board .pick-task'));
      const next = cards.map((card) => {
        const sku = taskSku(card);
        if (!sku) return null;
        let host = card.querySelector<HTMLElement>(':scope > .pick-task-claim-mount');
        if (!host) {
          host = document.createElement('div');
          host.className = 'pick-task-claim-mount';
          card.prepend(host);
        }
        return { sku, card, host, done: card.classList.contains('done') } satisfies TaskMount;
      }).filter((item): item is TaskMount => Boolean(item));
      setMounts((current) => sameMounts(current, next) ? current : next);
    }
    return observeBody(locate);
  }, []);

  const reload = useCallback(async () => {
    if (!userId || !businessDay) return;
    try {
      const next = await loadActivePickTaskClaims(businessDay);
      setClaims(next);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [businessDay, userId]);

  useEffect(() => {
    if (!userId) return;
    void reload();
    const timer = window.setInterval(() => void reload(), 4000);
    window.addEventListener('online', reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', reload);
    };
  }, [reload, userId]);

  const claimBySku = useMemo(() => new Map(claims.map((claim) => [claim.task_key.toUpperCase(), claim])), [claims]);

  const take = useCallback(async (sku: string) => {
    if (!userId) {
      setError('Secure user identity is required before taking a pick task.');
      return;
    }
    setBusySku(sku);
    setError('');
    setNotice('');
    try {
      await claimPickTask({ businessDay, taskKey: sku, actorLabel, ttlMinutes: 30 });
      setNotice(`${sku} assigned to ${actorLabel}.`);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await reload();
    } finally {
      setBusySku('');
    }
  }, [actorLabel, businessDay, reload, userId]);

  const release = useCallback(async (sku: string, reason = 'Released by operator') => {
    setBusySku(sku);
    setError('');
    try {
      await releasePickTask({ businessDay, taskKey: sku, reason });
      setNotice(`${sku} released for another operator.`);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusySku('');
    }
  }, [businessDay, reload]);

  useEffect(() => {
    if (!userId) return;
    mounts.forEach((mount) => {
      const claim = claimBySku.get(mount.sku);
      const releaseKey = `${businessDay}:${mount.sku}`;
      if (!mount.done || claim?.claimed_by !== userId || releasedCompletedRef.current.has(releaseKey)) return;
      releasedCompletedRef.current.add(releaseKey);
      void releasePickTask({ businessDay, taskKey: mount.sku, reason: 'Pick task completed' })
        .then(reload)
        .catch(() => releasedCompletedRef.current.delete(releaseKey));
    });
  }, [businessDay, claimBySku, mounts, reload, userId]);

  useEffect(() => {
    if (!userId) return;
    const heartbeat = window.setInterval(() => {
      claims.filter((claim) => claim.claimed_by === userId).forEach((claim) => {
        void claimPickTask({ businessDay, taskKey: claim.task_key, actorLabel, ttlMinutes: 30 }).catch(() => undefined);
      });
    }, 8 * 60 * 1000);
    return () => window.clearInterval(heartbeat);
  }, [actorLabel, businessDay, claims, userId]);

  if (!mounts.length) return null;

  return (
    <>
      {mounts.map((mount) => createPortal(
        <TaskGate
          key={`${mount.sku}-${mount.done ? 'done' : 'open'}`}
          mount={mount}
          claim={claimBySku.get(mount.sku)}
          userId={userId}
          busy={busySku === mount.sku}
          onClaim={() => void take(mount.sku)}
          onRelease={() => void release(mount.sku)}
          onBlocked={setNotice}
        />,
        mount.host,
      ))}
      {(notice || error) && mounts[0] ? createPortal(
        <div className={`pick-claim-banner ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
          {error || notice}
        </div>,
        mounts[0].card.closest('.pick-stack') || mounts[0].card,
      ) : null}
    </>
  );
}
