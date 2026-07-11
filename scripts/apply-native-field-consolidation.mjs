import { readFileSync, writeFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const write = (path, value) => writeFileSync(path, value, 'utf8');
function replace(path, pattern, value, label) {
  const source = read(path);
  if (!pattern.test(source)) throw new Error(`${label}: source pattern not found in ${path}`);
  write(path, source.replace(pattern, value));
  console.log(`patched ${path}: ${label}`);
}

const appPath = 'src/app/App.tsx';
replace(
  appPath,
  /import \{ applyDayStateToOrders, buildDriverRun, formatClockTime, loadDriverDayState, saveDriverDayState, stopsInLockedOrder \} from '@\/domain\/driverRun';/,
  `import { applyDayStateToOrders, boxCodeForStop, buildDriverRun, formatClockTime, loadDriverDayState, optimiseStopOrder, reconcileStopOrder, saveDriverDayState } from '@/domain/driverRun';`,
  'load office route-planning helpers',
);
replace(
  appPath,
  /function DeliveryBoard\([\s\S]*?\n\}\n\nfunction InventoryPanel/,
  `function DeliveryBoard({ orders, day, setDay, businessDay, canPlan }: {\n  orders: ImportedOrder[];\n  day: DriverDayState;\n  setDay: React.Dispatch<React.SetStateAction<DriverDayState>>;\n  businessDay: EcoFlowDataSet['businessDay'];\n  canPlan: boolean;\n}) {\n  const run = buildDriverRun(orders, businessDay.date, day.releasedOrders);\n  const orderedIds = reconcileStopOrder(day.pick?.stopOrder || day.stopOrder, run.stops);\n  const byId = new Map(run.stops.map((stop) => [stop.orderId, stop]));\n  const stops = orderedIds.map((orderId, index) => {\n    const stop = byId.get(orderId);\n    return stop ? { ...stop, stopNumber: index + 1, boxCode: day.pick?.boxCodes[orderId] || boxCodeForStop(index) } : null;\n  }).filter((stop): stop is NonNullable<typeof stop> => Boolean(stop));\n  const stagedCount = day.pick ? stops.filter((stop) => day.pick?.stagedStops[stop.orderId]).length : 0;\n  const progressFor = (orderId: string) => day.stopProgress[orderId];\n  const deliveredCount = stops.filter((stop) => progressFor(stop.orderId)?.status === 'DELIVERED').length;\n  const failedCount = stops.filter((stop) => progressFor(stop.orderId)?.status === 'FAILED').length;\n  const routeInUse = Boolean(day.routeStartedAt || stagedCount || Object.keys(day.pick?.taskState || {}).length);\n\n  function setRouteOrder(orderIds: string[]) {\n    setDay((current) => current.pick || current.routeStartedAt ? current : { ...current, stopOrder: orderIds });\n  }\n\n  function moveStop(orderId: string, delta: number) {\n    const current = reconcileStopOrder(day.stopOrder, run.stops);\n    const from = current.indexOf(orderId);\n    const to = Math.max(0, Math.min(current.length - 1, from + delta));\n    if (from < 0 || from === to) return;\n    const next = [...current];\n    next.splice(from, 1);\n    next.splice(to, 0, orderId);\n    setRouteOrder(next);\n  }\n\n  function optimiseRoute() {\n    if (day.pick || day.routeStartedAt) return;\n    setRouteOrder(optimiseStopOrder(run.stops, run.warehousePoint));\n  }\n\n  function lockRoute() {\n    if (!canPlan || day.pick || !stops.length) return;\n    const stopOrder = reconcileStopOrder(day.stopOrder, run.stops);\n    const boxCodes = Object.fromEntries(stopOrder.map((orderId, index) => [orderId, boxCodeForStop(index)]));\n    setDay((current) => ({\n      ...current,\n      stopOrder,\n      pick: {\n        lockedAt: new Date().toISOString(),\n        stopOrder,\n        boxCodes,\n        taskState: {},\n        allocDone: {},\n        stagedStops: {},\n      },\n    }));\n  }\n\n  function unlockRoute() {\n    if (!canPlan || !day.pick || routeInUse) return;\n    if (!window.confirm('Unlock this route? Printed labels become invalid and must be reprinted.')) return;\n    setDay((current) => ({ ...current, pick: undefined }));\n  }\n\n  return (\n    <section className="workspace-stack">\n      <section className="quick-stats">\n        <MetricCard label="RELEASED TO RUN" value={stops.length} tone="green" helper={businessDay.label} />\n        <MetricCard label="ROUTE" value={day.pick ? \`Locked \${formatClockTime(day.pick.lockedAt)}\` : 'Office planning'} tone="gold" helper={day.routeStartedAt ? \`started \${formatClockTime(day.routeStartedAt)}\` : 'Owner/office approves order'} />\n        <MetricCard label="STAGED" value={\`\${stagedCount}/\${stops.length}\`} tone="blue" helper="warehouse progress" />\n        <MetricCard label="DELIVERED" value={\`\${deliveredCount}\${failedCount ? \` · \${failedCount} failed\` : ''}\`} tone="mint" helper={day.routeEndedAt ? \`run finished \${formatClockTime(day.routeEndedAt)}\` : 'live from driver'} />\n      </section>\n      {canPlan && !day.routeStartedAt ? (\n        <section className="panel">\n          <div className="panel-head"><h2>Office route approval</h2><span>Labels and picking use this locked order</span></div>\n          <div className="row-actions">\n            <button className="soft-button" type="button" disabled={Boolean(day.pick) || !stops.length} onClick={optimiseRoute}>Optimise draft</button>\n            {!day.pick ? <button className="primary-small" type="button" disabled={!stops.length} onClick={lockRoute}>Approve &amp; lock route</button> : null}\n            {day.pick ? <button className="soft-button" type="button" disabled={routeInUse} onClick={unlockRoute}>Unlock before picking</button> : null}\n          </div>\n          <div className="list-stack">\n            {stops.map((stop, index) => (\n              <article className="stop-row" key={stop.orderId}>\n                <b>{index + 1}</b>\n                <div><strong>{stop.boxCode} · {stop.store}</strong><span>{stop.suburb} · {stop.cartons} ctn · {stop.orderNo}</span></div>\n                {!day.pick ? <span className="row-actions"><button type="button" disabled={index === 0} onClick={() => moveStop(stop.orderId, -1)}>↑</button><button type="button" disabled={index === stops.length - 1} onClick={() => moveStop(stop.orderId, 1)}>↓</button></span> : <Pill tone="good">LOCKED</Pill>}\n              </article>\n            ))}\n          </div>\n        </section>\n      ) : null}\n      <section className="panel">\n        <div className="panel-head"><h2>Run board</h2><span>shared facts — same data the driver and warehouse see</span></div>\n        <div className="list-stack">\n          {stops.map((stop) => {\n            const progress = progressFor(stop.orderId);\n            const staged = day.pick?.stagedStops[stop.orderId];\n            const status = progress?.status === 'DELIVERED' ? 'DELIVERED'\n              : progress?.status === 'FAILED' ? 'FAILED'\n              : progress?.status === 'ARRIVED' ? 'ARRIVED'\n              : day.routeStartedAt ? 'ON THE WAY'\n              : staged ? 'STAGED'\n              : day.pick ? 'PICKING'\n              : 'RELEASED';\n            const pod = progress?.pod;\n            return (\n              <article className="stop-row" key={stop.orderId}>\n                <b>{stop.stopNumber}</b>\n                <div>\n                  <strong>{stop.boxCode} · {stop.store}</strong>\n                  <span>{stop.cartons} ctn · {stopStatusLabelDesk(status)}{progress?.completedAt ? \` \${formatClockTime(progress.completedAt)}\` : ''}</span>\n                  {pod?.pod1Path || pod?.pod2Path || pod?.photoPath || pod?.signaturePath ? (\n                    <span className="pod-links">\n                      {pod.pod1Path || pod.photoPath ? <a href={podAssetUrl(pod.pod1Path || pod.photoPath!)} target="_blank" rel="noreferrer">POD 1 · location</a> : null}\n                      {pod.pod2Path || pod.signaturePath ? <a href={podAssetUrl(pod.pod2Path || pod.signaturePath!)} target="_blank" rel="noreferrer">POD 2 · all goods</a> : null}\n                    </span>\n                  ) : pod ? <span className="pod-links">POD upload pending</span> : null}\n                </div>\n                <Pill tone={status === 'DELIVERED' ? 'good' : status === 'FAILED' ? 'danger' : status === 'STAGED' || status === 'ON THE WAY' || status === 'ARRIVED' ? 'blue' : 'neutral'}>{status}</Pill>\n              </article>\n            );\n          })}\n          {!stops.length ? <div className="empty-state">No orders released into today’s run yet — release them from the Ordermentum tab.</div> : null}\n        </div>\n      </section>\n    </section>\n  );\n}\n\nfunction InventoryPanel`,
  'replace delivery board with office-owned planner',
);
replace(
  appPath,
  /<DeliveryBoard orders=\{effectiveOrders\} day=\{day\} businessDay=\{data\.businessDay\} \/>/,
  `<DeliveryBoard orders={effectiveOrders} day={day} setDay={setDay} businessDay={data.businessDay} canPlan={role === 'owner'} />`,
  'pass office route-control capability',
);
replace(
  appPath,
  /<label><span>Picking<\/span><strong>Every SKU must scan a matching product barcode before it can be picked; stock is deducted from the live ledger\.<\/strong><\/label>/,
  `<label><span>Route ownership</span><strong>Owner or office approves and locks the stop order before picking; driver devices cannot reorder or unlock it.</strong></label>\n        <label><span>Picking</span><strong>Every SKU must scan a matching product barcode before it can be picked; stock is deducted from the live ledger.</strong></label>`,
  'document route ownership rule',
);

const driverPath = 'src/app/DriverApp.tsx';
replace(
  driverPath,
  /<p className="driver-card-meta">Step 1 · Review the stop order, then lock the route — locking fixes the A–F box letters and generates the pick plan and labels\.<\/p>\n            <button type="button" className="driver-primary-button" onClick=\{\(\) => setTab\('stops'\)\}>\n              <Route size=\{18\} \/> Review &amp; lock route\n            <\/button>/,
  `<p className="driver-card-meta">Waiting for Owner or office to approve and lock today’s route. Stop order and box codes cannot be changed on the driver device.</p>`,
  'remove driver route locking entry point',
);
replace(
  driverPath,
  /\n        \{stopsView === 'map' && rows\.length > 1 && !routeLocked \? \([\s\S]*?\) : null\}\n        \{routeLocked \? \([\s\S]*?\) : null\}/,
  `\n        <span className="driver-inline-hint">Route order is approved by office and read-only on this device.</span>`,
  'remove driver optimise and unlock controls',
);
replace(
  driverPath,
  /\n      \{!routeLocked && rows\.length \? \([\s\S]*?\) : null\}\n/,
  '\n',
  'remove driver lock call to action',
);
replace(
  driverPath,
  /\n                  <button\n                    type="button"\n                    className="drag-handle"[\s\S]*?<\/button>/,
  '',
  'remove driver drag handle',
);
replace(
  driverPath,
  /\n                  <span className="reorder-arrows">[\s\S]*?<\/span>/,
  '',
  'remove driver reorder arrows',
);

const auditPath = 'scripts/audit-warehouse-productisation.mjs';
let audit = read(auditPath);
const marker = `assert.match(driverApp, /await queueDeliveryNotifications/, 'Delivery notification queueing must be part of the native delivery transaction.');`;
if (!audit.includes(marker)) throw new Error('Route audit insertion marker not found.');
audit = audit.replace(marker, `${marker}\nassert.match(driverApp, /Waiting for Owner or office to approve/, 'Driver must wait for office route approval.');\nassert.doesNotMatch(driverApp, /Review &amp; lock route|Confirm route &amp; lock/, 'Driver must not own route locking.');\nassert.match(main, /ProductionWriteSafety/, 'Production safety remains mounted.');\nassert.match(read('src/app/App.tsx'), /Office route approval[\\s\\S]+Approve &amp; lock route/, 'Owner desktop must provide route approval.');`);
write(auditPath, audit);
console.log('patched audit: office owns route order and lock');
