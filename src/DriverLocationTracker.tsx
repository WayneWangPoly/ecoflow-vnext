import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';
import { LocateFixed, LocateOff } from 'lucide-react';
import type { DriverDayState, StopProgress } from '@/domain/driverRun';
import { loadDriverIdentity, recordDriverLocationSample, type DriverLocationSource } from '@/data/repositories/driverLocation';

const STORAGE_PREFIX = 'ecoflow-driver-day:';
const SAMPLE_MS = 10 * 60 * 1000;
const STATE_POLL_MS = 7000;
const POSITION_FRESH_MS = 2 * 60 * 1000;

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 30000,
  maximumAge: 120000,
};

type RouteSnapshot = {
  day: DriverDayState;
  routeId: string;
  active: boolean;
  currentOrderId: string | null;
  eventKey: string | null;
  eventSource: DriverLocationSource | null;
  eventAt: string | null;
};

type TrackerStatus = 'idle' | 'sharing' | 'saving' | 'blocked' | 'offline' | 'error';

function parseDay(raw: string | null): DriverDayState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as DriverDayState;
    return value?.version === 1 && value.businessDay ? value : null;
  } catch {
    return null;
  }
}

function isClosed(progress?: StopProgress) {
  return progress?.status === 'DELIVERED' || progress?.status === 'FAILED' || progress?.status === 'SKIPPED';
}

function snapshotFromDay(day: DriverDayState): RouteSnapshot | null {
  if (!day.routeStartedAt) return null;
  const order = day.pick?.stopOrder?.length
    ? day.pick.stopOrder
    : day.stopOrder?.length
      ? day.stopOrder
      : Object.keys(day.releasedOrders);
  const currentOrderId = order.find((id) => !isClosed(day.stopProgress[id])) ?? null;
  const events: Array<{ key: string; source: DriverLocationSource; at: string }> = [
    { key: `route-start:${day.routeStartedAt}`, source: 'ROUTE_START', at: day.routeStartedAt },
  ];
  Object.entries(day.stopProgress).forEach(([orderId, progress]) => {
    if (progress.arrivedAt) events.push({ key: `arrival:${orderId}:${progress.arrivedAt}`, source: 'STOP_ARRIVAL', at: progress.arrivedAt });
    if (progress.completedAt) {
      events.push({
        key: `${progress.status === 'FAILED' ? 'failed' : 'delivery'}:${orderId}:${progress.completedAt}`,
        source: progress.status === 'FAILED' ? 'FAILED_DELIVERY' : 'DELIVERY',
        at: progress.completedAt,
      });
    }
  });
  if (day.routeEndedAt) events.push({ key: `route-end:${day.routeEndedAt}`, source: 'ROUTE_END', at: day.routeEndedAt });
  events.sort((a, b) => a.at.localeCompare(b.at));
  const latest = events[events.length - 1] ?? null;
  return {
    day,
    routeId: `RUN-${day.businessDay.replace(/-/g, '')}-${day.runCode || 'A'}`,
    active: Boolean(day.routeStartedAt && !day.routeEndedAt),
    currentOrderId,
    eventKey: latest?.key ?? null,
    eventSource: latest?.source ?? null,
    eventAt: latest?.at ?? null,
  };
}

function latestSnapshot(): RouteSnapshot | null {
  const candidates: RouteSnapshot[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    const day = parseDay(window.localStorage.getItem(key));
    const snapshot = day ? snapshotFromDay(day) : null;
    if (snapshot) candidates.push(snapshot);
  }
  return candidates.sort((a, b) => String(b.day.routeStartedAt).localeCompare(String(a.day.routeStartedAt)))[0] ?? null;
}

function id() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function positionPromise() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location services are unavailable on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, WATCH_OPTIONS);
  });
}

function optionalCoordinate(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positionIsFresh(position: GeolocationPosition | null) {
  return Boolean(position && Date.now() - position.timestamp <= POSITION_FRESH_MS);
}

function statusLabel(status: TrackerStatus, active: boolean, lastSharedAt: string) {
  if (!active) return 'Location sharing stops with route';
  if (status === 'saving') return 'Saving location…';
  if (status === 'blocked') return 'Location permission blocked';
  if (status === 'offline') return 'Location offline';
  if (status === 'error') return 'Location sync retry needed';
  if (lastSharedAt) return `Web tracking · ${new Date(lastSharedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;
  return 'Web tracking · about every 10 min';
}

export function DriverLocationTracker() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<RouteSnapshot | null>(() => latestSnapshot());
  const [identity, setIdentity] = useState<{ label: string; role: string } | null>(null);
  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [lastSharedAt, setLastSharedAt] = useState('');
  const busyRef = useRef(false);
  const blockedRef = useRef(false);
  const lastEventAttemptRef = useRef('');
  const latestPositionRef = useRef<GeolocationPosition | null>(null);

  useEffect(() => {
    let active = true;
    loadDriverIdentity()
      .then((profile) => {
        if (!active || !profile) return;
        setIdentity({ label: profile.display_name || profile.email || 'Driver', role: String(profile.app_role || '') });
      })
      .catch(() => {
        if (active && window.localStorage.getItem('ecoflow-role') === 'driver') setIdentity({ label: 'Driver', role: 'DRIVER' });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function locate() {
      setHost(document.querySelector<HTMLElement>('.driver-topbar'));
      setSnapshot(latestSnapshot());
    }
    const stopObserving = observeBody(locate);
    const timer = window.setInterval(() => setSnapshot(latestSnapshot()), STATE_POLL_MS);
    return () => {
      stopObserving();
      window.clearInterval(timer);
    };
  }, []);

  const canTrack = useMemo(() => Boolean(host && identity?.role === 'DRIVER'), [host, identity]);

  const share = useCallback(async (source: DriverLocationSource, suppliedPosition?: GeolocationPosition): Promise<boolean> => {
    const current = latestSnapshot();
    if (!current || !canTrack || busyRef.current || blockedRef.current) return false;
    // Privacy boundary: no manual or automatic samples after route completion.
    // The final ROUTE_END event is allowed so the Owner sees where tracking stopped.
    if (!current.active && source !== 'ROUTE_END') return false;
    if (!navigator.onLine) {
      setStatus('offline');
      return false;
    }
    busyRef.current = true;
    setStatus('saving');
    try {
      const cached = positionIsFresh(latestPositionRef.current) ? latestPositionRef.current : null;
      const position = suppliedPosition ?? cached ?? await positionPromise();
      latestPositionRef.current = position;
      const capturedAt = new Date(position.timestamp || Date.now()).toISOString();
      await recordDriverLocationSample({
        businessDay: current.day.businessDay,
        routeId: current.routeId,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyM: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        speedMps: optionalCoordinate(position.coords.speed),
        headingDegrees: optionalCoordinate(position.coords.heading),
        currentOrderId: current.currentOrderId,
        source,
        clientSampleId: id(),
        capturedAt,
        driverLabel: identity?.label || 'Driver',
        metadata: {
          visibility: document.visibilityState,
          acquisition: suppliedPosition || cached ? 'watch' : 'single',
          userAgent: navigator.userAgent.slice(0, 180),
        },
      });
      window.localStorage.setItem(`ecoflow-driver-location-last:${current.day.businessDay}`, capturedAt);
      setLastSharedAt(capturedAt);
      setStatus('sharing');
      return true;
    } catch (error) {
      const code = (error as GeolocationPositionError | undefined)?.code;
      if (code === 1) {
        blockedRef.current = true;
        setStatus('blocked');
      } else {
        setStatus('error');
      }
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [canTrack, identity?.label]);

  useEffect(() => {
    if (!snapshot || !canTrack) return;
    const last = window.localStorage.getItem(`ecoflow-driver-location-last:${snapshot.day.businessDay}`) || '';
    setLastSharedAt(last);

    if (snapshot.eventKey && snapshot.eventSource && lastEventAttemptRef.current !== snapshot.eventKey) {
      const eventKey = snapshot.eventKey;
      void share(snapshot.eventSource).then((saved) => {
        if (saved) lastEventAttemptRef.current = eventKey;
      });
      return;
    }

    if (snapshot.active) {
      const elapsed = last ? Date.now() - new Date(last).getTime() : Number.POSITIVE_INFINITY;
      if (elapsed >= SAMPLE_MS) void share('AUTO_INTERVAL');
    }
  }, [snapshot?.day.businessDay, snapshot?.active, snapshot?.eventKey, canTrack, share]);

  useEffect(() => {
    if (!canTrack || !snapshot?.active || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        latestPositionRef.current = position;
        if (!navigator.onLine) {
          setStatus('offline');
          return;
        }
        const current = latestSnapshot();
        if (!current?.active) return;
        const last = window.localStorage.getItem(`ecoflow-driver-location-last:${current.day.businessDay}`) || '';
        const elapsed = last ? Date.now() - new Date(last).getTime() : Number.POSITIVE_INFINITY;
        if (elapsed >= SAMPLE_MS) void share('AUTO_INTERVAL', position);
      },
      (error) => {
        if (error.code === 1) {
          blockedRef.current = true;
          setStatus('blocked');
        } else if (navigator.onLine) {
          setStatus('error');
        }
      },
      WATCH_OPTIONS,
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [canTrack, snapshot?.active, snapshot?.day.businessDay, share]);

  useEffect(() => {
    if (!canTrack) return;
    const timer = window.setInterval(() => {
      const current = latestSnapshot();
      if (!current?.active) return;
      const last = window.localStorage.getItem(`ecoflow-driver-location-last:${current.day.businessDay}`) || '';
      if (!last || Date.now() - new Date(last).getTime() >= SAMPLE_MS) {
        const cached = positionIsFresh(latestPositionRef.current) ? latestPositionRef.current ?? undefined : undefined;
        void share('AUTO_INTERVAL', cached);
      }
    }, 30000);

    const resume = () => {
      const current = latestSnapshot();
      if (current?.active && document.visibilityState === 'visible') void share('AUTO_INTERVAL');
    };

    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [canTrack, share]);

  if (!host || !identity || identity.role !== 'DRIVER') return null;
  const active = Boolean(snapshot?.active);
  const blocked = status === 'blocked';
  return createPortal(
    <button
      type="button"
      className={`driver-location-share driver-location-${status}`}
      disabled={!active && snapshot?.eventSource !== 'ROUTE_END'}
      onClick={() => { blockedRef.current = false; void share('MANUAL'); }}
      title={blocked
        ? 'Enable location permission in browser settings, then tap to retry.'
        : active
          ? 'Share a fresh position now. The web app also watches location about every 10 minutes while the browser allows it.'
          : 'Location sharing is off because the route is not active.'}
    >
      {blocked ? <LocateOff size={15} /> : <LocateFixed size={15} />}
      <span>{statusLabel(status, active, lastSharedAt)}</span>
    </button>,
    host,
  );
}
