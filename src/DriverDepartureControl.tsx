import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Mail, MapPin, ShieldCheck, X } from 'lucide-react';
import {
  DRIVER_DEPARTURE_DECLARATION,
  DRIVER_DEPARTURE_POLICY_VERSION,
  loadDepartureAcknowledgement,
  notifyRouteStarted,
  recordDepartureAcknowledgement,
  type DriverDepartureChecks,
  type RouteNotificationResult,
} from '@/data/repositories/driverDeparture';
import { supabase } from '@/lib/supabaseClient';
import type { DriverDayState } from '@/domain/driverRun';

const STORAGE_PREFIX = 'ecoflow-driver-day:';
const PENDING_ACK_PREFIX = 'ecoflow-departure-ack-pending:';

type PendingAck = {
  businessDay: string;
  routeId: string;
  typedName: string;
  checks: DriverDepartureChecks;
  locationConsent: boolean;
  driverLabel?: string;
};

function pendingAckKey(businessDay: string, route: string) {
  return `${PENDING_ACK_PREFIX}${businessDay}:${route}`;
}

let flushingAcks = false;

/** Push offline-queued departure declarations to the database once connectivity returns. */
async function flushPendingAcknowledgements() {
  if (flushingAcks || !navigator.onLine) return;
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(PENDING_ACK_PREFIX)) keys.push(key);
  }
  if (!keys.length) return;
  flushingAcks = true;
  try {
    for (const key of keys) {
      try {
        const pending = JSON.parse(window.localStorage.getItem(key) || 'null') as PendingAck | null;
        if (!pending) {
          window.localStorage.removeItem(key);
          continue;
        }
        await recordDepartureAcknowledgement(pending);
        window.localStorage.removeItem(key);
      } catch {
        // Keep the record queued; the next poll retries.
      }
    }
  } finally {
    flushingAcks = false;
  }
}

const CHECKS: Array<{ key: keyof DriverDepartureChecks; label: string }> = [
  { key: 'vehicle_walkaround', label: 'I completed a walk-around and checked for visible damage or hazards.' },
  { key: 'tyres_wheels', label: 'Tyres and wheels appear safe, inflated and free of obvious damage.' },
  { key: 'windscreen_mirrors', label: 'Windscreen, mirrors, windows and number plates are clear and usable.' },
  { key: 'lights_indicators', label: 'Lights, indicators, brake lights and warning indicators are serviceable.' },
  { key: 'fuel_charge', label: 'Fuel or charge is sufficient for the route and expected contingencies.' },
  { key: 'load_secured', label: 'The load is secured; cartons and labels match the loaded delivery stops.' },
  { key: 'phone_navigation', label: 'The phone is mounted and navigation is set before the vehicle moves.' },
  { key: 'licence_fitness', label: 'I hold the required licence and am fit, alert and unimpaired for driving.' },
  { key: 'defects_reported', label: 'I reported known defects and will not drive a vehicle I believe is unsafe.' },
];

function emptyChecks(): DriverDepartureChecks {
  return Object.fromEntries(CHECKS.map(({ key }) => [key, false])) as DriverDepartureChecks;
}

function parseDay(raw: string | null): DriverDayState | null {
  if (!raw) return null;
  try {
    const day = JSON.parse(raw) as DriverDayState;
    return day?.version === 1 && day.businessDay ? day : null;
  } catch {
    return null;
  }
}

function latestDay(): DriverDayState | null {
  const days: DriverDayState[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    const day = parseDay(window.localStorage.getItem(key));
    if (day) days.push(day);
  }
  return days.sort((a, b) => String(b.routeStartedAt || b.businessDay).localeCompare(String(a.routeStartedAt || a.businessDay)))[0] ?? null;
}

function routeId(day: DriverDayState) {
  return `RUN-${day.businessDay.replace(/-/g, '')}-${day.runCode || 'A'}`;
}

function isStartRouteButton(button: HTMLButtonElement) {
  return button.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() === 'start route';
}

function findStartButton(target: EventTarget | null) {
  const element = target instanceof Element ? target.closest<HTMLButtonElement>('button') : null;
  return element && isStartRouteButton(element) ? element : null;
}

function allChecksComplete(checks: DriverDepartureChecks) {
  return CHECKS.every(({ key }) => checks[key]);
}

function notificationSummary(result: RouteNotificationResult | null) {
  if (!result) return 'Customer notices send after route start';
  if (result.configurationRequired) return 'Email provider setup required';
  const parts = [
    result.sent ? `${result.sent} sent` : '',
    result.alreadySent ? `${result.alreadySent} already sent` : '',
    result.missingContact ? `${result.missingContact} missing email` : '',
    result.disabled ? `${result.disabled} disabled` : '',
    result.failed ? `${result.failed} failed` : '',
  ].filter(Boolean);
  return parts.join(' · ') || 'No customer notice required';
}

export function DriverDepartureControl() {
  const [modalOpen, setModalOpen] = useState(false);
  const [checks, setChecks] = useState<DriverDepartureChecks>(() => emptyChecks());
  const [typedName, setTypedName] = useState('');
  const [locationConsent, setLocationConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [driverLabel, setDriverLabel] = useState('Driver');
  const [statusHost, setStatusHost] = useState<HTMLElement | null>(null);
  const [notification, setNotification] = useState<RouteNotificationResult | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const pendingButtonRef = useRef<HTMLButtonElement | null>(null);
  const bypassRef = useRef(false);
  const notificationAttemptRef = useRef('');

  useEffect(() => {
    let active = true;
    supabase?.auth.getUser().then(({ data }) => {
      if (!active) return;
      const label = String(data.user?.user_metadata?.display_name || data.user?.email || 'Driver');
      setDriverLabel(label);
      setTypedName((current) => current || String(data.user?.user_metadata?.full_name || data.user?.user_metadata?.display_name || ''));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const locate = () => setStatusHost(document.querySelector<HTMLElement>('.driver-topbar'));
    const stopObserving = observeBody(locate);
    return stopObserving;
  }, []);

  useEffect(() => {
    const intercept = (event: Event) => {
      const button = findStartButton(event.target);
      if (!button || button.disabled) return;
      if (bypassRef.current) {
        bypassRef.current = false;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pendingButtonRef.current = button;
      setError('');

      const day = latestDay();
      if (!day) {
        setError('Today’s secure route state is unavailable. Reload EcoFlow before departure.');
        setModalOpen(true);
        return;
      }

      // A declaration queued offline counts as acknowledged; it uploads in the background.
      if (window.localStorage.getItem(pendingAckKey(day.businessDay, routeId(day)))) {
        bypassRef.current = true;
        pendingButtonRef.current?.click();
        pendingButtonRef.current = null;
        return;
      }

      void loadDepartureAcknowledgement({ businessDay: day.businessDay, routeId: routeId(day) })
        .then((existing) => {
          if (existing) {
            bypassRef.current = true;
            pendingButtonRef.current?.click();
            pendingButtonRef.current = null;
          } else {
            setModalOpen(true);
          }
        })
        .catch(() => setModalOpen(true));
    };
    document.addEventListener('click', intercept, true);
    return () => document.removeEventListener('click', intercept, true);
  }, []);

  const sendRouteNotifications = useCallback(async (force = false) => {
    const day = latestDay();
    if (!day?.routeStartedAt || day.routeEndedAt) return;
    const currentRouteId = routeId(day);
    const attemptKey = `${day.businessDay}:${currentRouteId}:${day.routeStartedAt}`;
    const stored = window.localStorage.getItem(`ecoflow-route-notification:${attemptKey}`);
    if (!force && (notificationAttemptRef.current === attemptKey || stored)) {
      if (stored && !notification) {
        try { setNotification(JSON.parse(stored) as RouteNotificationResult); } catch { /* ignore */ }
      }
      return;
    }

    notificationAttemptRef.current = attemptKey;
    setNotificationBusy(true);
    try {
      const result = await notifyRouteStarted({
        businessDay: day.businessDay,
        routeId: currentRouteId,
        orderIds: Object.keys(day.releasedOrders || {}),
        startedAt: day.routeStartedAt,
      });
      setNotification(result);
      window.localStorage.setItem(`ecoflow-route-notification:${attemptKey}`, JSON.stringify(result));
    } catch (notifyError) {
      setNotification({
        ok: false,
        sent: 0,
        alreadySent: 0,
        missingContact: 0,
        disabled: 0,
        failed: 1,
        details: [{ error: notifyError instanceof Error ? notifyError.message : String(notifyError) }],
      });
      notificationAttemptRef.current = '';
    } finally {
      setNotificationBusy(false);
    }
  }, [notification]);

  useEffect(() => {
    // Only the driver shell needs this loop; the owner desktop must not burn CPU
    // parsing day state or fire notifications on the driver's behalf.
    const tick = () => {
      if (!document.querySelector('.driver-shell')) return;
      void flushPendingAcknowledgements();
      void sendRouteNotifications(false);
    };
    const poll = window.setInterval(tick, 4000);
    window.addEventListener('storage', tick);
    window.addEventListener('online', tick);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('storage', tick);
      window.removeEventListener('online', tick);
    };
  }, [sendRouteNotifications]);

  async function acceptAndStart() {
    const day = latestDay();
    if (!day) {
      setError('Today’s secure route state is unavailable.');
      return;
    }
    if (!allChecksComplete(checks) || !locationConsent || typedName.trim().length < 2) {
      setError('Complete every check, confirm route-location consent and type your name.');
      return;
    }

    setSaving(true);
    setError('');
    const record: PendingAck = {
      businessDay: day.businessDay,
      routeId: routeId(day),
      typedName,
      checks,
      locationConsent,
      driverLabel,
    };
    try {
      await recordDepartureAcknowledgement(record);
      setModalOpen(false);
      bypassRef.current = true;
      pendingButtonRef.current?.click();
      pendingButtonRef.current = null;
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      const networkIssue = !navigator.onLine || /failed to fetch|network|load failed|timed? ?out/i.test(message);
      if (networkIssue) {
        // Poor signal at the dock must not stop the vehicle: queue the signed
        // declaration locally and let the 4s poll upload it when connectivity returns.
        window.localStorage.setItem(pendingAckKey(record.businessDay, record.routeId), JSON.stringify(record));
        setModalOpen(false);
        bypassRef.current = true;
        pendingButtonRef.current?.click();
        pendingButtonRef.current = null;
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  const ready = useMemo(() => allChecksComplete(checks) && locationConsent && typedName.trim().length >= 2, [checks, locationConsent, typedName]);
  const status = notificationSummary(notification);

  return (
    <>
      {statusHost ? createPortal(
        <button
          type="button"
          className={`driver-departure-status ${notification?.failed ? 'warn' : ''}`}
          disabled={notificationBusy}
          onClick={() => void sendRouteNotifications(true)}
          title="Customer delivery notice status. Tap to retry after correcting missing configuration or connectivity."
        >
          <Mail size={15} />
          <span>{notificationBusy ? 'Sending customer notices…' : status}</span>
        </button>,
        statusHost,
      ) : null}

      {modalOpen ? createPortal(
        <div className="driver-departure-overlay" role="dialog" aria-modal="true" aria-label="Driver pre-departure declaration">
          <section className="driver-departure-sheet">
            <header>
              <div>
                <span>PRE-DEPARTURE CONTROL</span>
                <h2><ClipboardCheck size={22} /> Vehicle, load and route declaration</h2>
              </div>
              <button type="button" aria-label="Close" onClick={() => setModalOpen(false)}><X size={20} /></button>
            </header>

            <div className="driver-departure-notice">
              <ShieldCheck size={20} />
              <p>This creates a dated operational record before the route starts. Report defects and do not drive an unsafe vehicle.</p>
            </div>

            <div className="driver-check-list">
              {CHECKS.map((item) => (
                <label key={item.key}>
                  <input
                    type="checkbox"
                    checked={checks[item.key]}
                    onChange={(event) => setChecks((current) => ({ ...current, [item.key]: event.target.checked }))}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>

            <label className="driver-location-consent">
              <input type="checkbox" checked={locationConsent} onChange={(event) => setLocationConsent(event.target.checked)} />
              <span><MapPin size={17} /> I consent to approximate route-active location records and event locations. Collection stops when the route ends.</span>
            </label>

            <p className="driver-declaration-copy">{DRIVER_DEPARTURE_DECLARATION}</p>

            <label className="driver-typed-name">
              <span>Type your full name to acknowledge · policy {DRIVER_DEPARTURE_POLICY_VERSION}</span>
              <input value={typedName} autoComplete="name" placeholder="Driver full name" onChange={(event) => setTypedName(event.target.value)} />
            </label>

            {error ? <div className="driver-departure-error"><AlertTriangle size={17} /> {error}</div> : null}

            <button type="button" className="driver-departure-confirm" disabled={!ready || saving} onClick={() => void acceptAndStart()}>
              <CheckCircle2 size={20} /> {saving ? 'Recording declaration…' : 'Accept declaration and start route'}
            </button>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
