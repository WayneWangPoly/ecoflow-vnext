import { useEffect, useMemo, useState } from 'react';
import type { DriverDayState, MapPoint, RunStop } from '@/domain/driverRun';
import { formatClockTime } from '@/domain/driverRun';
import { loadDeliveryRouteExecutionSequence } from '@/data/repositories/deliveryRouteAuthority';
import './deliveryDispatchCommandSurface.css';

type DispatchStopStatus = 'RELEASED' | 'PICKING' | 'STAGED' | 'ON THE WAY' | 'ARRIVED' | 'DELIVERED' | 'FAILED';

type Props = {
  runCode: string;
  businessDayLabel: string;
  stops: RunStop[];
  warehousePoint: MapPoint;
  day: DriverDayState;
  assignedDriverLabel: string;
};

function statusFor(stop: RunStop, day: DriverDayState): DispatchStopStatus {
  const progress = day.stopProgress[stop.orderId];
  if (progress?.status === 'DELIVERED') return 'DELIVERED';
  if (progress?.status === 'FAILED') return 'FAILED';
  if (progress?.status === 'ARRIVED') return 'ARRIVED';
  if (day.routeStartedAt) return 'ON THE WAY';
  if (day.pick?.stagedStops?.[stop.orderId]) return 'STAGED';
  if (day.pick) return 'PICKING';
  return 'RELEASED';
}

function routeStatus(day: DriverDayState) {
  if (day.routeEndedAt) return 'COMPLETED';
  if (day.routeStartedAt) return 'IN PROGRESS';
  if (day.pick) return 'LOCKED';
  return 'PLANNING';
}

function projectedFinish(stops: RunStop[], day: DriverDayState) {
  if (day.routeEndedAt) return { value: formatClockTime(day.routeEndedAt), basis: 'actual route end' };
  const open = stops.filter((stop) => {
    const status = day.stopProgress[stop.orderId]?.status;
    return status !== 'DELIVERED' && status !== 'FAILED' && status !== 'SKIPPED';
  });
  const lastOpen = open.at(-1);
  if (lastOpen?.eta) return { value: lastOpen.eta, basis: 'latest execution-sequence ETA' };
  const latestCompletion = stops
    .map((stop) => day.stopProgress[stop.orderId]?.completedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  if (latestCompletion) return { value: formatClockTime(latestCompletion), basis: 'latest completed stop' };
  return { value: 'Pending', basis: 'ETA unavailable' };
}

function mapPixel(point: MapPoint) {
  return { x: 38 + point.x * 424, y: 30 + point.y * 220 };
}

function DispatchMap({ stops, warehousePoint, selectedId, onSelect }: {
  stops: RunStop[];
  warehousePoint: MapPoint;
  selectedId: string;
  onSelect: (orderId: string) => void;
}) {
  const warehouse = mapPixel(warehousePoint);
  const points = stops.map((stop) => ({ stop, ...mapPixel(stop.mapPoint) }));
  return (
    <svg className="dispatch-route-map" viewBox="0 0 500 280" role="img" aria-label="Authoritative delivery execution route map">
      {points.map((point, index) => {
        const from = index === 0 ? warehouse : points[index - 1];
        return <line key={`line-${point.stop.orderId}`} x1={from.x} y1={from.y} x2={point.x} y2={point.y} className="dispatch-route-line" />;
      })}
      <g className="dispatch-map-warehouse">
        <circle cx={warehouse.x} cy={warehouse.y} r="15" />
        <text x={warehouse.x} y={warehouse.y + 5} textAnchor="middle">W</text>
      </g>
      {points.map(({ stop, x, y }) => (
        <g
          key={stop.orderId}
          className={`dispatch-map-stop ${selectedId === stop.orderId ? 'selected' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(stop.orderId)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(stop.orderId); }}
        >
          <circle cx={x} cy={y} r="14" />
          <text x={x} y={y + 5} textAnchor="middle">{stop.stopNumber}</text>
          <title>{`${stop.stopNumber}. ${stop.store} · ${stop.address}`}</title>
        </g>
      ))}
    </svg>
  );
}

export function DeliveryDispatchCommandSurface({ runCode, businessDayLabel, stops, warehousePoint, day, assignedDriverLabel }: Props) {
  const [selectedId, setSelectedId] = useState(stops[0]?.orderId || '');
  const [authoritativeStops, setAuthoritativeStops] = useState<RunStop[] | null>(null);
  const [sequenceRevision, setSequenceRevision] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    if (!day.pick) {
      setAuthoritativeStops(null);
      setSequenceRevision(null);
      return () => { active = false; };
    }

    const refresh = async () => {
      try {
        const sequence = await loadDeliveryRouteExecutionSequence({ businessDay: day.businessDay, runCode });
        if (!active) return;
        if (sequence) {
          setAuthoritativeStops(sequence.snapshot.stops);
          setSequenceRevision(sequence.sequenceRevision);
        }
      } catch {
        // Keep the last trusted command-surface sequence. Authority failures do
        // not silently replace it with locally invented ETA/order data.
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [day.businessDay, day.pick?.lockedAt, runCode]);

  const effectiveStops = authoritativeStops ?? stops;

  useEffect(() => {
    if (!effectiveStops.length) {
      setSelectedId('');
      return;
    }
    if (!effectiveStops.some((stop) => stop.orderId === selectedId)) setSelectedId(effectiveStops[0].orderId);
  }, [effectiveStops, selectedId]);

  const selected = effectiveStops.find((stop) => stop.orderId === selectedId) ?? effectiveStops[0] ?? null;
  const finish = useMemo(() => projectedFinish(effectiveStops, day), [effectiveStops, day]);
  const totalBoxes = effectiveStops.reduce((sum, stop) => sum + stop.cartons, 0);
  const delivered = effectiveStops.filter((stop) => statusFor(stop, day) === 'DELIVERED').length;
  const firstEta = effectiveStops[0]?.eta || 'Pending';
  const lastEta = effectiveStops.at(-1)?.eta || 'Pending';

  return (
    <section className="panel dispatch-command-surface" aria-label="Delivery dispatch command surface">
      <div className="panel-head dispatch-command-head">
        <div>
          <h2>Run {runCode} dispatch</h2>
          <span>{businessDayLabel} · server-authoritative hand-off{sequenceRevision !== null ? ` · execution r${sequenceRevision}` : ''}</span>
        </div>
        <strong>{routeStatus(day)}</strong>
      </div>

      <div className="dispatch-command-metrics">
        <div><span>Driver</span><strong>{assignedDriverLabel || 'Unassigned'}</strong></div>
        <div><span>Stops</span><strong>{delivered}/{effectiveStops.length} delivered</strong></div>
        <div><span>Boxes / cartons</span><strong>{totalBoxes}</strong></div>
        <div><span>ETA window</span><strong>{firstEta}–{lastEta}</strong></div>
        <div><span>Projected finish</span><strong>{finish.value}</strong><small>{finish.basis}; updates from latest Driver sequence</small></div>
      </div>

      <div className="dispatch-command-grid">
        <div className="dispatch-map-panel">
          {effectiveStops.length ? <DispatchMap stops={effectiveStops} warehousePoint={warehousePoint} selectedId={selected?.orderId || ''} onSelect={setSelectedId} /> : <div className="empty-state">No released stops to map.</div>}
        </div>

        <div className="dispatch-detail-panel">
          {selected ? (
            <>
              <span>STOP {selected.stopNumber} · BOX {selected.boxCode}</span>
              <h3>{selected.store}</h3>
              <p>{selected.address}</p>
              <dl>
                <div><dt>ETA</dt><dd>{selected.eta || 'Pending'}</dd></div>
                <div><dt>Status</dt><dd>{statusFor(selected, day)}</dd></div>
                <div><dt>Cartons</dt><dd>{selected.cartons}</dd></div>
                <div><dt>Order</dt><dd>{selected.orderNo}</dd></div>
              </dl>
              {selected.deliveryNote ? <small>Delivery note: {selected.deliveryNote}</small> : null}
            </>
          ) : <div className="empty-state">Select a stop to inspect dispatch detail.</div>}
        </div>
      </div>

      <div className="table-like dispatch-command-table">
        <div className="table-head"><span>Stop</span><span>Store / address</span><span>ETA</span><span>Boxes</span><span>Status</span></div>
        {effectiveStops.map((stop) => {
          const status = statusFor(stop, day);
          return (
            <button className={`table-row dispatch-command-row ${selected?.orderId === stop.orderId ? 'selected' : ''}`} type="button" key={stop.orderId} onClick={() => setSelectedId(stop.orderId)}>
              <span><strong>{stop.stopNumber}</strong><small>{stop.boxCode}</small></span>
              <span><strong>{stop.store}</strong><small>{stop.address}</small></span>
              <span>{stop.eta || 'Pending'}</span>
              <span>{stop.cartons}</span>
              <span>{status}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
