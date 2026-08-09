import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label}: expected source block was not found`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: source block is not unique`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const appPath = 'src/app/App.tsx';
let app = readFileSync(appPath, 'utf8');

app = replaceOnce(
  app,
  "import { callInternaliseOrders, setActiveRunCode } from '@/data/repositories/pickSync';",
  "import { callInternaliseOrders, setActiveRunCode } from '@/data/repositories/pickSync';\nimport { buildLockedDeliveryRouteSnapshot, lockDeliveryRouteSnapshot, unlockDeliveryRouteSnapshot } from '@/data/repositories/deliveryRouteAuthority';",
  'App route-authority import',
);

app = replaceOnce(
  app,
`  async function lockRoute() {
    if (!canPlan || day.pick || !stops.length) return;
    const stopOrder = reconcileStopOrder(day.stopOrder, run.stops);
    const boxCodes = Object.fromEntries(stopOrder.map((orderId, index) => [orderId, boxCodeForStop(index)]));
    try {
      await setActiveRunCode(businessDay.date, day.runCode, 'Office route approval');
    } catch (error) {
      window.alert(\`Route was not locked: \${error instanceof Error ? error.message : String(error)}\`);
      return;
    }
    setDay((current) => ({
      ...current,
      stopOrder,
      pick: {
        lockedAt: new Date().toISOString(),
        stopOrder,
        boxCodes,
        taskState: {},
        allocDone: {},
        stagedStops: {},
      },
    }));
  }

  function unlockRoute() {
    if (!canPlan || !day.pick || routeInUse) return;
    if (!window.confirm('Unlock this route? Printed labels become invalid and must be reprinted.')) return;
    setDay((current) => ({ ...current, pick: undefined }));
  }`,
`  async function lockRoute() {
    if (!canPlan || day.pick || !stops.length) return;
    const stopOrder = reconcileStopOrder(day.stopOrder, run.stops);
    const boxCodes = Object.fromEntries(stopOrder.map((orderId, index) => [orderId, boxCodeForStop(index)]));
    const lockedStops = stopOrder
      .map((orderId, index) => {
        const stop = byId.get(orderId);
        return stop ? { ...stop, stopNumber: index + 1, boxCode: boxCodes[orderId] } : null;
      })
      .filter((stop): stop is NonNullable<typeof stop> => Boolean(stop));
    if (lockedStops.length !== stopOrder.length) {
      window.alert('Route was not locked: one or more released stops disappeared from the route draft. Refresh and approve again.');
      return;
    }

    let authorityLocked = false;
    try {
      const snapshot = buildLockedDeliveryRouteSnapshot({
        ...run,
        stops: lockedStops,
        totalCartons: lockedStops.reduce((sum, stop) => sum + stop.cartons, 0),
        readyStops: lockedStops.filter((stop) => stop.warehouseReady).length,
      }, day.runCode);
      await lockDeliveryRouteSnapshot({ businessDay: businessDay.date, runCode: day.runCode, snapshot });
      authorityLocked = true;
      await setActiveRunCode(businessDay.date, day.runCode, 'Office route approval');
    } catch (error) {
      if (authorityLocked) {
        await unlockDeliveryRouteSnapshot({
          businessDay: businessDay.date,
          runCode: day.runCode,
          reason: 'Route approval rolled back because shared run activation failed',
        }).catch(() => undefined);
      }
      window.alert(\`Route was not locked: \${error instanceof Error ? error.message : String(error)}\`);
      return;
    }
    setDay((current) => ({
      ...current,
      stopOrder,
      pick: {
        lockedAt: new Date().toISOString(),
        stopOrder,
        boxCodes,
        taskState: {},
        allocDone: {},
        stagedStops: {},
      },
    }));
  }

  async function unlockRoute() {
    if (!canPlan || !day.pick || routeInUse) return;
    if (!window.confirm('Unlock this route? Printed labels become invalid and must be reprinted.')) return;
    try {
      await unlockDeliveryRouteSnapshot({
        businessDay: businessDay.date,
        runCode: day.runCode,
        reason: 'Office unlocked route before picking',
      });
    } catch (error) {
      window.alert(\`Route was not unlocked: \${error instanceof Error ? error.message : String(error)}\`);
      return;
    }
    setDay((current) => ({ ...current, pick: undefined }));
  }`,
  'App office lock/unlock boundary',
);

app = replaceOnce(
  app,
  'onClick={unlockRoute}>Unlock before picking</button>',
  'onClick={() => void unlockRoute()}>Unlock before picking</button>',
  'App async unlock button',
);

writeFileSync(appPath, app);

const driverPath = 'src/app/DriverApp.tsx';
let driver = readFileSync(driverPath, 'utf8');

driver = replaceOnce(
  driver,
  "import { dispatchDeliveryNotifications, queueDeliveryNotifications } from '@/data/repositories/deliveryOperations';",
  "import { dispatchDeliveryNotifications, queueDeliveryNotifications } from '@/data/repositories/deliveryOperations';\nimport { driverRunFromLockedSnapshot, loadLockedDeliveryRouteSnapshot, type LockedDeliveryRouteRecord } from '@/data/repositories/deliveryRouteAuthority';",
  'Driver route-authority import',
);

driver = replaceOnce(
  driver,
`  const [day, setDay] = useState<DriverDayState>(() => loadDriverDayState(businessDay.date));
  const run = useMemo(() => buildDriverRun(orders, businessDay.date, day.releasedOrders, day.runCode), [orders, businessDay.date, day.releasedOrders, day.runCode]);
  const [tab, setTab] = useState<DriverTab>('today');`,
`  const [day, setDay] = useState<DriverDayState>(() => loadDriverDayState(businessDay.date));
  const draftRun = useMemo(() => buildDriverRun(orders, businessDay.date, day.releasedOrders, day.runCode), [orders, businessDay.date, day.releasedOrders, day.runCode]);
  const [lockedRoute, setLockedRoute] = useState<LockedDeliveryRouteRecord | null>(null);
  const [routeAuthorityState, setRouteAuthorityState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [routeAuthorityError, setRouteAuthorityError] = useState('');
  const [routeAuthorityRetry, setRouteAuthorityRetry] = useState(0);
  const [tab, setTab] = useState<DriverTab>('today');`,
  'Driver authoritative route state',
);

driver = replaceOnce(
  driver,
`  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const pickSyncStatus = usePickSync(businessDay.date, day, setDay, actorLabel || 'Driver');`,
`  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    if (!day.pick) {
      setLockedRoute(null);
      setRouteAuthorityState('idle');
      setRouteAuthorityError('');
      return () => { active = false; };
    }

    setLockedRoute(null);
    setRouteAuthorityState('loading');
    setRouteAuthorityError('');
    void loadLockedDeliveryRouteSnapshot({ businessDay: businessDay.date, runCode: day.runCode })
      .then((record) => {
        if (!active) return;
        if (!record) throw new Error('The office-approved route snapshot is missing.');
        if (record.businessDay !== businessDay.date || record.runCode !== day.runCode) {
          throw new Error('The approved route snapshot does not match the active business day and run.');
        }
        setLockedRoute(record);
        setRouteAuthorityState('ready');
      })
      .catch((reason) => {
        if (!active) return;
        setLockedRoute(null);
        setRouteAuthorityState('error');
        setRouteAuthorityError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, [businessDay.date, day.pick?.lockedAt, day.runCode, routeAuthorityRetry]);

  const run = useMemo(() => {
    if (!day.pick) return draftRun;
    if (lockedRoute) return driverRunFromLockedSnapshot(lockedRoute.snapshot);
    return { ...draftRun, stops: [], totalCartons: 0, readyStops: 0 };
  }, [day.pick, draftRun, lockedRoute]);

  const pickSyncStatus = usePickSync(businessDay.date, day, setDay, actorLabel || 'Driver');`,
  'Driver authoritative route load effect',
);

driver = replaceOnce(
  driver,
`  async function startRoute() {
    const pendingIds = rows.filter((row) => row.progress.status === 'PENDING').map((row) => row.stop.orderId);`,
`  async function startRoute() {
    if (day.pick && !lockedRoute) {
      window.alert('Approved route snapshot is unavailable. Ask office to re-approve the route before departure.');
      return;
    }
    const pendingIds = rows.filter((row) => row.progress.status === 'PENDING').map((row) => row.stop.orderId);`,
  'Driver fail-closed departure guard',
);

driver = replaceOnce(
  driver,
`        {!rows.length ? (
          <p className="driver-card-meta">No orders released into today’s run yet — the office releases orders from the Ordermentum tab first.</p>
        ) : routeStatus === 'NOT_STARTED' && !routeLocked ? (`,
`        {routeLocked && routeAuthorityState !== 'ready' ? (
          <>
            <p className="driver-card-meta">
              {routeAuthorityState === 'loading'
                ? 'Loading the exact office-approved route snapshot…'
                : \`Approved route snapshot unavailable. \${routeAuthorityError || 'Ask office to re-approve the route.'}\`}
            </p>
            {routeAuthorityState === 'error' ? (
              <button type="button" className="driver-ghost-button" onClick={() => setRouteAuthorityRetry((value) => value + 1)}>Retry approved route</button>
            ) : null}
          </>
        ) : !rows.length ? (
          <p className="driver-card-meta">No orders released into today’s run yet — the office releases orders from the Ordermentum tab first.</p>
        ) : routeStatus === 'NOT_STARTED' && !routeLocked ? (`,
  'Driver route-authority fail-closed UI',
);

writeFileSync(driverPath, driver);

console.log('TRANSFORM-006 authoritative route wiring applied.');
