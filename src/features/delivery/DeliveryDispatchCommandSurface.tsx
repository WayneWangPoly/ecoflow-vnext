import { useMemo, useState } from 'react';
import type { DriverDayState, MapPoint, RunStop } from '@/domain/driverRun';
import { formatClockTime } from '@/domain/driverRun';
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
  if (lastOpen?.eta) return { value: lastOpen.eta, basis: 'last open stop ETA' };
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
    <svg className="dispatch-route-map" viewBox="0 0 500 280" role="img" aria-label="Approved delivery route map">
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
  const selected = stops.find((stop) => stop.orderId === selectedId) ?? stops[0] ?? null;
  const finish = useMemo(() => projectedFinish(stops, day), [stops, day]);
  const totalBoxes = stops.reduce((sum, stop) => sum + stop.cartons, 0);
  const delivered = stops.filter((stop) => statusFor(stop, day) === 'DELIVERED').length;
  const firstEta = stops[0]?.eta || 'Pending';
  const lastEta = stops.at(-1)?.eta || 'Pending';

  return (
    <section className="panel dispatch-command-surface" aria-label="Delivery dispatch command surface">
      <div className="panel-head dispatch-command-head">
        <div>
          <h2>Run {runCode} dispatch</h2>
          <span>{businessDayLabel} · server-authoritative hand-off</span>
        </div>
        <strong>{routeStatus(day)}</strong>
      </div>

      <div className="dispatch-command-metrics">
        <div><span>Driver</span><strong>{assignedDriverLabel || 'Unassigned'}</strong></div>
        <div><span>Stops</span><strong>{delivered}/{stops.length} delivered</strong></div>
        <div><span>Boxes / cartons</span><strong>{totalBoxes}</strong></div>
        <div><span>ETA window</span><strong>{firstEta}–{lastEta}</strong></div>
        <div><span>Projected finish</span><strong>{finish.value}</strong><small>{finish.basis}; no artificial dwell-time assumption</small></div>
      </div>

      <div className="dispatch-command-grid">
        <div className="dispatch-map-panel">
          {stops.length ? <DispatchMap stops={stops} warehousePoint={warehousePoint} selectedId={selected?.orderId || ''} onSelect={setSelectedId} /> : <div className="empty-state">No released stops to map.</div>}
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
        {stops.map((stop) => {
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
