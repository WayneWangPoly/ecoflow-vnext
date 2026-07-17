import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EcoFlowDataSet, ImportedOrder, Role } from '@/domain/types';
import {
  loadOrderOperationsSummary,
  type OrderOperationsSummary,
} from '@/data/repositories/orderOperations';
import {
  loadBarcodeSprintKpis,
  loadInventoryKpis,
  type BarcodeSprintKpis,
  type InventoryKpis,
} from '@/data/repositories/inventoryControl';
import { loadWarehouseLocationItems, type WarehouseLocationItemRow } from '@/data/repositories/warehouseLocations';
import {
  loadOrdermentumMirrorHealth,
  type OrdermentumMirrorHealthRow,
} from '@/features/team/ordermentumSync';
import { supabase } from '@/lib/supabaseClient';
import './fieldReadinessDashboard.css';

type DashboardPageProps = {
  role: Role;
  data: EcoFlowDataSet;
  orders: ImportedOrder[];
  snapshotReady: boolean;
  loading: boolean;
  loadError?: string;
  healthNotice?: string;
  onReload: () => Promise<void>;
  onOpenOrders: () => void;
};

function n(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateTime(value?: string | null) {
  if (!value) return 'Not verified yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function DashboardPage({
  role,
  data,
  orders,
  snapshotReady,
  loading,
  loadError,
  healthNotice,
  onReload,
  onOpenOrders,
}: DashboardPageProps) {
  const [operations, setOperations] = useState<OrderOperationsSummary | null>(null);
  const [mirror, setMirror] = useState<OrdermentumMirrorHealthRow | null>(null);
  const [inventory, setInventory] = useState<InventoryKpis | null>(null);
  const [barcode, setBarcode] = useState<BarcodeSprintKpis | null>(null);
  const [locations, setLocations] = useState<WarehouseLocationItemRow[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusNotice, setStatusNotice] = useState('');

  const reloadReadiness = useCallback(async () => {
    setStatusLoading(true);
    setStatusNotice('');
    const checks = await Promise.allSettled([
      loadOrderOperationsSummary(),
      supabase ? loadOrdermentumMirrorHealth(supabase) : Promise.resolve({ mirrorHealth: null, mirrorError: 'Supabase is unavailable.' }),
      loadInventoryKpis(),
      loadBarcodeSprintKpis(),
      loadWarehouseLocationItems(),
    ]);

    const [operationsResult, mirrorResult, inventoryResult, barcodeResult, locationsResult] = checks;
    if (operationsResult.status === 'fulfilled') setOperations(operationsResult.value);
    if (mirrorResult.status === 'fulfilled') {
      setMirror(mirrorResult.value.mirrorHealth);
      if (mirrorResult.value.mirrorError) setStatusNotice(mirrorResult.value.mirrorError);
    }
    if (inventoryResult.status === 'fulfilled') setInventory(inventoryResult.value);
    if (barcodeResult.status === 'fulfilled') setBarcode(barcodeResult.value);
    if (locationsResult.status === 'fulfilled') setLocations(locationsResult.value);

    const unavailable = [
      operationsResult.status === 'rejected' ? 'orders' : '',
      mirrorResult.status === 'rejected' ? 'source verification' : '',
      inventoryResult.status === 'rejected' ? 'inventory' : '',
      barcodeResult.status === 'rejected' ? 'barcode coverage' : '',
      locationsResult.status === 'rejected' ? 'warehouse locations' : '',
    ].filter(Boolean);
    if (unavailable.length) setStatusNotice(`Some readiness checks are unavailable: ${unavailable.join(', ')}.`);
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    if (!snapshotReady) return;
    void reloadReadiness();
  }, [reloadReadiness, snapshotReady, data.syncBatch.completedAt]);

  const locationCount = useMemo(() => new Set(locations.map((row) => row.location_code).filter(Boolean)).size, [locations]);
  const liveLocationCount = useMemo(() => new Set(locations.filter((row) => row.item_id && n(row.quantity) > 0).map((row) => row.location_code).filter(Boolean)).size, [locations]);
  const currentOrders = operations
    ? n(operations.current_orders) + n(operations.source_review_orders)
    : orders.length;
  const mirrorStatus = mirror?.overall_status || (snapshotReady ? 'CHECKING' : 'UNAVAILABLE');
  const mirrorReady = mirrorStatus === 'COMPLETE';
  const firstStocktakeStarted = n(inventory?.live_on_hand_units) > 0 || liveLocationCount > 0;
  const readinessStep = !mirrorReady ? 'source' : firstStocktakeStarted ? 'operate' : 'stocktake';
  const roleName = role === 'admin' ? 'Admin' : role === 'owner' ? 'Owner' : role === 'account' ? 'Accounts' : 'Operations';

  if (loading && !snapshotReady) {
    return <section className="field-readiness-loading">Loading the trusted operating snapshot…</section>;
  }

  if (!snapshotReady) {
    return (
      <section className="field-readiness-unavailable" role="alert">
        <div><strong>Live operating data is unavailable</strong><span>{loadError || 'EcoFlow will not show sample warehouse or order figures.'}</span></div>
        <button type="button" onClick={() => void onReload()} disabled={loading}>{loading ? 'Retrying…' : 'Retry live data'}</button>
      </section>
    );
  }

  return (
    <section className="field-readiness-dashboard">
      <header className="field-readiness-hero">
        <div>
          <span>{roleName.toUpperCase()} · CURRENT RELEASE PHASE</span>
          <h1>Prepare the warehouse. Then run the day.</h1>
          <p>Ordermentum supplies the commercial facts. EcoFlow turns those facts into physical stock, controlled picking, delivery and proof.</p>
          <small>{data.businessDay.label} · source verification {dateTime(mirror?.checked_at)}</small>
        </div>
        <div className="field-readiness-actions">
          <a className="field-primary-action" href="/?workspace=warehouse&mode=stocktake">Start first stocktake</a>
          <a href="/warehouse-map">Open warehouse map</a>
          <button type="button" onClick={() => void Promise.all([onReload(), reloadReadiness()])} disabled={loading || statusLoading}>{loading || statusLoading ? 'Refreshing…' : 'Refresh status'}</button>
        </div>
      </header>

      {loadError ? <div className="field-readiness-warning">The last trusted snapshot remains visible. Refresh issue: {loadError}</div> : null}
      {healthNotice || statusNotice ? <div className="field-readiness-note">System note: {healthNotice || statusNotice}</div> : null}

      <section className="field-purpose-grid">
        <article className="field-purpose-card source-card">
          <div className="field-stage-number">1</div>
          <span>ORDERMENTUM · SOURCE</span>
          <h2>Commercial facts arrive ready to use</h2>
          <p>Customers, products, SKUs, package identifiers, orders and invoices remain managed in Ordermentum.</p>
          <div className={`field-status-chip ${mirrorReady ? 'ready' : 'attention'}`}>{mirrorStatus}</div>
          <small>{n(mirror?.projected_order_count)} orders available to EcoFlow · {n(mirror?.order_projection_missing)} projection gaps</small>
        </article>

        <article className="field-purpose-card current-card">
          <div className="field-stage-number">2</div>
          <span>ECOFLOW · CURRENT TASK</span>
          <h2>{firstStocktakeStarted ? 'Continue warehouse stocktake' : 'Establish physical stock truth'}</h2>
          <p>Go location by location. Select the Ordermentum SKU, scan its carton or sleeve barcode, count packages, verify the batch and post opening stock once.</p>
          <a href="/?workspace=warehouse&mode=stocktake">Open guided first stocktake</a>
          <small>{locationCount} warehouse locations available · {n(barcode?.registered_barcodes)} active package codes · {n(inventory?.live_on_hand_units)} live units posted</small>
        </article>

        <article className="field-purpose-card execution-card">
          <div className="field-stage-number">3</div>
          <span>ECOFLOW · DAILY EXECUTION</span>
          <h2>Receive, pick, deliver and prove</h2>
          <p>After opening stock is established, new deliveries use controlled receiving; orders move through release, picking, staging, driver route and two-photo POD.</p>
          <div className="field-future-steps"><span>Daily receiving</span><span>Pick & stage</span><span>Deliver & POD</span></div>
          <small>This stage uses the same SKU, barcode, location and stock ledger created during the first stocktake.</small>
        </article>
      </section>

      <section className="field-readiness-sequence" aria-label="EcoFlow readiness sequence">
        <article className={mirrorReady ? 'done' : 'current'}><b>✓</b><div><strong>Source data</strong><span>Verified commercial mirror</span></div></article>
        <article className={readinessStep === 'stocktake' ? 'current' : firstStocktakeStarted ? 'done' : ''}><b>2</b><div><strong>First stocktake</strong><span>Location, barcode and opening count</span></div></article>
        <article className={readinessStep === 'operate' ? 'current' : ''}><b>3</b><div><strong>Daily warehouse</strong><span>Receiving, picking and staging</span></div></article>
        <article><b>4</b><div><strong>Delivery</strong><span>Route, POD and exceptions</span></div></article>
      </section>

      <section className="field-operations-strip">
        <div><span>Current orders</span><strong>{currentOrders}</strong></div>
        <div><span>Ready for release</span><strong>{n(operations?.ready_to_release)}</strong></div>
        <div><span>In fulfilment</span><strong>{n(operations?.in_progress_orders)}</strong></div>
        <div><span>Live stock locations</span><strong>{liveLocationCount}</strong></div>
        <button type="button" onClick={onOpenOrders}>Review orders</button>
      </section>

      <p className="field-system-footnote">System detail stays available under System. The normal operating path is Today → Warehouse map → First stocktake → Live stock.</p>
    </section>
  );
}
