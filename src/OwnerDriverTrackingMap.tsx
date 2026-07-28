import { useEffect, useMemo, useRef, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { createPortal } from 'react-dom';
import { Clock3, LocateFixed, MapPin, RefreshCw, Store, Truck, Warehouse } from 'lucide-react';
import { applySupabaseOrdermentumViews, loadSupabaseOrdermentumViews } from '@/data/repositories/resilientOrdermentumViews';
import {
  advancePickSyncCursor,
  fetchPickRows,
  INITIAL_PICK_SYNC_CURSOR,
  mergeRowsIntoDay
} from '@/data/repositories/pickSync';
import { loadDriverIdentity, loadOwnerDriverLocationTimeline, type DriverLocationSample } from '@/data/repositories/driverLocation';
import { buildDriverRun, emptyDriverDayState, WAREHOUSE, type DriverDayState, type MapPoint, type RunStop } from '@/domain/driverRun';
import { buildProductionEmptyData } from '@/domain/productionData';
import { resolveTrustedLiveSnapshot, type TrustedLiveSnapshot } from '@/domain/trustedLiveSnapshot';
import type { EcoFlowDataSet } from '@/domain/types';

const MAP_W = 900;
const MAP_H = 520;
const MAP_PAD = 54;
const POLL_MS = 20000;

type TrackingData = {
  businessDay: string;
  businessLabel: string;
  stops: RunStop[];
  day: DriverDayState;
  routeId: string;
  samples: DriverLocationSample[];
  loadedAt: string;
};

type Projector = (lat: number, lng: number) => MapPoint;

function n(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clock(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}

function ageText(value?: string | null) {
  if (!value) return 'No position yet';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function sourceLabel(source: DriverLocationSample['sample_source']) {
  if (source === 'ROUTE_START') return 'Route started';
  if (source === 'ROUTE_END') return 'Route finished';
  if (source === 'STOP_ARRIVAL') return 'Arrived at stop';
  if (source === 'DELIVERY') return 'Delivery completed';
  if (source === 'FAILED_DELIVERY') return 'Failed delivery';
  if (source === 'MANUAL') return 'Driver shared now';
  return 'Automatic update';
}

function stopStatus(stop: RunStop, day: DriverDayState) {
  const progress = day.stopProgress[stop.orderId];
  if (progress?.status === 'DELIVERED') return 'delivered';
  if (progress?.status === 'FAILED') return 'failed';
  if (progress?.status === 'ARRIVED') return 'arrived';
  if (day.routeStartedAt && !day.routeEndedAt) return 'open';
  if (day.pick?.stagedStops[stop.orderId]) return 'staged';
  return 'released';
}

function pixel(point: MapPoint) {
  return {
    x: MAP_PAD + point.x * (MAP_W - MAP_PAD * 2),
    y: MAP_PAD + point.y * (MAP_H - MAP_PAD * 2),
  };
}

function makeProjector(stops: RunStop[], samples: DriverLocationSample[]): Projector | null {
  const geo = [
    { lat: WAREHOUSE.lat, lng: WAREHOUSE.lng },
    ...stops
      .filter((stop) => typeof stop.lat === 'number' && typeof stop.lng === 'number')
      .map((stop) => ({ lat: stop.lat as number, lng: stop.lng as number })),
    ...samples.map((sample) => ({ lat: sample.latitude, lng: sample.longitude })),
  ];
  if (geo.length < 2) return null;
  const minLat = Math.min(...geo.map((point) => point.lat));
  const maxLat = Math.max(...geo.map((point) => point.lat));
  const minLng = Math.min(...geo.map((point) => point.lng));
  const maxLng = Math.max(...geo.map((point) => point.lng));
  const span = Math.max(maxLat - minLat, maxLng - minLng, 0.01);
  const pad = 0.06;
  return (lat, lng) => ({
    x: Math.max(0.02, Math.min(0.98, pad + ((lng - minLng) / span) * (1 - pad * 2))),
    y: Math.max(0.02, Math.min(0.98, pad + ((maxLat - lat) / span) * (1 - pad * 2))),
  });
}

function representativeSamples(samples: DriverLocationSample[], maximum = 24) {
  if (samples.length <= maximum) return samples;
  const keep = new Map<string, DriverLocationSample>();
  keep.set(samples[0].id, samples[0]);
  keep.set(samples[samples.length - 1].id, samples[samples.length - 1]);
  samples.forEach((sample) => {
    if (sample.sample_source !== 'AUTO_INTERVAL') keep.set(sample.id, sample);
  });
  const remaining = Math.max(0, maximum - keep.size);
  if (remaining) {
    const step = (samples.length - 1) / Math.max(1, remaining - 1);
    for (let index = 0; index < remaining; index += 1) {
      const sample = samples[Math.min(samples.length - 1, Math.round(index * step))];
      keep.set(sample.id, sample);
    }
  }
  return [...keep.values()].sort((a, b) => a.captured_at.localeCompare(b.captured_at)).slice(-maximum);
}

type ViewsCache = TrustedLiveSnapshot<EcoFlowDataSet>;
/** Reload the heavy Ordermentum views only every Nth poll; pick rows use an incremental cursor. */
const VIEWS_REFRESH_TICKS = 5;

function deliveryHost() {
  const activeDelivery = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar-nav button'))
    .some((button) => button.classList.contains('active') && button.textContent?.trim() === 'Delivery');
  if (!activeDelivery) return null;
  return document.querySelector<HTMLElement>('.desktop-content > .workspace-stack');
}

export function OwnerDriverTrackingMap() {
  const [owner, setOwner] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<TrackingData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [selectedStore, setSelectedStore] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadDriverIdentity()
      .then((profile) => {
        if (!active) return;
        setOwner(Boolean(profile?.is_active && profile.team_status === 'ACTIVE' && ['OWNER', 'ADMIN'].includes(String(profile.app_role))));
      })
      .catch(() => {
        if (active) setOwner(window.localStorage.getItem('ecoflow-role') === 'owner');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function locate() { setHost(deliveryHost()); }
    const stopObserving = observeBody(locate);
    return stopObserving;
  }, []);

  const viewsCacheRef = useRef<ViewsCache | null>(null);
  const dayRef = useRef<DriverDayState | null>(null);
  const cursorRef = useRef(INITIAL_PICK_SYNC_CURSOR);
  const tickRef = useRef(0);

  async function reload() {
    if (!owner || !host || loading) return;
    setLoading(true);
    try {
      const tick = tickRef.current;
      tickRef.current += 1;
      let base = viewsCacheRef.current;
      let liveWarning = '';
      if (!base || tick - base.acceptedSequence >= VIEWS_REFRESH_TICKS) {
        let candidate: EcoFlowDataSet | null = null;
        try {
          const views = await loadSupabaseOrdermentumViews();
          candidate = views
            ? applySupabaseOrdermentumViews(buildProductionEmptyData(), views)
            : null;
          if (!views) liveWarning = 'Supabase live views are unavailable.';
        } catch (reason) {
          liveWarning = reason instanceof Error ? reason.message : String(reason);
        }
        const resolution = resolveTrustedLiveSnapshot(base, candidate, tick);
        if (!resolution.snapshot) {
          throw new Error(liveWarning || 'No trusted live delivery snapshot is available.');
        }
        base = resolution.snapshot;
        viewsCacheRef.current = base;
        if (resolution.source === 'last-trusted') {
          liveWarning = liveWarning || 'Live refresh failed; retaining the last trusted delivery snapshot.';
        }
      }
      if (!base) throw new Error('No trusted live delivery snapshot is available.');
      const businessDay = base.data.businessDay.date;
      if (!dayRef.current || dayRef.current.businessDay !== businessDay) {
        dayRef.current = emptyDriverDayState(businessDay);
        cursorRef.current = INITIAL_PICK_SYNC_CURSOR;
      }
      const rows = await fetchPickRows(businessDay, cursorRef.current);
      if (rows.length) {
        cursorRef.current = advancePickSyncCursor(cursorRef.current, rows);
        dayRef.current = mergeRowsIntoDay(dayRef.current, rows);
      }
      const run = buildDriverRun(base.data.orders, businessDay, dayRef.current.releasedOrders, dayRef.current.runCode);
      const samples = await loadOwnerDriverLocationTimeline(businessDay, run.id);
      const next: TrackingData = {
        businessDay,
        businessLabel: base.data.businessDay.label,
        stops: run.stops,
        day: dayRef.current,
        routeId: run.id,
        samples,
        loadedAt: new Date().toISOString(),
      };
      setData(next);
      setError(liveWarning);
      const newest = [...next.samples].sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0];
      setSelectedDriver((current) => next.samples.some((sample) => sample.driver_user_id === current) ? current : newest?.driver_user_id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!owner || !host) return;
    void reload();
    const timer = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [owner, host]);

  const drivers = useMemo(() => {
    if (!data) return [];
    const latest = new Map<string, DriverLocationSample>();
    data.samples.forEach((sample) => latest.set(sample.driver_user_id, sample));
    return [...latest.values()].sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  }, [data]);

  const driverSamples = useMemo(() => {
    if (!data) return [];
    const id = selectedDriver || drivers[0]?.driver_user_id;
    return data.samples.filter((sample) => sample.driver_user_id === id).sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  }, [data, selectedDriver, drivers]);

  if (!owner || !host) return null;

  const latest = driverSamples[driverSamples.length - 1] ?? null;
  const visibleSamples = representativeSamples(driverSamples);
  const projector = data ? makeProjector(data.stops, visibleSamples) : null;
  const warehousePoint = projector ? projector(WAREHOUSE.lat, WAREHOUSE.lng) : { x: 0.08, y: 0.5 };
  const warehousePx = pixel(warehousePoint);
  const selected = data?.stops.find((stop) => stop.orderId === selectedStore) ?? null;
  const staleMinutes = latest ? Math.floor((Date.now() - new Date(latest.captured_at).getTime()) / 60000) : Number.POSITIVE_INFINITY;
  const routeActive = Boolean(data?.day.routeStartedAt && !data?.day.routeEndedAt);

  const samplePoints = visibleSamples.map((sample) => ({
    sample,
    ...pixel(projector ? projector(sample.latitude, sample.longitude) : { x: 0.5, y: 0.5 }),
  }));
  const path = samplePoints.map((point) => `${point.x},${point.y}`).join(' ');

  return createPortal(
    <section className="owner-driver-tracking panel">
      <div className="owner-tracking-head">
        <div>
          <span className="section-eyebrow">OWNER DELIVERY VISIBILITY</span>
          <h2>Driver position timeline · Run {data?.day.runCode || 'A'}</h2>
          <p>Store distribution plus approximate driver positions for the active run only. Earlier run samples remain archived under their own route IDs. No delivery sequence is exposed on this map.</p>
        </div>
        <div className="owner-tracking-actions">
          {drivers.length > 1 ? (
            <select value={selectedDriver || drivers[0]?.driver_user_id || ''} onChange={(event) => setSelectedDriver(event.target.value)}>
              {drivers.map((driver) => <option key={driver.driver_user_id} value={driver.driver_user_id}>{driver.driver_label || 'Driver'}</option>)}
            </select>
          ) : null}
          <button type="button" disabled={loading} onClick={() => void reload()}><RefreshCw size={15} /> {loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {error ? <div className="owner-tracking-error">Tracking data unavailable: {error}</div> : null}

      <div className="owner-tracking-stats">
        <div><Store size={17} /><strong>{data?.stops.length ?? 0}</strong><span>delivery stores</span></div>
        <div><LocateFixed size={17} /><strong>{driverSamples.length}</strong><span>Run {data?.day.runCode || 'A'} position samples</span></div>
        <div className={staleMinutes > 10 ? 'stale' : ''}><Clock3 size={17} /><strong>{ageText(latest?.captured_at)}</strong><span>last driver update</span></div>
        <div><Truck size={17} /><strong>{routeActive ? 'IN PROGRESS' : data?.day.routeEndedAt ? 'COMPLETED' : 'NOT STARTED'}</strong><span>{data?.routeId || data?.businessLabel || 'business day'}</span></div>
      </div>

      <div className="owner-tracking-layout">
        <div className="owner-tracking-map-wrap">
          <svg className="owner-tracking-map" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Delivery store distribution and driver position timeline">
            <defs>
              <pattern id="owner-map-grid" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="currentColor" strokeWidth="0.6" />
              </pattern>
            </defs>
            <rect className="owner-map-grid" width={MAP_W} height={MAP_H} fill="url(#owner-map-grid)" />
            {path ? <polyline className="owner-driver-path" points={path} /> : null}

            <g className="owner-map-warehouse" transform={`translate(${warehousePx.x} ${warehousePx.y})`}>
              <rect x="-16" y="-16" width="32" height="32" rx="7" />
              <text y="5" textAnchor="middle">W</text>
              <text className="owner-map-label" y="34" textAnchor="middle">Warehouse</text>
            </g>

            {data?.stops.map((stop) => {
              const point = projector && typeof stop.lat === 'number' && typeof stop.lng === 'number'
                ? projector(stop.lat, stop.lng)
                : stop.mapPoint;
              const px = pixel(point);
              const status = stopStatus(stop, data.day);
              const selectedPin = selectedStore === stop.orderId;
              return (
                <g key={stop.orderId} className={`owner-store-pin owner-store-${status} ${selectedPin ? 'selected' : ''}`} transform={`translate(${px.x} ${px.y})`} onClick={() => setSelectedStore(stop.orderId)}>
                  <title>{`${stop.store} · ${stop.address} · ${status}`}</title>
                  <circle r="10" />
                  <path d="M-3,-3 h6 v6 h-6 z" />
                  <text className="owner-store-label" y="25" textAnchor="middle">{stop.store.length > 18 ? `${stop.store.slice(0, 17)}…` : stop.store}</text>
                </g>
              );
            })}

            {samplePoints.map(({ sample, x, y }, index) => {
              const event = sample.sample_source !== 'AUTO_INTERVAL';
              const latestPoint = index === samplePoints.length - 1;
              return (
                <g key={sample.id} className={`owner-time-pin ${event ? 'event' : ''} ${latestPoint ? 'latest' : ''}`} transform={`translate(${x} ${y})`}>
                  <title>{`${clock(sample.captured_at)} · ${sourceLabel(sample.sample_source)} · accuracy ${Math.round(n(sample.accuracy_m))} m`}</title>
                  <circle r={latestPoint ? 12 : event ? 7 : 5} />
                  {latestPoint ? <text y="4.5" textAnchor="middle">D</text> : null}
                  <text className="owner-time-label" y={latestPoint ? -17 : -11} textAnchor="middle">{clock(sample.captured_at)}</text>
                </g>
              );
            })}
          </svg>
          <div className="owner-map-legend">
            <span><i className="legend-store" /> Store</span>
            <span><i className="legend-driver" /> Driver / time</span>
            <span><i className="legend-delivered" /> Delivered</span>
            <span><i className="legend-failed" /> Failed</span>
          </div>
        </div>

        <aside className="owner-tracking-side">
          <div className={`owner-latest-card ${staleMinutes > 10 ? 'stale' : ''}`}>
            <span>LATEST DRIVER POSITION</span>
            <strong>{latest?.driver_label || drivers[0]?.driver_label || 'Waiting for driver'}</strong>
            <p>{latest ? `${clock(latest.captured_at)} · ${ageText(latest.captured_at)}` : 'The first point appears after the driver starts the route and grants location permission.'}</p>
            {latest ? <small>{sourceLabel(latest.sample_source)} · ±{Math.round(n(latest.accuracy_m)) || '—'} m</small> : null}
          </div>

          {selected ? (
            <div className="owner-selected-store">
              <span>SELECTED STORE</span>
              <strong><MapPin size={15} /> {selected.store}</strong>
              <p>{selected.address}</p>
              <small>{selected.cartons} cartons · {stopStatus(selected, data!.day).replace(/_/g, ' ')}</small>
            </div>
          ) : null}

          <div className="owner-timeline-list">
            <div className="owner-timeline-title"><Clock3 size={15} /> Recent timeline</div>
            {[...driverSamples].reverse().slice(0, 10).map((sample) => (
              <article key={sample.id}>
                <time>{clock(sample.captured_at)}</time>
                <div><strong>{sourceLabel(sample.sample_source)}</strong><span>{sample.current_order_id ? `Linked delivery ${sample.current_order_id.slice(0, 8)}` : 'Between delivery stops'}</span></div>
              </article>
            ))}
            {!driverSamples.length ? <p className="owner-timeline-empty">No driver position has been recorded for this run yet.</p> : null}
          </div>
        </aside>
      </div>
      <footer className="owner-tracking-foot"><Warehouse size={14} /> Positions are approximate and collected only while the route is active and the Driver app can access location. Last map refresh {clock(data?.loadedAt)}.</footer>
    </section>,
    host,
  );
}
