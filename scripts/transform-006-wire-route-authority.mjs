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
`  useEffect(() => {
    if (import.meta.env.DEV && !authEnabled) return;
    if (authEnabled && !authProfile?.user_id) return;
    void reloadViews();
  }, [reloadViews, authEnabled, authProfile?.user_id]);`,
`  useEffect(() => {
    if (import.meta.env.DEV && !authEnabled) return;
    if (authEnabled && !authProfile?.user_id) return;
    if (authEnabled && authProfile?.app_role === 'DRIVER') {
      // A production Driver consumes only the assigned route snapshot + shared
      // run state. Never preload broad Ordermentum order/customer views into a
      // Driver browser merely to rebuild a route the office already approved.
      trustedLiveDataRef.current = null;
      setData(initialData);
      setOrders(initialData.orders);
      setSnapshotReady(false);
      setLoadWarning('');
      setLoadError('');
      return;
    }
    void reloadViews();
  }, [reloadViews, authEnabled, authProfile?.user_id, authProfile?.app_role]);`,
  'Production Driver broad-data loading boundary',
);

source = replaceOnce(
  source,
`  if (role === 'driver') return <Suspense fallback={<LoadingScreen message="Loading driver app..." />}><DriverApp orders={orders} setOrders={setOrders} businessDay={data.businessDay} onLogout={logout} loadError={loadError || undefined} actorLabel={authProfile.display_name || authProfile.email} /></Suspense>;`,
`  if (role === 'driver') return <Suspense fallback={<LoadingScreen message="Loading driver app..." />}><DriverApp orders={initialData.orders} setOrders={setOrders} businessDay={data.businessDay} onLogout={logout} loadError={loadError || undefined} actorLabel={authProfile.display_name || authProfile.email} /></Suspense>;`,
  'Production Driver empty broad-order prop',
);

writeFileSync(path, source);
console.log('TRANSFORM-006 production Driver broad-data boundary applied.');
