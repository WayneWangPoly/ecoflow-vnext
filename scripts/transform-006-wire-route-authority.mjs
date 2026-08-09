import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label}: expected source block was not found`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: source block is not unique`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const path = 'src/app/App.tsx';
let source = readFileSync(path, 'utf8');

source = replaceOnce(
  source,
  "import { buildLockedDeliveryRouteSnapshot, lockDeliveryRouteSnapshot, unlockDeliveryRouteSnapshot } from '@/data/repositories/deliveryRouteAuthority';",
  "import { buildLockedDeliveryRouteSnapshot, loadLockedDeliveryRouteSnapshot, lockDeliveryRouteSnapshot, unlockDeliveryRouteSnapshot, type LockedDeliveryRouteRecord } from '@/data/repositories/deliveryRouteAuthority';\nimport { loadActiveDispatchDrivers, type DispatchDriver } from '@/data/repositories/deliveryDispatchDrivers';",
  'Delivery authority imports',
);

source = replaceOnce(
  source,
`  const failedCount = stops.filter((stop) => progressFor(stop.orderId)?.status === 'FAILED').length;
  const routeInUse = Boolean(day.routeStartedAt || stagedCount || Object.keys(day.pick?.taskState || {}).length);

  function setRouteOrder(orderIds: string[]) {`,
`  const failedCount = stops.filter((stop) => progressFor(stop.orderId)?.status === 'FAILED').length;
  const routeInUse = Boolean(day.routeStartedAt || stagedCount || Object.keys(day.pick?.taskState || {}).length);
  const [dispatchDrivers, setDispatchDrivers] = useState<DispatchDriver[]>([]);
  const [driverDirectoryState, setDriverDirectoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [driverDirectoryError, setDriverDirectoryError] = useState('');
  const [assignedDriverUserId, setAssignedDriverUserId] = useState('');
  const [lockedRouteRecord, setLockedRouteRecord] = useState<LockedDeliveryRouteRecord | null>(null);
  const [lockedRouteError, setLockedRouteError] = useState('');

  useEffect(() => {
    let active = true;
    if (!canPlan) {
      setDispatchDrivers([]);
      setDriverDirectoryState('idle');
      setDriverDirectoryError('');
      return () => { active = false; };
    }
    setDriverDirectoryState('loading');
    setDriverDirectoryError('');
    void loadActiveDispatchDrivers()
      .then((rows) => {
        if (!active) return;
        setDispatchDrivers(rows);
        setAssignedDriverUserId((current) => rows.some((row) => row.userId === current) ? current : rows[0]?.userId || '');
        setDriverDirectoryState('ready');
      })
      .catch((reason) => {
        if (!active) return;
        setDispatchDrivers([]);
        setAssignedDriverUserId('');
        setDriverDirectoryState('error');
        setDriverDirectoryError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, [canPlan]);

  useEffect(() => {
    let active = true;
    if (!day.pick) {
      setLockedRouteRecord(null);
      setLockedRouteError('');
      return () => { active = false; };
    }
    setLockedRouteError('');
    void loadLockedDeliveryRouteSnapshot({ businessDay: businessDay.date, runCode: day.runCode })
      .then((record) => {
        if (!active) return;
        setLockedRouteRecord(record);
        if (record?.assignedDriverUserId) setAssignedDriverUserId(record.assignedDriverUserId);
      })
      .catch((reason) => {
        if (!active) return;
        setLockedRouteRecord(null);
        setLockedRouteError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, [businessDay.date, day.pick?.lockedAt, day.runCode]);

  function setRouteOrder(orderIds: string[]) {`,
  'Delivery Driver assignment state',
);

source = replaceOnce(
  source,
`  async function lockRoute() {
    if (!canPlan || day.pick || !stops.length) return;
    const stopOrder = reconcileStopOrder(day.stopOrder, run.stops);`,
`  async function lockRoute() {
    if (!canPlan || day.pick || !stops.length) return;
    if (!assignedDriverUserId) {
      window.alert('Route was not locked: choose an active Driver first.');
      return;
    }
    const stopOrder = reconcileStopOrder(day.stopOrder, run.stops);`,
  'Delivery lock assignment guard',
);

source = replaceOnce(
  source,
`      await lockDeliveryRouteSnapshot({ businessDay: businessDay.date, runCode: day.runCode, snapshot });
      authorityLocked = true;`,
`      const authority = await lockDeliveryRouteSnapshot({
        businessDay: businessDay.date,
        runCode: day.runCode,
        assignedDriverUserId,
        snapshot,
      });
      setLockedRouteRecord(authority);
      authorityLocked = true;`,
  'Delivery assignment-aware lock call',
);

source = replaceOnce(
  source,
`      if (authorityLocked) {
        await unlockDeliveryRouteSnapshot({
          businessDay: businessDay.date,
          runCode: day.runCode,
          reason: 'Route approval rolled back because shared run activation failed',
        }).catch(() => undefined);
      }
      window.alert(\`Route was not locked: \${error instanceof Error ? error.message : String(error)}\`);`,
`      if (authorityLocked) {
        await unlockDeliveryRouteSnapshot({
          businessDay: businessDay.date,
          runCode: day.runCode,
          reason: 'Route approval rolled back because shared run activation failed',
        }).catch(() => undefined);
        setLockedRouteRecord(null);
      }
      window.alert(\`Route was not locked: \${error instanceof Error ? error.message : String(error)}\`);`,
  'Delivery assignment lock rollback',
);

source = replaceOnce(
  source,
`    setDay((current) => ({ ...current, pick: undefined }));
  }

  async function startNextRun() {`,
`    setLockedRouteRecord(null);
    setDay((current) => ({ ...current, pick: undefined }));
  }

  async function startNextRun() {`,
  'Delivery assignment unlock state',
);

source = replaceOnce(
  source,
`          <div className="panel-head"><h2>Office route approval</h2><span>Labels and picking use this locked order</span></div>
          <div className="row-actions">
            <button className="soft-button" type="button" disabled={Boolean(day.pick) || !stops.length} onClick={optimiseRoute}>Optimise draft</button>
            {!day.pick ? <button className="primary-small" type="button" disabled={!stops.length} onClick={() => void lockRoute()}>Approve &amp; lock route</button> : null}
            {day.pick ? <button className="soft-button" type="button" disabled={routeInUse} onClick={() => void unlockRoute()}>Unlock before picking</button> : null}
          </div>`,
`          <div className="panel-head"><h2>Office route approval</h2><span>Labels, Driver hand-off and picking use this locked order</span></div>
          <div className="row-actions">
            {!day.pick ? (
              <select
                aria-label="Assigned Driver"
                value={assignedDriverUserId}
                disabled={driverDirectoryState !== 'ready' || !dispatchDrivers.length}
                onChange={(event) => setAssignedDriverUserId(event.target.value)}
              >
                <option value="">Assign Driver…</option>
                {dispatchDrivers.map((driver) => <option key={driver.userId} value={driver.userId}>{driver.label}</option>)}
              </select>
            ) : <span>Driver: {lockedRouteRecord?.assignedDriverLabel || 'loading assignment…'}</span>}
            <button className="soft-button" type="button" disabled={Boolean(day.pick) || !stops.length} onClick={optimiseRoute}>Optimise draft</button>
            {!day.pick ? <button className="primary-small" type="button" disabled={!stops.length || !assignedDriverUserId || driverDirectoryState !== 'ready'} onClick={() => void lockRoute()}>Approve &amp; lock route</button> : null}
            {day.pick ? <button className="soft-button" type="button" disabled={routeInUse} onClick={() => void unlockRoute()}>Unlock before picking</button> : null}
          </div>
          {!day.pick && driverDirectoryState === 'error' ? <small>Driver directory unavailable: {driverDirectoryError}</small> : null}
          {!day.pick && driverDirectoryState === 'ready' && !dispatchDrivers.length ? <small>No active Driver account is available. Add or activate a Driver before route approval.</small> : null}
          {day.pick && lockedRouteError ? <small>Locked Driver assignment unavailable: {lockedRouteError}. Unlock and re-approve before execution.</small> : null}`,
  'Delivery Driver assignment controls',
);

writeFileSync(path, source);
console.log('TRANSFORM-006 active Driver assignment wiring applied.');
