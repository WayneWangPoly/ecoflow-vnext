import { useMemo, useState } from 'react';
import type { Dispatch, DragEvent, ReactNode, SetStateAction } from 'react';

type Role = 'owner' | 'mobile' | 'warehouse' | 'driver' | 'account';
type OwnerTab = 'orders' | 'inventory' | 'map' | 'sku' | 'settings';
type WarehouseTab = 'receive' | 'putaway' | 'waves' | 'sort';
type DriverTab = 'wave' | 'sort' | 'labels' | 'route' | 'pod' | 'check';
type AccountTab = 'receivables' | 'reconcile' | 'exceptions' | 'settings';

type OrderStatus = 'NEW' | 'RELEASE_READY' | 'RELEASED' | 'WAVE_READY' | 'SECOND_SORT' | 'LOADED' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

type OrderLine = {
  sku: string;
  name: string;
  qty: number;
  unit: 'sleeve' | 'carton';
  stock: number;
  requiredCartons: number;
  requiredSleeves: number;
  pickMode: 'cart_wave' | 'single_pick';
};

type ImportedOrder = {
  id: string;
  orderNo: string;
  store: string;
  address: string;
  suburb: string;
  lat: number;
  lng: number;
  invoiceNo: string;
  eta: string;
  status: OrderStatus;
  selected: boolean;
  sequence: number;
  lines: OrderLine[];
  lockOwner?: 'warehouse' | 'driver';
};

type SkuCandidate = {
  sku: string;
  name: string;
  source: 'Ordermentum';
  cartonBarcode?: string;
  sleeveBarcode?: string;
  status: 'pending' | 'approved';
};

const roleOptions: { role: Role; label: string; password: string; shell: 'desktop' | 'mobile' }[] = [
  { role: 'owner', label: 'Owner', password: '0000', shell: 'desktop' },
  { role: 'mobile', label: 'Mobile', password: '2222', shell: 'mobile' },
  { role: 'warehouse', label: 'Warehouse', password: '4444', shell: 'mobile' },
  { role: 'driver', label: 'Driver', password: '6666', shell: 'mobile' },
  { role: 'account', label: 'Account', password: '0000', shell: 'desktop' }
];

const initialOrders: ImportedOrder[] = [
  {
    id: 'order-omo-test-001',
    orderNo: 'OMO-TEST-001',
    store: 'Ordermentum Test Site',
    address: 'Ordermentum test delivery address, Adelaide SA 5000',
    suburb: 'Adelaide',
    lat: -34.9285,
    lng: 138.6007,
    invoiceNo: 'OMO-INV-TEST-001',
    eta: '10:30',
    status: 'RELEASE_READY',
    selected: true,
    sequence: 1,
    lockOwner: undefined,
    lines: [
      {
        sku: 'JP-PBS-6X197-ARTBOX',
        name: 'BioPak 6x197mm Paper Straw Art Series',
        qty: 11,
        unit: 'sleeve',
        stock: 11,
        requiredCartons: 1,
        requiredSleeves: 1,
        pickMode: 'cart_wave'
      }
    ]
  },
  {
    id: 'order-omo-test-002',
    orderNo: 'OMO-TEST-002',
    store: 'CBD Sushi Bar',
    address: 'King William Street, Adelaide SA 5000',
    suburb: 'CBD',
    lat: -34.9241,
    lng: 138.5997,
    invoiceNo: 'OMO-INV-TEST-002',
    eta: '11:05',
    status: 'RELEASE_READY',
    selected: true,
    sequence: 2,
    lines: [
      {
        sku: 'CCSPW16-90',
        name: 'ComPak PLA Compostable Single Wall Coffee Cup Plain White 16oz 90mm',
        qty: 2,
        unit: 'carton',
        stock: 6,
        requiredCartons: 2,
        requiredSleeves: 0,
        pickMode: 'single_pick'
      }
    ]
  },
  {
    id: 'order-omo-test-003',
    orderNo: 'OMO-TEST-003',
    store: 'North Terrace Cafe',
    address: 'North Terrace, Adelaide SA 5000',
    suburb: 'CBD',
    lat: -34.9215,
    lng: 138.6042,
    invoiceNo: 'OMO-INV-TEST-003',
    eta: '11:40',
    status: 'RELEASE_READY',
    selected: false,
    sequence: 3,
    lines: [
      {
        sku: 'CCSPW8-90',
        name: 'ComPak PLA Compostable Single Wall Coffee Cup Plain White 8oz 90mm',
        qty: 4,
        unit: 'sleeve',
        stock: 20,
        requiredCartons: 0,
        requiredSleeves: 4,
        pickMode: 'cart_wave'
      }
    ]
  }
];

const initialSkuCandidates: SkuCandidate[] = [
  {
    sku: 'BIO-LID-90-WHITE',
    name: 'Ordermentum detected new 90mm white PLA lid',
    source: 'Ordermentum',
    cartonBarcode: '09300000000001',
    sleeveBarcode: '09300000000018',
    status: 'pending'
  }
];

function cls(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function roleLabel(role: Role) {
  return roleOptions.find((option) => option.role === role)?.label ?? role;
}

function totalRequiredBySku(orders: ImportedOrder[]) {
  const rows = new Map<string, { sku: string; name: string; required: number; stock: number; shortage: number }>();
  orders.forEach((order) => {
    if (!['RELEASE_READY', 'RELEASED', 'WAVE_READY', 'SECOND_SORT'].includes(order.status)) return;
    order.lines.forEach((line) => {
      const current = rows.get(line.sku) ?? { sku: line.sku, name: line.name, required: 0, stock: line.stock, shortage: 0 };
      current.required += line.qty;
      current.stock = Math.min(current.stock, line.stock);
      current.shortage = Math.max(0, current.required - current.stock);
      rows.set(line.sku, current);
    });
  });
  return Array.from(rows.values());
}

function mapLink(order: ImportedOrder) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`;
}

function LoginScreen({ onLogin }: { onLogin: (role: Role) => void }) {
  const [role, setRole] = useState<Role>('owner');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function submit() {
    const option = roleOptions.find((candidate) => candidate.role === role);
    if (option && password === option.password) {
      window.localStorage.setItem('ecoflow-role', role);
      onLogin(role);
      return;
    }
    setError('Wrong password for selected role.');
  }

  return (
    <div className="login-viewport">
      <section className="login-card">
        <div className="brand-row">
          <span className="brand-mark">EF</span>
          <div>
            <h1>EcoFlow vNext</h1>
            <p>Ordermentum fulfilment login</p>
          </div>
        </div>
        <label className="field-label" htmlFor="role-select">Role</label>
        <select id="role-select" className="input" value={role} onChange={(event) => setRole(event.target.value as Role)}>
          {roleOptions.map((option) => <option key={option.role} value={option.role}>{option.label}</option>)}
        </select>
        <label className="field-label" htmlFor="password">Password</label>
        <input id="password" className="input" inputMode="numeric" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} />
        {error ? <div className="inline-error">{error}</div> : null}
        <button className="btn primary" type="button" onClick={submit}>Enter</button>
        <div className="login-hint">Owner 0000 · Mobile 2222 · Warehouse 4444 · Driver 6666 · Account uses Owner code for now</div>
      </section>
    </div>
  );
}

function AppShell({ role, onLogout, children }: { role: Role; onLogout: () => void; children: ReactNode }) {
  const shell = roleOptions.find((option) => option.role === role)?.shell ?? 'mobile';
  return (
    <div className={cls('app-viewport', shell === 'desktop' ? 'desktop-viewport' : 'mobile-viewport')}>
      <div className={cls('app-shell', shell === 'desktop' ? 'desktop-shell' : 'phone-shell')}>
        <header className="topbar">
          <div>
            <div className="eyebrow">EcoFlow Fulfilment OS</div>
            <strong>{roleLabel(role)}</strong>
          </div>
          <button className="ghost-btn" type="button" onClick={onLogout}>Logout</button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}

function StatusPill({ children }: { children: ReactNode }) {
  return <span className="status-pill">{children}</span>;
}

function CompactOrderRow({ order, selected, onToggle, onMoveUp, onMoveDown, draggable, onDragStart, onDragOver, onDrop }: {
  order: ImportedOrder;
  selected?: boolean;
  onToggle?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (event: DragEvent) => void;
  onDrop?: () => void;
}) {
  const line = order.lines[0];
  return (
    <article className="order-row" draggable={draggable} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}>
      <div className="order-seq">{order.sequence}</div>
      <div className="order-main">
        <div className="order-title-line">
          <strong>{order.orderNo}</strong>
          <StatusPill>{order.status}</StatusPill>
        </div>
        <div className="muted small">{order.store} · {order.suburb}</div>
        <div className="muted small">{line.sku} · {line.qty} {line.unit} · stock {line.stock}</div>
        <div className="muted small">{order.address}</div>
      </div>
      <div className="row-actions">
        {typeof selected === 'boolean' ? <input aria-label={`select ${order.orderNo}`} type="checkbox" checked={selected} onChange={onToggle} /> : null}
        {onMoveUp ? <button className="mini-btn" type="button" onClick={onMoveUp}>↑</button> : null}
        {onMoveDown ? <button className="mini-btn" type="button" onClick={onMoveDown}>↓</button> : null}
      </div>
    </article>
  );
}

function MapPanel({ orders, compact = false }: { orders: ImportedOrder[]; compact?: boolean }) {
  return (
    <section className={cls('map-panel', compact && 'map-panel-compact')}>
      <div className="map-toolbar">
        <strong>Delivery map</strong>
        <span>{orders.length} stops</span>
      </div>
      <div className="map-canvas" aria-label="Map preview">
        {orders.map((order, index) => (
          <a
            key={order.id}
            className="map-marker"
            style={{ left: `${18 + (index * 23) % 64}%`, top: `${26 + (index * 17) % 48}%` }}
            href={mapLink(order)}
            target="_blank"
            rel="noreferrer"
            title={order.address}
          >
            {order.sequence}
          </a>
        ))}
      </div>
      <div className="muted small">Marker sequence follows the list order. Tap a marker to open Google Maps.</div>
    </section>
  );
}

function OwnerDesk({ mobile = false, orders, setOrders, skuCandidates, setSkuCandidates }: {
  mobile?: boolean;
  orders: ImportedOrder[];
  setOrders: Dispatch<SetStateAction<ImportedOrder[]>>;
  skuCandidates: SkuCandidate[];
  setSkuCandidates: Dispatch<SetStateAction<SkuCandidate[]>>;
}) {
  const [tab, setTab] = useState<OwnerTab>('orders');
  const [dragId, setDragId] = useState<string | null>(null);
  const newOrders = orders.filter((order) => order.status === 'RELEASE_READY').length;
  const selectedCount = orders.filter((order) => order.selected && order.status === 'RELEASE_READY').length;
  const requiredRows = useMemo(() => totalRequiredBySku(orders), [orders]);
  const orderedStops = [...orders].sort((a, b) => a.sequence - b.sequence);

  function toggleAll() {
    const shouldSelect = selectedCount !== newOrders;
    setOrders((current) => current.map((order) => order.status === 'RELEASE_READY' ? { ...order, selected: shouldSelect } : order));
  }

  function releaseSelected() {
    setOrders((current) => current.map((order) => order.selected && order.status === 'RELEASE_READY'
      ? { ...order, status: 'RELEASED', lockOwner: undefined }
      : order));
  }

  function refreshImports() {
    setOrders((current) => current.map((order) => order.status === 'NEW' ? { ...order, status: 'RELEASE_READY' } : order));
  }

  function approveSku(sku: string) {
    setSkuCandidates((current) => current.map((candidate) => candidate.sku === sku ? { ...candidate, status: 'approved' } : candidate));
  }

  function moveOrder(orderId: string, direction: -1 | 1) {
    setOrders((current) => {
      const sorted = [...current].sort((a, b) => a.sequence - b.sequence);
      const index = sorted.findIndex((order) => order.id === orderId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= sorted.length) return current;
      const temp = sorted[index];
      sorted[index] = sorted[target];
      sorted[target] = temp;
      return current.map((order) => {
        const newIndex = sorted.findIndex((candidate) => candidate.id === order.id);
        return { ...order, sequence: newIndex + 1 };
      });
    });
  }

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    setOrders((current) => {
      const sorted = [...current].sort((a, b) => a.sequence - b.sequence);
      const from = sorted.findIndex((order) => order.id === dragId);
      const to = sorted.findIndex((order) => order.id === targetId);
      if (from < 0 || to < 0) return current;
      const [moving] = sorted.splice(from, 1);
      sorted.splice(to, 0, moving);
      return current.map((order) => ({ ...order, sequence: sorted.findIndex((candidate) => candidate.id === order.id) + 1 }));
    });
    setDragId(null);
  }

  return (
    <main className={cls('workspace', mobile && 'mobile-workspace')}>
      <section className="page-head">
        <div>
          <h1>{mobile ? 'Owner Mobile' : 'Owner Command Centre'}</h1>
          <p>Ordermentum import, release, inventory, route order, SKU approval.</p>
        </div>
        <div className="head-actions">
          <button className="btn secondary compact" type="button" onClick={refreshImports}>Refresh</button>
          <button className="btn primary compact" type="button" onClick={releaseSelected} disabled={!selectedCount}>Release {selectedCount}</button>
        </div>
      </section>

      <nav className="tabbar">
        <button className={cls(tab === 'orders' && 'active')} type="button" onClick={() => setTab('orders')}>Orders <Badge>{newOrders}</Badge></button>
        <button className={cls(tab === 'inventory' && 'active')} type="button" onClick={() => setTab('inventory')}>Inventory</button>
        <button className={cls(tab === 'map' && 'active')} type="button" onClick={() => setTab('map')}>Map</button>
        <button className={cls(tab === 'sku' && 'active')} type="button" onClick={() => setTab('sku')}>New SKU <Badge>{skuCandidates.filter((candidate) => candidate.status === 'pending').length}</Badge></button>
        <button className={cls(tab === 'settings' && 'active')} type="button" onClick={() => setTab('settings')}>Settings</button>
      </nav>

      {tab === 'orders' ? (
        <section className="desktop-grid two-one">
          <div className="panel">
            <div className="panel-title-row">
              <strong>Ordermentum release queue</strong>
              <button className="link-btn" type="button" onClick={toggleAll}>{selectedCount === newOrders ? 'Clear' : 'Select all'}</button>
            </div>
            <div className="row-list dense-list">
              {orderedStops.map((order) => (
                <CompactOrderRow
                  key={order.id}
                  order={order}
                  selected={order.selected}
                  onToggle={() => setOrders((current) => current.map((candidate) => candidate.id === order.id ? { ...candidate, selected: !candidate.selected } : candidate))}
                  onMoveUp={() => moveOrder(order.id, -1)}
                  onMoveDown={() => moveOrder(order.id, 1)}
                  draggable
                  onDragStart={() => setDragId(order.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropOn(order.id)}
                />
              ))}
            </div>
          </div>
          <div className="panel stack-panel">
            <strong>Release stock check</strong>
            {requiredRows.map((row) => (
              <div className="stock-row" key={row.sku}>
                <span>{row.sku}</span>
                <strong className={row.shortage ? 'danger-text' : 'ok-text'}>{row.required}/{row.stock}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === 'inventory' ? (
        <section className="panel">
          <div className="panel-title-row"><strong>Required goods live view</strong><span className="muted small">release-sensitive</span></div>
          <div className="inventory-table">
            {requiredRows.map((row) => (
              <div className="inventory-line" key={row.sku}>
                <div><strong>{row.sku}</strong><span>{row.name}</span></div>
                <div>Need {row.required}</div>
                <div>Stock {row.stock}</div>
                <div className={row.shortage ? 'danger-text' : 'ok-text'}>{row.shortage ? `Short ${row.shortage}` : 'OK'}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === 'map' ? (
        <section className="desktop-grid map-layout">
          <MapPanel orders={orderedStops} compact={mobile} />
          <div className="panel">
            <strong>Route order</strong>
            <div className="row-list dense-list">
              {orderedStops.map((order) => (
                <CompactOrderRow key={order.id} order={order} onMoveUp={() => moveOrder(order.id, -1)} onMoveDown={() => moveOrder(order.id, 1)} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'sku' ? (
        <section className="panel">
          <div className="panel-title-row"><strong>Ordermentum detected SKU</strong><span className="muted small">approve into SKU master</span></div>
          {skuCandidates.map((candidate) => (
            <article className="sku-candidate" key={candidate.sku}>
              <div>
                <strong>{candidate.sku}</strong>
                <span>{candidate.name}</span>
                <span className="muted small">carton {candidate.cartonBarcode} · sleeve {candidate.sleeveBarcode}</span>
              </div>
              <button className="btn secondary compact" disabled={candidate.status === 'approved'} type="button" onClick={() => approveSku(candidate.sku)}>
                {candidate.status === 'approved' ? 'Added' : 'Approve add'}
              </button>
            </article>
          ))}
        </section>
      ) : null}

      {tab === 'settings' ? <SettingsPanel role={mobile ? 'Mobile Owner' : 'Owner'} /> : null}
    </main>
  );
}

function SettingsPanel({ role }: { role: string }) {
  return (
    <section className="panel settings-grid">
      <div><strong>{role} settings</strong><span>Operational defaults</span></div>
      <label><span>Auto-refresh Ordermentum</span><select className="input compact-input" defaultValue="manual"><option value="manual">Manual refresh</option><option value="5">Every 5 min</option></select></label>
      <label><span>Release mode</span><select className="input compact-input" defaultValue="review"><option value="review">Review before release</option><option value="bulk">Bulk release allowed</option></select></label>
      <label><span>Label printer</span><select className="input compact-input" defaultValue="bluetooth"><option value="bluetooth">Bluetooth label printer</option></select></label>
      <label><span>POD requirement</span><select className="input compact-input" defaultValue="photo"><option value="photo">Photo required</option></select></label>
    </section>
  );
}

function WarehouseDesk({ orders, setOrders }: { orders: ImportedOrder[]; setOrders: Dispatch<SetStateAction<ImportedOrder[]>> }) {
  const [tab, setTab] = useState<WarehouseTab>('receive');
  const lockedByDriver = orders.some((order) => order.lockOwner === 'driver');

  function claimWarehouse(orderId: string) {
    setOrders((current) => current.map((order) => order.id === orderId && !order.lockOwner ? { ...order, lockOwner: 'warehouse' } : order));
  }

  function releaseLock(orderId: string) {
    setOrders((current) => current.map((order) => order.id === orderId && order.lockOwner === 'warehouse' ? { ...order, lockOwner: undefined } : order));
  }

  return (
    <main className="workspace mobile-workspace">
      <section className="page-head compact-head"><div><h1>Warehouse</h1><p>Receiving, putaway, wave pick, second sort.</p></div></section>
      <nav className="tabbar mobile-tabs">
        <button className={cls(tab === 'receive' && 'active')} type="button" onClick={() => setTab('receive')}>Receive</button>
        <button className={cls(tab === 'putaway' && 'active')} type="button" onClick={() => setTab('putaway')}>Putaway</button>
        <button className={cls(tab === 'waves' && 'active')} type="button" onClick={() => setTab('waves')}>Wave</button>
        <button className={cls(tab === 'sort' && 'active')} type="button" onClick={() => setTab('sort')}>Sort</button>
      </nav>

      {tab === 'receive' ? (
        <section className="panel mobile-card-stack">
          <strong>Receiving is for new stock unloading</strong>
          <div className="scan-card"><span>1</span><strong>Scan product barcode</strong><p>Carton/sleeve barcode resolves SKU and unit.</p></div>
          <div className="scan-card"><span>2</span><strong>Add to receiving batch</strong><p>Stock goes to STAGING, not customer order.</p></div>
          <button className="btn primary" type="button">Scan new goods</button>
        </section>
      ) : null}

      {tab === 'putaway' ? (
        <section className="panel mobile-card-stack">
          <strong>Putaway from STAGING</strong>
          <div className="scan-card"><span>A1</span><strong>A1-01-02A</strong><p>Assigned SKU JP-PBS-6X197-ARTBOX · LOC-A1-01-02A</p></div>
          <button className="btn primary" type="button">Scan location</button>
        </section>
      ) : null}

      {tab === 'waves' ? (
        <section className="panel mobile-card-stack">
          <div className="lock-banner">Order lock: warehouse and driver cannot process the same goods at the same time.</div>
          {orders.filter((order) => ['RELEASED', 'WAVE_READY'].includes(order.status)).map((order) => (
            <article className="mobile-order-card" key={order.id}>
              <strong>{order.orderNo}</strong>
              <span>{order.lines[0].sku} · {order.lines[0].pickMode === 'cart_wave' ? '4-grid cart wave' : 'single pick'}</span>
              <span>Lock: {order.lockOwner ?? 'free'}</span>
              <button className="btn secondary" type="button" disabled={Boolean(order.lockOwner && order.lockOwner !== 'warehouse')} onClick={() => claimWarehouse(order.id)}>Claim wave task</button>
              <button className="link-btn" type="button" onClick={() => releaseLock(order.id)}>Release lock</button>
            </article>
          ))}
          {lockedByDriver ? <div className="inline-warning">Some released goods are currently locked by driver.</div> : null}
        </section>
      ) : null}

      {tab === 'sort' ? (
        <section className="panel mobile-card-stack">
          <strong>Second sort requires scan</strong>
          <div className="scan-card"><span>SCAN</span><strong>19344062036170</strong><p>carton +10 sleeves</p></div>
          <div className="scan-card"><span>SCAN</span><strong>9344062033639</strong><p>sleeve +1 sleeve</p></div>
          <button className="btn primary" type="button">Confirm sorted</button>
        </section>
      ) : null}
    </main>
  );
}

function DriverDesk({ orders, setOrders }: { orders: ImportedOrder[]; setOrders: Dispatch<SetStateAction<ImportedOrder[]>> }) {
  const [tab, setTab] = useState<DriverTab>('check');
  const [checks, setChecks] = useState({ licence: false, vehicle: false, load: false });
  const allChecked = checks.licence && checks.vehicle && checks.load;
  const releasedOrders = orders.filter((order) => ['RELEASED', 'WAVE_READY', 'SECOND_SORT', 'LOADED', 'OUT_FOR_DELIVERY'].includes(order.status));
  const cartWaveOrders = releasedOrders.filter((order) => order.lines.some((line) => line.pickMode === 'cart_wave'));
  const singlePickOrders = releasedOrders.filter((order) => order.lines.some((line) => line.pickMode === 'single_pick'));
  const orderedStops = [...orders].sort((a, b) => a.sequence - b.sequence);

  function claimDriver(orderId: string) {
    setOrders((current) => current.map((order) => order.id === orderId && !order.lockOwner ? { ...order, lockOwner: 'driver', status: 'WAVE_READY' } : order));
  }

  function markOutForDelivery() {
    if (!allChecked) return;
    setOrders((current) => current.map((order) => order.status === 'LOADED' || order.status === 'WAVE_READY' || order.status === 'SECOND_SORT'
      ? { ...order, status: 'OUT_FOR_DELIVERY' }
      : order));
  }

  function markDelivered(orderId: string) {
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, status: 'DELIVERED', lockOwner: undefined } : order));
  }

  return (
    <main className="workspace mobile-workspace">
      <section className="page-head compact-head"><div><h1>Driver</h1><p>Pre-check, wave, labels, route, POD.</p></div></section>
      <nav className="tabbar mobile-tabs driver-tabs">
        <button className={cls(tab === 'check' && 'active')} type="button" onClick={() => setTab('check')}>Check</button>
        <button className={cls(tab === 'wave' && 'active')} type="button" onClick={() => setTab('wave')}>Wave</button>
        <button className={cls(tab === 'sort' && 'active')} type="button" onClick={() => setTab('sort')}>Sort</button>
        <button className={cls(tab === 'labels' && 'active')} type="button" onClick={() => setTab('labels')}>Labels</button>
        <button className={cls(tab === 'route' && 'active')} type="button" onClick={() => setTab('route')}>Route</button>
        <button className={cls(tab === 'pod' && 'active')} type="button" onClick={() => setTab('pod')}>POD</button>
      </nav>

      {tab === 'check' ? (
        <section className="panel mobile-card-stack">
          <strong>Pre-departure check</strong>
          {[
            ['licence', 'Driver fit, licence, phone charged'],
            ['vehicle', 'Vehicle tyres, lights, fuel, safety'],
            ['load', 'Load secured, labels visible, POD camera ready']
          ].map(([key, label]) => (
            <label className="check-row" key={key}><input type="checkbox" checked={checks[key as keyof typeof checks]} onChange={(event) => setChecks((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>
          ))}
          <button className="btn primary" disabled={!allChecked} type="button" onClick={markOutForDelivery}>Start delivery</button>
        </section>
      ) : null}

      {tab === 'wave' ? (
        <section className="panel mobile-card-stack">
          <strong>System wave decision</strong>
          <div className="wave-box"><b>4-grid cart wave</b><span>{cartWaveOrders.length || 0} orders · can generate even under 4 grids</span><small>No scan during wave pickup.</small></div>
          <div className="wave-box"><b>Single pick</b><span>{singlePickOrders.length || 0} bulky carton orders</span><small>Large cartons move as one carton one label.</small></div>
          {releasedOrders.map((order) => (
            <article className="mobile-order-card" key={order.id}>
              <strong>{order.orderNo}</strong>
              <span>{order.lines[0].pickMode === 'cart_wave' ? 'cart wave' : 'single pick'} · lock {order.lockOwner ?? 'free'}</span>
              <button className="btn secondary" type="button" disabled={Boolean(order.lockOwner && order.lockOwner !== 'driver')} onClick={() => claimDriver(order.id)}>Claim driver wave</button>
            </article>
          ))}
        </section>
      ) : null}

      {tab === 'sort' ? (
        <section className="panel mobile-card-stack">
          <strong>Second sort scan</strong>
          <div className="scan-card"><span>Grid 1</span><strong>OMO-TEST-001</strong><p>Scan carton 19344062036170, then sleeve 9344062033639.</p></div>
          <button className="btn primary" type="button" onClick={() => setOrders((current) => current.map((order) => order.lockOwner === 'driver' ? { ...order, status: 'SECOND_SORT' } : order))}>Confirm second sort</button>
        </section>
      ) : null}

      {tab === 'labels' ? (
        <section className="panel mobile-card-stack">
          <strong>Label preview</strong>
          {releasedOrders.map((order) => {
            const labelCount = order.lines.reduce((total, line) => total + (line.pickMode === 'single_pick' ? Math.max(1, line.requiredCartons || line.qty) : 1), 0);
            return <div className="label-preview" key={order.id}><b>{order.orderNo}</b><span>{labelCount} label{labelCount > 1 ? 's' : ''}</span><small>Small goods packed together. Large carton = one label each.</small></div>;
          })}
          <button className="btn primary" type="button">Print to Bluetooth printer</button>
        </section>
      ) : null}

      {tab === 'route' ? (
        <section className="panel mobile-card-stack">
          <MapPanel orders={orderedStops.filter((order) => order.status !== 'DELIVERED')} compact />
          {orderedStops.map((order) => <CompactOrderRow key={order.id} order={order} />)}
        </section>
      ) : null}

      {tab === 'pod' ? (
        <section className="panel mobile-card-stack">
          <strong>POD photo upload</strong>
          {orderedStops.filter((order) => order.status === 'OUT_FOR_DELIVERY').map((order) => (
            <article className="mobile-order-card" key={order.id}>
              <strong>{order.orderNo}</strong><span>{order.store}</span><span>{order.address}</span>
              <button className="btn primary" type="button" onClick={() => markDelivered(order.id)}>Take POD photo</button>
            </article>
          ))}
          {!orderedStops.some((order) => order.status === 'OUT_FOR_DELIVERY') ? <div className="empty-state">No active delivery stop.</div> : null}
        </section>
      ) : null}
    </main>
  );
}

function AccountDesk({ orders }: { orders: ImportedOrder[] }) {
  const [tab, setTab] = useState<AccountTab>('receivables');
  const delivered = orders.filter((order) => order.status === 'DELIVERED').length;
  return (
    <main className="workspace">
      <section className="page-head"><div><h1>Account Desk</h1><p>Invoice follow-up, reconciliation, delivery proof, account exceptions.</p></div></section>
      <nav className="tabbar">
        <button className={cls(tab === 'receivables' && 'active')} type="button" onClick={() => setTab('receivables')}>Receivables</button>
        <button className={cls(tab === 'reconcile' && 'active')} type="button" onClick={() => setTab('reconcile')}>Reconcile</button>
        <button className={cls(tab === 'exceptions' && 'active')} type="button" onClick={() => setTab('exceptions')}>Exceptions</button>
        <button className={cls(tab === 'settings' && 'active')} type="button" onClick={() => setTab('settings')}>Settings</button>
      </nav>
      {tab === 'receivables' ? (
        <section className="panel">
          <div className="panel-title-row"><strong>Invoice control</strong><span>{delivered} delivered with POD</span></div>
          <div className="inventory-table">
            {orders.map((order) => <div className="inventory-line" key={order.id}><div><strong>{order.invoiceNo}</strong><span>{order.store}</span></div><div>{order.orderNo}</div><div>{order.status}</div><div>POD {order.status === 'DELIVERED' ? 'ready' : 'pending'}</div></div>)}
          </div>
        </section>
      ) : null}
      {tab === 'reconcile' ? <section className="panel"><strong>Bank and invoice matching</strong><p className="muted">Import bank statement later; match Ordermentum invoice number, customer, amount, delivery proof.</p></section> : null}
      {tab === 'exceptions' ? <section className="panel"><strong>Account exceptions</strong><p className="muted">Missing POD, disputed invoice, short delivery, credit hold.</p></section> : null}
      {tab === 'settings' ? <SettingsPanel role="Account" /> : null}
    </main>
  );
}

export function App() {
  const [role, setRole] = useState<Role | null>(() => (window.localStorage.getItem('ecoflow-role') as Role | null));
  const [orders, setOrders] = useState<ImportedOrder[]>(initialOrders);
  const [skuCandidates, setSkuCandidates] = useState<SkuCandidate[]>(initialSkuCandidates);

  function logout() {
    window.localStorage.removeItem('ecoflow-role');
    setRole(null);
  }

  if (!role || !roleOptions.some((option) => option.role === role)) return <LoginScreen onLogin={setRole} />;

  return (
    <AppShell role={role} onLogout={logout}>
      {role === 'owner' ? <OwnerDesk orders={orders} setOrders={setOrders} skuCandidates={skuCandidates} setSkuCandidates={setSkuCandidates} /> : null}
      {role === 'mobile' ? <OwnerDesk mobile orders={orders} setOrders={setOrders} skuCandidates={skuCandidates} setSkuCandidates={setSkuCandidates} /> : null}
      {role === 'warehouse' ? <WarehouseDesk orders={orders} setOrders={setOrders} /> : null}
      {role === 'driver' ? <DriverDesk orders={orders} setOrders={setOrders} /> : null}
      {role === 'account' ? <AccountDesk orders={orders} /> : null}
    </AppShell>
  );
}
