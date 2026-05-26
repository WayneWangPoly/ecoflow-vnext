import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';

type Role = 'owner' | 'warehouse' | 'driver';
type OwnerTab = 'today' | 'orders' | 'labels' | 'map';
type WarehouseTab = 'wave' | 'batch' | 'pack' | 'locations';
type DriverTab = 'load' | 'route' | 'pod';
type Unit = 'sleeve' | 'carton';
type OrderStatus = 'IMPORTED' | 'RELEASED' | 'PICKING' | 'BULK_PICKED' | 'PACKED' | 'STAGED' | 'LOADED' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
type BoxPositionId = 'A' | 'B' | 'C' | 'D' | 'DECK' | 'BULK';

type WarehouseLocation = {
  id: string;
  code: string;
  name: string;
  category: string;
  row: number;
  rack: number;
  scanCode: string;
};

type Sku = {
  id: string;
  name: string;
  category: string;
  locationId: string;
  sleeveBarcode: string;
  cartonBarcode?: string;
  sleevesPerCarton: number;
};

type OrderLine = {
  id: string;
  skuId: string;
  qty: number;
  unit: Unit;
};

type Order = {
  id: string;
  orderNo: string;
  invoiceNo: string;
  store: string;
  address: string;
  suburb: string;
  route: string;
  stop: number;
  status: OrderStatus;
  deliveryNote?: string;
  lines: OrderLine[];
  packageCount: number;
  documentsBox: number;
};

type TrolleyAssignment = {
  orderId: string;
  slot: BoxPositionId;
  reason: string;
};

type PickTask = {
  id: string;
  locationId: string;
  skuId: string;
  orderId: string;
  qty: number;
  unit: Unit;
  slot: BoxPositionId;
};

type BatchPickTask = {
  id: string;
  locationId: string;
  skuId: string;
  totalQty: number;
  allocations: Array<{ orderId: string; qty: number }>;
};

const roleOptions: Array<{ role: Role; label: string; passcode: string }> = [
  { role: 'owner', label: 'Owner', passcode: '0000' },
  { role: 'warehouse', label: 'Warehouse', passcode: '4444' },
  { role: 'driver', label: 'Driver', passcode: '6666' }
];

const BOX_LETTERS: BoxPositionId[] = ['A', 'B', 'C', 'D'];
const MAX_BOX_CAPACITY = 16;
const STORAGE_KEY_ORDERS = 'ecoflow-orders-v4';
const STORAGE_KEY_UNDO = 'ecoflow-orders-undo-v4';

const locations: WarehouseLocation[] = [
  { id: 'loc-cup-01', code: 'A1', name: 'A1 Coffee Cups Rack', category: 'Cups', row: 1, rack: 1, scanCode: 'LOC-A1-CUPS' },
  { id: 'loc-lid-01', code: 'A2', name: 'A2 Lids Rack', category: 'Lids', row: 1, rack: 2, scanCode: 'LOC-A2-LIDS' },
  { id: 'loc-bowl-01', code: 'B1', name: 'B1 Bowls Rack', category: 'Bowls', row: 2, rack: 1, scanCode: 'LOC-B1-BOWLS' },
  { id: 'loc-straw-01', code: 'B2', name: 'B2 Straws & Cutlery Rack', category: 'Accessories', row: 2, rack: 2, scanCode: 'LOC-B2-ACCESSORIES' },
  { id: 'loc-napkin-01', code: 'C1', name: 'C1 Napkins Rack', category: 'Napkins', row: 3, rack: 1, scanCode: 'LOC-C1-NAPKINS' }
];

const skus: Sku[] = [
  {
    id: 'CCSPW8-90',
    name: '8oz White Compostable Coffee Cup',
    category: 'Cups',
    locationId: 'loc-cup-01',
    sleeveBarcode: '9344062033639',
    cartonBarcode: '19344062033636',
    sleevesPerCarton: 20
  },
  {
    id: 'CCSPW12-90',
    name: '12oz White Compostable Coffee Cup',
    category: 'Cups',
    locationId: 'loc-cup-01',
    sleeveBarcode: '9344062033615',
    cartonBarcode: '19344062033612',
    sleevesPerCarton: 20
  },
  {
    id: 'CPLA-LID-90',
    name: '90mm White PLA Lid',
    category: 'Lids',
    locationId: 'loc-lid-01',
    sleeveBarcode: '9344062090908',
    cartonBarcode: '19344062090905',
    sleevesPerCarton: 10
  },
  {
    id: 'BOWL-24-WHT',
    name: '24oz White Bowl',
    category: 'Bowls',
    locationId: 'loc-bowl-01',
    sleeveBarcode: '9344062042426',
    cartonBarcode: '19344062042423',
    sleevesPerCarton: 10
  },
  {
    id: 'JP-PBS-6X197-ARTBOX',
    name: '6x197mm Paper Straw Art Series',
    category: 'Accessories',
    locationId: 'loc-straw-01',
    sleeveBarcode: '9344062019770',
    cartonBarcode: '19344062019777',
    sleevesPerCarton: 50
  },
  {
    id: 'NAPKIN-KRAFT',
    name: 'Kraft Lunch Napkin Sleeve',
    category: 'Napkins',
    locationId: 'loc-napkin-01',
    sleeveBarcode: '9344062055556',
    cartonBarcode: '19344062055553',
    sleevesPerCarton: 12
  }
];

const seedOrders: Order[] = [
  {
    id: 'order-101',
    orderNo: 'OMO-10231',
    invoiceNo: 'INV-10231',
    store: 'Bright Bean Cafe',
    address: '88 Exeter Terrace, Dudley Park SA 5008',
    suburb: 'Dudley Park',
    route: 'CITY-NORTH-01',
    stop: 1,
    status: 'RELEASED',
    packageCount: 1,
    documentsBox: 1,
    deliveryNote: 'Front counter before 11am',
    lines: [
      { id: 'line-101-a', skuId: 'CCSPW8-90', qty: 3, unit: 'sleeve' },
      { id: 'line-101-b', skuId: 'CPLA-LID-90', qty: 3, unit: 'sleeve' }
    ]
  },
  {
    id: 'order-102',
    orderNo: 'OMO-10232',
    invoiceNo: 'INV-10232',
    store: 'North Terrace Espresso',
    address: 'North Terrace, Adelaide SA 5000',
    suburb: 'Adelaide',
    route: 'CITY-NORTH-01',
    stop: 2,
    status: 'RELEASED',
    packageCount: 2,
    documentsBox: 1,
    deliveryNote: 'Call owner if no parking',
    lines: [
      { id: 'line-102-a', skuId: 'CCSPW12-90', qty: 1, unit: 'carton' },
      { id: 'line-102-b', skuId: 'NAPKIN-KRAFT', qty: 2, unit: 'sleeve' }
    ]
  },
  {
    id: 'order-103',
    orderNo: 'OMO-10233',
    invoiceNo: 'INV-10233',
    store: 'Campus Sushi Bar',
    address: 'King William Street, Adelaide SA 5000',
    suburb: 'Adelaide',
    route: 'CITY-NORTH-01',
    stop: 3,
    status: 'PACKED',
    packageCount: 1,
    documentsBox: 1,
    lines: [
      { id: 'line-103-a', skuId: 'BOWL-24-WHT', qty: 4, unit: 'sleeve' },
      { id: 'line-103-b', skuId: 'JP-PBS-6X197-ARTBOX', qty: 1, unit: 'sleeve' }
    ]
  },
  {
    id: 'order-104',
    orderNo: 'OMO-10234',
    invoiceNo: 'INV-10234',
    store: 'Parkside Coffee Window',
    address: 'Unley Road, Parkside SA 5063',
    suburb: 'Parkside',
    route: 'CITY-SOUTH-01',
    stop: 1,
    status: 'IMPORTED',
    packageCount: 1,
    documentsBox: 1,
    lines: [
      { id: 'line-104-a', skuId: 'CCSPW8-90', qty: 1, unit: 'sleeve' },
      { id: 'line-104-b', skuId: 'CPLA-LID-90', qty: 1, unit: 'sleeve' }
    ]
  }
];

function findSku(skuId: string) {
  return skus.find((sku) => sku.id === skuId)!;
}

function findLocation(locationId: string) {
  return locations.find((location) => location.id === locationId)!;
}

function orderSleeveEquivalent(order: Order) {
  return order.lines.reduce((total, line) => {
    const sku = findSku(line.skuId);
    return total + (line.unit === 'carton' ? line.qty * sku.sleevesPerCarton : line.qty);
  }, 0);
}

function suggestedPackageCount(order: Order) {
  const cartons = order.lines.filter((line) => line.unit === 'carton').reduce((total, line) => total + line.qty, 0);
  const sleeves = order.lines.filter((line) => line.unit === 'sleeve').reduce((total, line) => total + line.qty, 0);
  if (cartons >= 2) return Math.min(6, cartons);
  if (cartons === 1 && sleeves > 2) return 2;
  if (sleeves > 8) return 2;
  return 1;
}

function buildTrolleyAssignments(orders: Order[]): TrolleyAssignment[] {
  const { boxOrders } = buildBoxPrepOrders(orders);
  return boxOrders.slice(0, BOX_LETTERS.length).map((order, index) => ({
    orderId: order.id,
    slot: BOX_LETTERS[index],
    reason: `Box ${BOX_LETTERS[index]}: prepared customer box. Keep pure carton orders for the later deck/full-carton pass.`
  }));
}

function buildPickTasks(orders: Order[], assignments: TrolleyAssignment[]): PickTask[] {
  const slotByOrder = new Map(assignments.map((assignment) => [assignment.orderId, assignment.slot]));
  return assignments.flatMap((assignment) => {
    const order = orders.find((candidate) => candidate.id === assignment.orderId)!;
    return order.lines.map((line): PickTask => {
      const sku = findSku(line.skuId);
      return {
        id: `${order.id}-${line.id}`,
        locationId: sku.locationId,
        skuId: sku.id,
        orderId: order.id,
        qty: line.qty,
        unit: line.unit,
        slot: slotByOrder.get(order.id) ?? 'DECK'
      };
    });
  }).sort((a, b) => {
    const locA = findLocation(a.locationId);
    const locB = findLocation(b.locationId);
    if (locA.row !== locB.row) return locA.row - locB.row;
    if (locA.rack !== locB.rack) return locA.rack - locB.rack;
    return a.slot.localeCompare(b.slot);
  });
}

function isSmallSleeveOnly(order: Order) {
  return order.status === 'RELEASED'
    && order.packageCount === 1
    && !order.lines.some((line) => line.unit === 'carton')
    && orderSleeveEquivalent(order) <= 8;
}

function isFullCartonOnly(order: Order) {
  return order.lines.length > 0 && order.lines.every((line) => line.unit === 'carton');
}

function buildBoxPrepOrders(orders: Order[]) {
  const activeBoxStatuses: OrderStatus[] = ['RELEASED', 'PICKING', 'BULK_PICKED', 'PACKED', 'STAGED'];
  const activeOrders = orders.filter((order) => activeBoxStatuses.includes(order.status));
  const mixedOrSleeve = activeOrders
    .filter((order) => !isFullCartonOnly(order))
    .sort((a, b) => {
      if (a.route !== b.route) return a.route.localeCompare(b.route);
      return a.stop - b.stop;
    });
  const cartonOnly = activeOrders
    .filter(isFullCartonOnly)
    .sort((a, b) => {
      if (a.route !== b.route) return a.route.localeCompare(b.route);
      return a.stop - b.stop;
    });
  return { boxOrders: mixedOrSleeve.slice(0, 4), cartonOnly };
}

function buildSleeveBatchOrders(orders: Order[]) {
  const small = orders
    .filter(isSmallSleeveOnly)
    .sort((a, b) => {
      if (a.route !== b.route) return a.route.localeCompare(b.route);
      return a.stop - b.stop;
    });
  const anchorRoute = small[0]?.route;
  return small.filter((order) => order.route === anchorRoute).slice(0, 6);
}

function buildBatchPickTasks(batchOrders: Order[]): BatchPickTask[] {
  const bySku = new Map<string, BatchPickTask>();

  batchOrders.forEach((order) => {
    order.lines.forEach((line) => {
      const sku = findSku(line.skuId);
      const existing = bySku.get(sku.id);
      if (!existing) {
        bySku.set(sku.id, {
          id: `batch-${sku.id}`,
          locationId: sku.locationId,
          skuId: sku.id,
          totalQty: line.qty,
          allocations: [{ orderId: order.id, qty: line.qty }]
        });
        return;
      }
      existing.totalQty += line.qty;
      existing.allocations.push({ orderId: order.id, qty: line.qty });
    });
  });

  return Array.from(bySku.values()).sort((a, b) => {
    const locA = findLocation(a.locationId);
    const locB = findLocation(b.locationId);
    if (locA.row !== locB.row) return locA.row - locB.row;
    return locA.rack - locB.rack;
  });
}


function nextStatus(status: OrderStatus): OrderStatus {
  const flow: OrderStatus[] = ['IMPORTED', 'RELEASED', 'PICKING', 'BULK_PICKED', 'PACKED', 'STAGED', 'LOADED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  return flow[Math.min(flow.indexOf(status) + 1, flow.length - 1)];
}


function getPreparedSlotForOrder(orderId: string, orders: Order[]): BoxPositionId | undefined {
  const direct = buildTrolleyAssignments(orders).find((assignment) => assignment.orderId === orderId)?.slot;
  if (direct) return direct;
  const order = orders.find((candidate) => candidate.id === orderId);
  return order && isFullCartonOnly(order) ? 'DECK' : undefined;
}

function readStoredOrders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ORDERS);
    return raw ? JSON.parse(raw) as Order[] : seedOrders;
  } catch {
    return seedOrders;
  }
}

function readStoredUndo() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_UNDO);
    return raw ? JSON.parse(raw) as Order[][] : [];
  } catch {
    return [];
  }
}

function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`status status-${status.toLowerCase().replaceAll('_', '-')}`}>{status.replaceAll('_', ' ')}</span>;
}

function Card({ title, kicker, children, action }: { title?: string; kicker?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card">
      {(title || kicker || action) && (
        <div className="card-head">
          <div>
            {kicker && <p className="kicker">{kicker}</p>}
            {title && <h2>{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (role: Role) => void }) {
  const [role, setRole] = useState<Role>('owner');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');

  function submit() {
    const option = roleOptions.find((candidate) => candidate.role === role);
    if (option?.passcode === passcode) {
      localStorage.setItem('ecoflow-role', role);
      onLogin(role);
      return;
    }
    setError('Wrong passcode for this role.');
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark">EF</div>
        <h1>EcoFlow Delivery OS</h1>
        <p>Ordermentum import → ABCD box prep → free rack picking → A4 labels → load scan → POD.</p>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            {roleOptions.map((option) => <option key={option.role} value={option.role}>{option.label}</option>)}
          </select>
        </label>
        <label>
          Passcode
          <input value={passcode} onChange={(event) => setPasscode(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} placeholder="0000 / 4444 / 6666" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" onClick={submit}>Enter workspace</button>
      </section>
    </main>
  );
}

function AppShell({ role, onLogout, onUndo, canUndo, children }: { role: Role; onLogout: () => void; onUndo: () => void; canUndo: boolean; children: ReactNode }) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="kicker">EcoFlow vNext</p>
          <h1>Delivery OS</h1>
        </div>
        <div className="topbar-actions">
          <span className="role-chip">{role}</span>
          <button className="ghost" disabled={!canUndo} onClick={onUndo}>Undo</button>
          <button className="ghost" onClick={onLogout}>Logout</button>
        </div>
      </header>
      {children}
    </main>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; count?: number }>; onChange: (value: T) => void }) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button key={option.value} className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)}>
          {option.label}{typeof option.count === 'number' && <b>{option.count}</b>}
        </button>
      ))}
    </div>
  );
}

function OrderRow({ order, onAdvance, onPackageCount }: { order: Order; onAdvance?: () => void; onPackageCount?: (count: number) => void }) {
  return (
    <div className="order-row">
      <div className="order-sequence">{order.stop}</div>
      <div className="order-main">
        <div className="row-title">
          <strong>{order.store}</strong>
          <StatusPill status={order.status} />
        </div>
        <p>{order.orderNo} · {order.invoiceNo} · {order.suburb}</p>
        <p>{order.lines.map((line) => `${findSku(line.skuId).id} × ${line.qty} ${line.unit}`).join(' · ')}</p>
      </div>
      <div className="row-actions">
        {onPackageCount && (
          <label className="mini-label">
            labels
            <select value={order.packageCount} onChange={(event) => onPackageCount(Number(event.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
        )}
        {onAdvance && <button onClick={onAdvance}>Next</button>}
      </div>
    </div>
  );
}

function OwnerDesk({ orders, setOrders }: { orders: Order[]; setOrders: Dispatch<SetStateAction<Order[]>> }) {
  const [tab, setTab] = useState<OwnerTab>('today');
  const imported = orders.filter((order) => order.status === 'IMPORTED').length;
  const released = orders.filter((order) => order.status === 'RELEASED').length;
  const packed = orders.filter((order) => ['PACKED', 'STAGED', 'LOADED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)).length;
  const labelTotal = orders.reduce((total, order) => total + order.packageCount, 0);

  function releaseImported() {
    setOrders((current) => current.map((order) => order.status === 'IMPORTED' ? { ...order, status: 'RELEASED', packageCount: suggestedPackageCount(order) } : order));
  }

  return (
    <div className="workspace">
      <Segmented value={tab} onChange={setTab} options={[
        { value: 'today', label: 'Today' },
        { value: 'orders', label: 'Orders', count: imported + released },
        { value: 'labels', label: 'Labels', count: labelTotal },
        { value: 'map', label: 'Warehouse Map' }
      ]} />

      {tab === 'today' && (
        <>
          <section className="hero-panel">
            <div>
              <p className="kicker">10pm cutoff brain</p>
              <h2>Tomorrow run builder</h2>
              <p>Orders before 10pm enter tomorrow's wave. After 10pm they move to the day-after wave.</p>
            </div>
            <div className="countdown">10:00 PM<br /><span>cutoff</span></div>
          </section>
          <div className="metrics-grid">
            <Metric label="imported review" value={imported} hint="from Ordermentum" />
            <Metric label="ready for trolley" value={released} hint="warehouse can start" />
            <Metric label="packed or beyond" value={packed} hint="labels/POD flow" />
            <Metric label="delivery labels" value={labelTotal} hint="A4 multi-label print" />
          </div>
          <Card title="Smart wave decision" kicker="first version">
            <p className="body-copy">The system starts with fixed rack-level SKU locations, prepares simple A/B/C/D customer boxes for sleeve-mix orders, and pushes pure carton orders behind the box wave.</p>
            <button className="primary" onClick={releaseImported}>Release imported orders</button>
          </Card>
        </>
      )}

      {tab === 'orders' && (
        <Card title="Ordermentum release queue" kicker="fixed-rack fulfilment">
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} onAdvance={() => setOrders((current) => current.map((candidate) => candidate.id === order.id ? { ...candidate, status: nextStatus(candidate.status) } : candidate))} />
          ))}
        </Card>
      )}

      {tab === 'labels' && (
        <LabelDesk orders={orders} setOrders={setOrders} />
      )}

      {tab === 'map' && <WarehouseMap />}
    </div>
  );
}

function WarehouseDesk({ orders, setOrders }: { orders: Order[]; setOrders: Dispatch<SetStateAction<Order[]>> }) {
  const [tab, setTab] = useState<WarehouseTab>('wave');
  const [taskIndex, setTaskIndex] = useState(0);
  const [batchTaskIndex, setBatchTaskIndex] = useState(0);
  const assignments = useMemo(() => buildTrolleyAssignments(orders), [orders]);
  const tasks = useMemo(() => buildPickTasks(orders, assignments), [orders, assignments]);
  const currentTask = tasks[taskIndex] ?? null;
  const batchOrders = useMemo(() => buildSleeveBatchOrders(orders), [orders]);
  const batchTasks = useMemo(() => buildBatchPickTasks(batchOrders), [batchOrders]);
  const currentBatchTask = batchTasks[batchTaskIndex] ?? null;

  function completeTask() {
    if (taskIndex < tasks.length - 1) {
      setTaskIndex((current) => current + 1);
      return;
    }
    const orderIds = new Set(assignments.map((assignment) => assignment.orderId));
    setOrders((current) => current.map((order) => orderIds.has(order.id) ? { ...order, status: 'PICKING' } : order));
    setTaskIndex(0);
  }

  function completeBatchTask() {
    if (batchTaskIndex < batchTasks.length - 1) {
      setBatchTaskIndex((current) => current + 1);
      return;
    }
    const orderIds = new Set(batchOrders.map((order) => order.id));
    setOrders((current) => current.map((order) => orderIds.has(order.id) ? { ...order, status: 'BULK_PICKED' } : order));
    setBatchTaskIndex(0);
  }

  return (
    <div className="workspace mobile-workspace">
      <Segmented value={tab} onChange={setTab} options={[
        { value: 'wave', label: 'Box wave', count: assignments.length },
        { value: 'batch', label: 'Free pick', count: batchOrders.length },
        { value: 'pack', label: 'Pack' },
        { value: 'locations', label: 'Locations' }
      ]} />

      {tab === 'wave' && (
        <>
          <BoxPrepPlan orders={orders} />
          <Card title="Free rack pick" kicker="staff-controlled passes · no slot scanning">
            <TrolleyPlan assignments={assignments} orders={orders} activeTask={currentTask} />
          </Card>
          <Card title="Suggested next item" kicker={`${taskIndex + 1}/${Math.max(tasks.length, 1)} rack-ordered suggestion`} action={currentTask && <span className="scan-code">{findLocation(currentTask.locationId).scanCode}</span>}>
            {currentTask ? <PickInstruction task={currentTask} order={orders.find((order) => order.id === currentTask.orderId)!} /> : <p className="body-copy">No released orders ready for the A/B/C/D box wave.</p>}
            <div className="action-stack pick-actions">
              <button disabled={!currentTask} onClick={completeTask}>{taskIndex < tasks.length - 1 ? 'Picked this item · show next' : 'Finish current box wave'}</button>
              <button disabled={!currentTask} onClick={() => setTaskIndex((current) => Math.min(current + 1, Math.max(tasks.length - 1, 0)))}>Skip for later</button>
              <button className="primary" disabled={!currentTask} onClick={() => setTaskIndex((current) => current)}>Unload this trolley pass at bench</button>
            </div>
            <p className="body-copy">The app suggests the rack order, but staff decide when the trolley is full. They can unload into A/B/C/D boxes at any time, then continue from the same list.</p>
          </Card>
        </>
      )}

      {tab === 'batch' && (
        <BatchModePanel
          orders={orders}
          batchOrders={batchOrders}
          batchTasks={batchTasks}
          currentTask={currentBatchTask}
          taskIndex={batchTaskIndex}
          onCompleteTask={completeBatchTask}
        />
      )}

      {tab === 'pack' && (
        <PackingBench orders={orders} setOrders={setOrders} />
      )}

      {tab === 'locations' && <WarehouseMap compact />}
    </div>
  );
}


function BoxPrepPlan({ orders }: { orders: Order[] }) {
  const { boxOrders, cartonOnly } = buildBoxPrepOrders(orders);
  const letters = ['A', 'B', 'C', 'D'];
  return (
    <Card title="Box prep before picking" kicker="A/B/C/D boxes · pure carton orders later">
      <div className="box-prep-grid">
        {letters.map((letter, index) => {
          const order = boxOrders[index];
          return (
            <div className={`prep-box ${order ? 'filled' : ''}`} key={letter}>
              <span>Box {letter}</span>
              {order ? (
                <>
                  <strong>{order.store}</strong>
                  <small>{order.orderNo} · est. {suggestedPackageCount(order)} label{suggestedPackageCount(order) > 1 ? 's' : ''}</small>
                  <p>{order.lines.map((line) => `${findSku(line.skuId).id} × ${line.qty} ${line.unit}`).join(' · ')}</p>
                </>
              ) : (
                <em>spare / no box needed</em>
              )}
            </div>
          );
        })}
      </div>
      <p className="body-copy">No temporary order card is required. The physical empty boxes are simply A/B/C/D. The app maps each letter to a cafe for this wave; carton-only orders stay out of these boxes and are picked after the box wave.</p>
      {cartonOnly.length > 0 && (
        <div className="carton-later">
          <strong>Pick after A/B/C/D:</strong>
          {cartonOnly.map((order) => <span key={order.id}>{order.store} · {order.packageCount} carton label{order.packageCount > 1 ? 's' : ''}</span>)}
        </div>
      )}
    </Card>
  );
}

function BatchModePanel({ orders, batchOrders, batchTasks, currentTask, taskIndex, onCompleteTask }: {
  orders: Order[];
  batchOrders: Order[];
  batchTasks: BatchPickTask[];
  currentTask: BatchPickTask | null;
  taskIndex: number;
  onCompleteTask: () => void;
}) {
  return (
    <>
      <Card title="Small sleeve free pick" kicker="version three · pick totals, split into A/B/C/D boxes">
        <div className="batch-hero">
          <div className="bulk-tote">
            <span>Bulk tote</span>
            <strong>Unassigned sleeves only</strong>
            <small>Do not mix cartons or multi-box orders here.</small>
          </div>
          <div>
            <p className="body-copy">This mode is for several tiny sleeve-only cafe orders on the same run. Staff may pick rack totals into a bulk tote or directly into the prepared A/B/C/D boxes. They can return to the bench whenever the trolley is full.</p>
            <div className="chip-row">
              {batchOrders.map((order, index) => <span className="bench-chip" key={order.id}>Box {['A','B','C','D','E','F'][index]}: {order.store}</span>)}
              {batchOrders.length === 0 && <span className="bench-chip">No small sleeve batch ready</span>}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Batch pick task" kicker={`${taskIndex + 1}/${Math.max(batchTasks.length, 1)} aggregated SKU`} action={currentTask && <span className="scan-code">{findLocation(currentTask.locationId).scanCode}</span>}>
        {currentTask ? <BatchPickInstruction task={currentTask} orders={orders} /> : <p className="body-copy">No sleeve batch available. Use normal trolley picking or release more imported orders.</p>}
        <button className="primary full-width" disabled={!currentTask} onClick={onCompleteTask}>{taskIndex < batchTasks.length - 1 ? 'Confirm bulk pick and show next SKU' : 'Finish batch and go to pack bench'}</button>
      </Card>

      <Card title="Pick-to-light box split" kicker="action-driven bench allocation">
        <PickToLightBoard batchOrders={batchOrders} batchTasks={batchTasks} />
      </Card>
    </>
  );
}

function BatchPickInstruction({ task, orders }: { task: BatchPickTask; orders: Order[] }) {
  const sku = findSku(task.skuId);
  const location = findLocation(task.locationId);
  return (
    <div className="instruction-card">
      <div className="instruction-step">1</div>
      <div>
        <p className="kicker">Go to fixed rack</p>
        <h3>{location.code} · {location.name}</h3>
        <p>Scan <strong>{location.scanCode}</strong>. This confirms the correct product family row.</p>
      </div>
      <div className="instruction-step">2</div>
      <div>
        <p className="kicker">Pick bulk quantity</p>
        <h3>{sku.name}</h3>
        <p>Total: <strong>{task.totalQty} sleeves</strong> · sleeve barcode {sku.sleeveBarcode}</p>
      </div>
      <div className="instruction-step">3</div>
      <div>
        <p className="kicker">Put into tote or A/B/C/D boxes</p>
        <h3>Staff choice: bulk tote or direct to box</h3>
        <p>{task.allocations.map((allocation) => {
          const order = orders.find((candidate) => candidate.id === allocation.orderId)!;
          return `${order.store}: ${allocation.qty}`;
        }).join(' · ')}</p>
      </div>
      <div className="instruction-map-row">
        <PathfindingMinimap activeLocationId={task.locationId} />
      </div>
    </div>
  );
}

function BatchPackMatrix({ batchOrders, batchTasks }: { batchOrders: Order[]; batchTasks: BatchPickTask[] }) {
  if (batchOrders.length === 0) {
    return <p className="body-copy">When a small sleeve batch is ready, this matrix becomes the bench instruction: one A/B/C/D box per order, one row per SKU.</p>;
  }

  return (
    <div className="matrix-wrap">
      <div className="matrix-grid" style={{ gridTemplateColumns: `minmax(120px, 1.2fr) repeat(${batchOrders.length}, minmax(84px, 1fr))` }}>
        <strong>SKU</strong>
        {batchOrders.map((order, index) => <strong key={order.id}>Box {['A','B','C','D','E','F'][index]}<small>{order.store}</small></strong>)}
        {batchTasks.map((task) => (
          <Fragment key={task.id}>
            <span>{findSku(task.skuId).id}</span>
            {batchOrders.map((order) => {
              const allocation = task.allocations.find((item) => item.orderId === order.id);
              return <b key={`${task.id}-${order.id}`}>{allocation ? allocation.qty : '—'}</b>;
            })}
          </Fragment>
        ))}
      </div>
      <p className="body-copy">Bench rule: split one SKU across all prepared customer boxes before moving to the next SKU. When every A/B/C/D box matches the matrix, confirm package count and print labels.</p>
    </div>
  );
}

function PackingBench({ orders, setOrders }: { orders: Order[]; setOrders: Dispatch<SetStateAction<Order[]>> }) {
  const benchOrders = orders.filter((order) => ['PICKING', 'BULK_PICKED', 'PACKED', 'STAGED'].includes(order.status));
  const assignments = buildTrolleyAssignments(orders);
  const [selectedOrderId, setSelectedOrderId] = useState(benchOrders[0]?.id ?? '');
  const [scanInput, setScanInput] = useState('');
  const [scannedItemsByOrder, setScannedItemsByOrder] = useState<Record<string, string[]>>({});
  const selectedOrder = benchOrders.find((order) => order.id === selectedOrderId) ?? benchOrders[0];
  const selectedSlot = selectedOrder ? getPreparedSlotForOrder(selectedOrder.id, orders) : undefined;
  const scannedIds = selectedOrder ? scannedItemsByOrder[selectedOrder.id] ?? [] : [];

  useEffect(() => {
    if (!selectedOrderId && benchOrders[0]) setSelectedOrderId(benchOrders[0].id);
    if (selectedOrderId && !benchOrders.some((order) => order.id === selectedOrderId)) setSelectedOrderId(benchOrders[0]?.id ?? '');
  }, [benchOrders, selectedOrderId]);

  function updateSelected(updater: (order: Order) => Order) {
    if (!selectedOrder) return;
    setOrders((current) => current.map((order) => order.id === selectedOrder.id ? updater(order) : order));
  }

  function mark(status: OrderStatus) {
    updateSelected((order) => ({ ...order, status }));
  }

  function selectSlot(slot: BoxPositionId) {
    const assignment = assignments.find((candidate) => candidate.slot === slot);
    if (assignment) setSelectedOrderId(assignment.orderId);
    if (slot === 'DECK') {
      const deckOrder = benchOrders.find(isFullCartonOnly);
      if (deckOrder) setSelectedOrderId(deckOrder.id);
    }
  }

  function handleBenchScan(scannedBarcode: string) {
    const code = scannedBarcode.trim();
    if (!selectedOrder || !code) return;
    const matchedSku = skus.find((sku) => sku.sleeveBarcode === code || sku.cartonBarcode === code);
    if (!matchedSku) {
      window.alert('Unknown barcode. This barcode is not registered to a SKU.');
      return;
    }
    const line = selectedOrder.lines.find((candidate) => candidate.skuId === matchedSku.id);
    if (!line) {
      window.alert('Wrong product: this SKU does not belong to the selected order/box.');
      return;
    }
    const currentQty = scannedIds.filter((id) => id === matchedSku.id).length;
    if (currentQty >= line.qty) {
      window.alert('This SKU is already fully scanned for the selected order.');
      return;
    }
    setScannedItemsByOrder((current) => ({
      ...current,
      [selectedOrder.id]: [...(current[selectedOrder.id] ?? []), matchedSku.id]
    }));
    setScanInput('');
  }

  return (
    <>
      <Card title="Packing bench command board" kicker="after trolley returns">
        <BenchFlow />
        <p className="body-copy">Staff unload into the prepared A/B/C/D boxes, scan SKU barcodes as items enter the final delivery package, choose the actual number of delivery labels, then print/fold the A4 sheet. No slot QR and no temporary order card are required.</p>
      </Card>

      <Card title="Bench unload" kicker="A/B/C/D boxes · scan into final package">
        <div className="bench-columns">
          <div>
            <p className="body-copy">Select the physical box being packed. The highlighted box follows the real order assignment instead of being hardcoded.</p>
            <label className="form-field">
              Prepared box / order
              <select value={selectedOrder?.id ?? ''} onChange={(event) => setSelectedOrderId(event.target.value)}>
                {benchOrders.map((order) => <option key={order.id} value={order.id}>{getPreparedSlotForOrder(order.id, orders) ?? 'BOX'} · {order.orderNo} · {order.store}</option>)}
              </select>
            </label>
          </div>
          <div className="slot-panel-grid slot-panel-grid-compact">
            {BOX_LETTERS.map((slot) => (
              <BenchSlotPanel key={slot} slot={slot} active={selectedSlot === slot} onSelect={() => selectSlot(slot)} assignment={assignments.find((candidate) => candidate.slot === slot)} orders={orders} />
            ))}
            <BenchSlotPanel slot="DECK" active={selectedSlot === 'DECK'} onSelect={() => selectSlot('DECK')} orders={orders} />
          </div>
        </div>
      </Card>

      {selectedOrder ? (
        <Card title={selectedOrder.store} kicker={`${selectedOrder.orderNo} · ${selectedOrder.route} · stop ${selectedOrder.stop}`} action={<StatusPill status={selectedOrder.status} />}>
          <div className="pack-order pack-order-enhanced">
            <div>
              <h3>1. Scan into final box</h3>
              <CameraScanner
                value={scanInput}
                onChange={setScanInput}
                onSubmit={handleBenchScan}
                expectedLines={selectedOrder.lines}
              />
              <ul className="line-list">
                {selectedOrder.lines.map((line) => {
                  const sku = findSku(line.skuId);
                  const location = findLocation(sku.locationId);
                  const scannedQty = scannedIds.filter((id) => id === line.skuId).length;
                  return <li key={line.id} className={scannedQty >= line.qty ? 'line-complete' : ''}><strong>{scannedQty}/{line.qty} {line.unit}</strong> {sku.name}<small>{location.code} · scan {line.unit === 'carton' ? sku.cartonBarcode : sku.sleeveBarcode}</small></li>;
                })}
              </ul>
            </div>
            <div>
              <h3>2. Visual box check</h3>
              <IsometricUnboxing lines={selectedOrder.lines} scannedIds={scannedIds} />
            </div>
            <div>
              <h3>3. Confirm labels</h3>
              <PackageStepper value={selectedOrder.packageCount} onChange={(count) => updateSelected((order) => ({ ...order, packageCount: count }))} />
              <p className="body-copy">Box 1 carries the invoice pouch. Every box gets its own delivery QR label.</p>
              <div className="action-stack">
                <button onClick={() => window.print()}>Print A4 labels</button>
                <button onClick={() => mark('PACKED')}>Confirm packed</button>
                <button className="primary" onClick={() => mark('STAGED')}>Move to Ready area</button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card title="No trolley at bench" kicker="waiting for picking"><p className="body-copy">Finish a trolley or sleeve batch pick first. Orders then appear here as PICKING or BULK PICKED.</p></Card>
      )}

      <ExternalAidsCard />
    </>
  );
}

function BenchFlow() {
  return (
    <div className="bench-flow">
      <div><span>1</span><strong>Trolley arrives</strong><small>Park beside bench</small></div>
      <div><span>2</span><strong>Select A/B/C/D</strong><small>No slot QR; choose box on screen</small></div>
      <div><span>3</span><strong>Verify & box</strong><small>Check lines, choose label count</small></div>
      <div><span>4</span><strong>Print & pouch</strong><small>Box 1 gets invoice</small></div>
      <div><span>5</span><strong>Ready area</strong><small>Driver scans package labels</small></div>
    </div>
  );
}

function BenchSlotPanel({ slot, active = false, onSelect, assignment, orders = [] }: { slot: BoxPositionId; active?: boolean; onSelect?: () => void; assignment?: TrolleyAssignment; orders?: Order[] }) {
  const order = assignment ? orders.find((candidate) => candidate.id === assignment.orderId) : undefined;
  return (
    <button type="button" className={`bench-slot slot-${slot.toLowerCase()} ${active ? 'active' : ''}`} onClick={onSelect}>
      <span>{slot}</span>
      <strong>{slot === 'DECK' ? 'Deck / full cartons' : `Box ${slot}`}</strong>
      <small>{order ? order.store : active ? 'currently selected' : 'tap to select'}</small>
    </button>
  );
}

function PackageStepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="package-buttons">
      {[1, 2, 3, 4, 5, 6].map((count) => (
        <button key={count} className={value === count ? 'active' : ''} onClick={() => onChange(count)}>{count}</button>
      ))}
    </div>
  );
}

function ExternalAidsCard() {
  return (
    <Card title="External aids that make the app work" kicker="cheap physical controls">
      <div className="aids-grid">
        <div><strong>Prepared boxes</strong><p>Reusable box letters A/B/C/D. Put the physical empty boxes on the bench or floor and use the app to map each letter to a customer.</p></div>
        <div><strong>No slot QR needed</strong><p>The trolley/box letters are visual only. Barcode confirmation happens on SKU and final package label.</p></div>
        <div><strong>Invoice pouch station</strong><p>A4 paper, invoice pouches, clear tape, marker and label printer beside the bench.</p></div>
        <div><strong>Minimal Ready / Hold</strong><p>Use one Ready area and one Hold/Issue area first. Route and stop are printed on each package label.</p></div>
      </div>
    </Card>
  );
}

function TrolleyPlan({ assignments, orders, activeTask }: { assignments: TrolleyAssignment[]; orders: Order[]; activeTask: PickTask | null }) {
  function assignmentFor(slot: BoxPositionId) {
    return assignments.find((assignment) => assignment.slot === slot);
  }

  function slotContent(slot: BoxPositionId) {
    const assignment = assignmentFor(slot);
    const order = assignment ? orders.find((candidate) => candidate.id === assignment.orderId) : null;
    const active = activeTask?.slot === slot;
    const currentSize = order ? orderSleeveEquivalent(order) : 0;
    const fillPercent = Math.min((currentSize / MAX_BOX_CAPACITY) * 100, 100);
    return (
      <div className={`trolley-slot dynamic-slot slot-${slot.toLowerCase()} ${active ? 'active' : ''}`}>
        <div className="fill-level" style={{ height: `${fillPercent}%` }} />
        <div className="slot-content">
          <span className="slot-badge">{slot === 'DECK' ? 'DECK' : `BOX ${slot}`}</span>
          {order ? <strong>{order.store}</strong> : <em>empty</em>}
          {order ? <small>{currentSize}/{MAX_BOX_CAPACITY} sleeve capacity · {assignment?.reason}</small> : <small>available or kept clear</small>}
        </div>
      </div>
    );
  }

  return (
    <div className="trolley-wrap">
      <div className="trolley-top-view dynamic-trolley">
        {BOX_LETTERS.map((slot) => <Fragment key={slot}>{slotContent(slot)}</Fragment>)}
        <div className="deck-strip">Deck / full carton orders picked later</div>
        <div className="handle">handle</div>
      </div>
      <p className="body-copy">The view mirrors the physical prepared boxes. Colour and fill level stay consistent from pick instruction to packing and label printing.</p>
    </div>
  );
}

function PickInstruction({ task, order }: { task: PickTask; order: Order }) {
  const sku = findSku(task.skuId);
  const location = findLocation(task.locationId);
  return (
    <div className="instruction-card">
      <div className="instruction-step">1</div>
      <div>
        <p className="kicker">Go to fixed rack</p>
        <h3>{location.code} · {location.name}</h3>
        <p>Scan <strong>{location.scanCode}</strong> to confirm the rack.</p>
      </div>
      <div className="instruction-step">2</div>
      <div>
        <p className="kicker">Pick product</p>
        <h3>{sku.name}</h3>
        <p>{task.qty} {task.unit}{task.qty > 1 ? 's' : ''} · barcode {task.unit === 'carton' ? sku.cartonBarcode : sku.sleeveBarcode}</p>
      </div>
      <div className="instruction-step">3</div>
      <div>
        <p className="kicker">Place / carry</p>
        <h3>{task.slot === 'DECK' ? 'Deck / process later' : `Box ${task.slot}`}</h3>
        <p>{order.store} · {order.orderNo}</p>
      </div>
      <div className="instruction-map-row">
        <PathfindingMinimap activeLocationId={task.locationId} />
      </div>
    </div>
  );
}

function LabelDesk({ orders, setOrders }: { orders: Order[]; setOrders: Dispatch<SetStateAction<Order[]>> }) {
  const [selectedOrderId, setSelectedOrderId] = useState(orders[0]?.id ?? '');
  const [labelsPerPage, setLabelsPerPage] = useState(4);
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? orders[0];

  if (!selectedOrder) return <Card title="Labels"><p>No orders available.</p></Card>;

  return (
    <div className="label-layout">
      <Card title="A4 delivery label builder" kicker="prints several labels on one A4 sheet">
        <label className="form-field">
          Order
          <select value={selectedOrder.id} onChange={(event) => setSelectedOrderId(event.target.value)}>
            {orders.map((order) => <option key={order.id} value={order.id}>{order.orderNo} · {order.store}</option>)}
          </select>
        </label>
        <label className="form-field">
          How many delivery labels / boxes?
          <select value={selectedOrder.packageCount} onChange={(event) => setOrders((current) => current.map((order) => order.id === selectedOrder.id ? { ...order, packageCount: Number(event.target.value) } : order))}>
            {[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
        <label className="form-field">
          Labels per A4 page
          <select value={labelsPerPage} onChange={(event) => setLabelsPerPage(Number(event.target.value))}>
            <option value={2}>2 large labels</option>
            <option value={4}>4 medium labels</option>
            <option value={6}>6 compact labels</option>
          </select>
        </label>
        <p className="body-copy">Fold the printed A4 sheet so the delivery face and QR stay visible through the invoice pouch. Invoice goes behind Box 1 label.</p>
        <button className="primary" onClick={() => window.print()}>Print A4 label sheet</button>
      </Card>
      <section className={`a4-sheet labels-${labelsPerPage}`} aria-label="A4 label preview">
        {Array.from({ length: selectedOrder.packageCount }).map((_, index) => (
          <DeliveryLabel key={index} order={selectedOrder} packageNo={index + 1} totalPackages={selectedOrder.packageCount} />
        ))}
      </section>
    </div>
  );
}

function DeliveryLabel({ order, packageNo, totalPackages }: { order: Order; packageNo: number; totalPackages: number }) {
  const hasDocs = packageNo === order.documentsBox;
  return (
    <article className="delivery-label">
      <div className="label-top">
        <div>
          <p className="kicker">{order.route} · STOP {String(order.stop).padStart(2, '0')}</p>
          <h2>{order.store}</h2>
          <p>{order.suburb}</p>
        </div>
        <FakeQr value={`${order.orderNo}-${packageNo}`} />
      </div>
      <div className="label-mid">
        <strong>BOX {packageNo} OF {totalPackages}</strong>
        <span>{hasDocs ? 'DOCUMENTS / INVOICE ATTACHED' : 'NO DOCUMENTS IN THIS BOX'}</span>
      </div>
      <p className="label-address">{order.address}</p>
      <p className="label-lines">{order.lines.map((line) => `${findSku(line.skuId).id} × ${line.qty} ${line.unit}`).join(' · ')}</p>
      <footer>{order.orderNo} · {order.invoiceNo} · scan for package POD</footer>
    </article>
  );
}

function FakeQr({ value }: { value: string }) {
  const seed = value.split('').reduce((total, char) => total + char.charCodeAt(0), 0);
  return (
    <div className="fake-qr" aria-label={`QR placeholder ${value}`}>
      {Array.from({ length: 49 }).map((_, index) => <i key={index} className={(index + seed) % 3 === 0 || [0, 1, 7, 8, 40, 41, 47, 48].includes(index) ? 'on' : ''} />)}
    </div>
  );
}


function PathfindingMinimap({ activeLocationId }: { activeLocationId: string }) {
  const activeLoc = findLocation(activeLocationId);
  const maxRow = Math.max(...locations.map((location) => location.row));
  const maxRack = Math.max(...locations.map((location) => location.rack));
  return (
    <div className="minimap-container">
      <span className="minimap-title">rack radar</span>
      <svg viewBox={`0 0 ${maxRack * 60 + 40} ${maxRow * 50 + 44}`} className="minimap-svg" aria-label="warehouse minimap">
        {locations.map((location) => {
          const x = (location.rack - 1) * 60 + 20;
          const y = (location.row - 1) * 50 + 22;
          const isActive = location.id === activeLocationId;
          return (
            <g key={location.id} transform={`translate(${x}, ${y})`}>
              <rect width="42" height="24" rx="5" fill={isActive ? '#00ffcc' : '#d9e1ec'} />
              <text x="21" y="16" textAnchor="middle" fontSize="10" fill={isActive ? '#142033' : '#637083'} fontWeight="900">{location.code}</text>
            </g>
          );
        })}
        <circle cx={(activeLoc.rack - 1) * 60 + 41} cy={(activeLoc.row - 1) * 50 + 34} r="12" fill="rgba(0,255,204,0.35)" className="radar-pulse" />
      </svg>
    </div>
  );
}

function PickToLightBoard({ batchOrders, batchTasks }: { batchOrders: Order[]; batchTasks: BatchPickTask[] }) {
  const [taskIndex, setTaskIndex] = useState(0);
  const currentTask = batchTasks[taskIndex] ?? null;
  const [remaining, setRemaining] = useState<Record<string, number>>({});

  useEffect(() => {
    const next: Record<string, number> = {};
    currentTask?.allocations.forEach((allocation) => { next[allocation.orderId] = allocation.qty; });
    setRemaining(next);
  }, [currentTask?.id]);

  if (batchOrders.length === 0 || !currentTask) {
    return <p className="body-copy">When a small sleeve batch is ready, this becomes the bench split screen: one SKU at a time, one big target button per A/B/C/D box.</p>;
  }

  const sku = findSku(currentTask.skuId);
  const totalRemaining = Object.values(remaining).reduce((total, qty) => total + qty, 0);

  return (
    <div className="ptl-board">
      <div className="ptl-sku-info">
        <p className="kicker">current SKU</p>
        <strong>{sku.name}</strong>
        <p>Remaining to allocate: <span>{totalRemaining}</span></p>
      </div>
      <div className="ptl-boxes">
        {batchOrders.map((order, index) => {
          const qty = remaining[order.id] || 0;
          const boxLetter = ['A','B','C','D','E','F'][index];
          return (
            <button
              key={order.id}
              className={`ptl-target slot-${String(boxLetter).toLowerCase()} ${qty > 0 ? 'active-target' : 'done-target'}`}
              onClick={() => qty > 0 && setRemaining((current) => ({ ...current, [order.id]: qty - 1 }))}
            >
              <span className="ptl-box-label">BOX {boxLetter}</span>
              <span className="ptl-store">{order.store}</span>
              <div className="ptl-number">{qty === 0 ? '✓' : `+${qty}`}</div>
            </button>
          );
        })}
      </div>
      <button className="primary full-width" disabled={totalRemaining > 0} onClick={() => setTaskIndex((current) => Math.min(current + 1, Math.max(batchTasks.length - 1, 0)))}>{taskIndex < batchTasks.length - 1 ? 'Next SKU' : 'All split tasks complete'}</button>
    </div>
  );
}

function CameraScanner({ value, onChange, onSubmit, expectedLines }: { value: string; onChange: (value: string) => void; onSubmit: (value: string) => void; expectedLines: OrderLine[] }) {
  return (
    <div className="camera-scanner">
      <div className="camera-window">
        <span>PHONE CAMERA SCANNER</span>
        <small>Prototype uses manual barcode input; production can replace this with html5-qrcode using the same onSubmit callback.</small>
      </div>
      <div className="scan-entry">
        <input value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onSubmit(value)} placeholder="Scan or type barcode" />
        <button onClick={() => onSubmit(value)}>Scan</button>
      </div>
      <div className="demo-scan-row">
        {expectedLines.map((line) => {
          const sku = findSku(line.skuId);
          const barcode = line.unit === 'carton' ? sku.cartonBarcode ?? sku.sleeveBarcode : sku.sleeveBarcode;
          return <button key={line.id} type="button" onClick={() => onSubmit(barcode)}>demo {sku.id}</button>;
        })}
      </div>
    </div>
  );
}

function IsometricUnboxing({ lines, scannedIds }: { lines: OrderLine[]; scannedIds: string[] }) {
  const isComplete = lines.length > 0 && lines.every((line) => scannedIds.filter((id) => id === line.skuId).length >= line.qty);
  return (
    <div className={`iso-box-scene ${isComplete ? 'box-sealed' : 'box-open'}`}>
      <div className="iso-box">
        <div className="face face-front" />
        <div className="face face-back" />
        <div className="face face-left" />
        <div className="face face-right" />
        <div className="face face-bottom" />
        <div className="items-container">
          {lines.map((line) => {
            const scannedQty = scannedIds.filter((id) => id === line.skuId).length;
            const complete = scannedQty >= line.qty;
            return <div key={line.id} className={`iso-item ${complete ? 'scanned-in' : 'waiting'}`}>{findSku(line.skuId).id} ({scannedQty}/{line.qty})</div>;
          })}
        </div>
      </div>
      {isComplete && <div className="seal-tape">CONFIRMED</div>}
    </div>
  );
}

function WarehouseMap({ compact = false }: { compact?: boolean }) {
  return (
    <Card title="Fixed rack map" kicker="rack-level locations, not loose soft locations">
      <div className={compact ? 'location-grid compact' : 'location-grid'}>
        {locations.map((location) => {
          const locationSkus = skus.filter((sku) => sku.locationId === location.id);
          return (
            <div className="location-card" key={location.id}>
              <span>{location.code}</span>
              <strong>{location.category}</strong>
              <p>{location.name}</p>
              <small>{location.scanCode}</small>
              <ul>
                {locationSkus.map((sku) => <li key={sku.id}>{sku.id}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="body-copy">New products should be added to a new rack or a clearly assigned rack section. The app assumes SKU → rack is stable enough for path planning.</p>
    </Card>
  );
}

function DriverDesk({ orders, setOrders }: { orders: Order[]; setOrders: Dispatch<SetStateAction<Order[]>> }) {
  const [tab, setTab] = useState<DriverTab>('load');
  const routeOrders = orders.filter((order) => ['PACKED', 'STAGED', 'LOADED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)).sort((a, b) => a.stop - b.stop);
  const totalPackages = routeOrders.reduce((total, order) => total + order.packageCount, 0);
  const loadedPackages = routeOrders.filter((order) => ['LOADED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)).reduce((total, order) => total + order.packageCount, 0);

  return (
    <div className="workspace mobile-workspace">
      <Segmented value={tab} onChange={setTab} options={[
        { value: 'load', label: 'Load', count: loadedPackages },
        { value: 'route', label: 'Route', count: routeOrders.length },
        { value: 'pod', label: 'POD' }
      ]} />

      {tab === 'load' && (
        <Card title="Load scan" kicker={`${loadedPackages}/${totalPackages} packages scanned`}>
          {routeOrders.map((order) => (
            <div className="load-row" key={order.id}>
              <div>
                <strong>{order.store}</strong>
                <p>{order.route} · stop {order.stop} · {order.packageCount} box{order.packageCount > 1 ? 'es' : ''}</p>
              </div>
              <button onClick={() => setOrders((current) => current.map((candidate) => candidate.id === order.id ? { ...candidate, status: 'LOADED' } : candidate))}>Scan all boxes</button>
            </div>
          ))}
          <button className="primary full-width" onClick={() => setOrders((current) => current.map((order) => order.status === 'LOADED' ? { ...order, status: 'OUT_FOR_DELIVERY' } : order))}>Start delivery run</button>
        </Card>
      )}

      {tab === 'route' && (
        <Card title="Driver route" kicker="customer-facing stop order">
          {routeOrders.map((order) => <OrderRow key={order.id} order={order} />)}
        </Card>
      )}

      {tab === 'pod' && (
        <Card title="Proof of delivery" kicker="package group completion">
          {routeOrders.filter((order) => order.status === 'OUT_FOR_DELIVERY').map((order) => (
            <div className="pod-card" key={order.id}>
              <strong>{order.store}</strong>
              <p>{order.address}</p>
              <p>{order.packageCount} boxes expected. Missing box warning stays active until all package labels are scanned.</p>
              <button onClick={() => setOrders((current) => current.map((candidate) => candidate.id === order.id ? { ...candidate, status: 'DELIVERED' } : candidate))}>Take POD photo and complete</button>
            </div>
          ))}
          {!routeOrders.some((order) => order.status === 'OUT_FOR_DELIVERY') && <p className="body-copy">No active delivery stop.</p>}
        </Card>
      )}
    </div>
  );
}

export function App() {
  const [role, setRole] = useState<Role | null>(() => (localStorage.getItem('ecoflow-role') as Role | null) ?? null);
  const [orders, rawSetOrders] = useState<Order[]>(readStoredOrders);
  const [undoStack, setUndoStack] = useState<Order[][]>(readStoredUndo);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_UNDO, JSON.stringify(undoStack.slice(0, 20)));
  }, [undoStack]);

  const setOrders: Dispatch<SetStateAction<Order[]>> = (update) => {
    rawSetOrders((previous) => {
      const next = typeof update === 'function' ? (update as (value: Order[]) => Order[])(previous) : update;
      if (JSON.stringify(next) !== JSON.stringify(previous)) {
        setUndoStack((current) => [previous, ...current].slice(0, 20));
      }
      return next;
    });
  };

  function undoLastChange() {
    setUndoStack((current) => {
      const [last, ...rest] = current;
      if (last) rawSetOrders(last);
      return rest;
    });
  }

  function logout() {
    localStorage.removeItem('ecoflow-role');
    setRole(null);
  }

  if (!role || !roleOptions.some((option) => option.role === role)) {
    return <Login onLogin={setRole} />;
  }

  return (
    <AppShell role={role} onLogout={logout} onUndo={undoLastChange} canUndo={undoStack.length > 0}>
      {role === 'owner' && <OwnerDesk orders={orders} setOrders={setOrders} />}
      {role === 'warehouse' && <WarehouseDesk orders={orders} setOrders={setOrders} />}
      {role === 'driver' && <DriverDesk orders={orders} setOrders={setOrders} />}
    </AppShell>
  );
}