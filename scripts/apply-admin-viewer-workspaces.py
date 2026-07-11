from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding='utf-8-sig')
    if old in source:
        source = source.replace(old, new, 1)
        file_path.write_text(source, encoding='utf-8')
        print(f'updated {path}')
        return
    if new in source:
        print(f'already updated {path}')
        return
    raise SystemExit(f'expected source block not found in {path}: {old[:120]!r}')


replace_once(
    'src/domain/types.ts',
    "export type Role = 'owner' | 'account' | 'warehouse' | 'driver';",
    "export type Role = 'owner' | 'admin' | 'account' | 'warehouse' | 'driver' | 'viewer';",
)

replace_once(
    'src/app/App.tsx',
    """const desktopTabs: { id: DesktopTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'ordermentum', label: 'Ordermentum' },
  { id: 'orders', label: 'Orders' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'stores', label: 'Stores' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Settings' }
];
""",
    """const desktopTabs: { id: DesktopTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'ordermentum', label: 'Ordermentum' },
  { id: 'orders', label: 'Orders' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'stores', label: 'Stores' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Settings' }
];

const roleLabels: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  account: 'Account',
  warehouse: 'Warehouse',
  driver: 'Driver',
  viewer: 'Viewer',
};

const desktopTabAccess: Partial<Record<Role, ReadonlySet<DesktopTab>>> = {
  account: new Set<DesktopTab>(['dashboard', 'orders', 'delivery', 'stores', 'reconciliation', 'settings']),
  viewer: new Set<DesktopTab>(['dashboard', 'orders', 'delivery', 'inventory', 'stores', 'reconciliation', 'logs']),
};

function availableDesktopTabs(role: Role) {
  const allowed = desktopTabAccess[role];
  return allowed ? desktopTabs.filter((tab) => allowed.has(tab.id)) : desktopTabs;
}
""",
)

replace_once(
    'src/app/App.tsx',
    """function roleLabel(role: Role) {
  return roleOptions.find((item) => item.role === role)?.label ?? role;
}

function roleFromAppRole(appRole: EcoFlowAppRole): Role {
  if (appRole === 'WAREHOUSE') return 'warehouse';
  if (appRole === 'DRIVER') return 'driver';
  if (appRole === 'ACCOUNT') return 'account';
  return 'owner';
}
""",
    """function roleLabel(role: Role) {
  return roleLabels[role];
}

function roleFromAppRole(appRole: EcoFlowAppRole): Role {
  if (appRole === 'ADMIN') return 'admin';
  if (appRole === 'VIEWER') return 'viewer';
  if (appRole === 'WAREHOUSE') return 'warehouse';
  if (appRole === 'DRIVER') return 'driver';
  if (appRole === 'ACCOUNT') return 'account';
  return 'owner';
}
""",
)

replace_once(
    'src/app/App.tsx',
    """          {desktopTabs.map((item) => (
            <button key={item.id} type=\"button\" className={cls(tab === item.id && 'active')} onClick={() => setTab(item.id)}>{item.label}</button>
          ))}
""",
    """          {availableDesktopTabs(role).map((item) => (
            <button key={item.id} type=\"button\" className={cls(tab === item.id && 'active')} onClick={() => setTab(item.id)}>{item.label}</button>
          ))}
""",
)

replace_once(
    'src/app/App.tsx',
    """          <div className=\"topbar-actions\">
            <button type=\"button\" onClick={onLogout}>Logout</button>
          </div>
""",
    """          <div className=\"topbar-actions\">
            {role === 'owner' || role === 'admin' ? (
              <select
                aria-label=\"Open workspace\"
                defaultValue=\"\"
                onChange={(event) => {
                  const target = event.currentTarget.value;
                  if (target) window.open(target, '_blank', 'noopener,noreferrer');
                  event.currentTarget.value = '';
                }}
              >
                <option value=\"\">Open workspace…</option>
                <option value=\"/warehouse-map\">Warehouse Map</option>
                <option value=\"/?workspace=warehouse\">Warehouse Operations</option>
                <option value=\"/?workspace=driver\">Driver Operations</option>
              </select>
            ) : null}
            <button type=\"button\" onClick={onLogout}>Logout</button>
          </div>
""",
)

replace_once(
    'src/app/App.tsx',
    """      {loadError ? <div className=\"sync-error-banner desktop-error-banner\">Supabase orders failed to load —the data below is fallback/demo, not live. {loadError}</div> : null}
      {tab === 'dashboard' ? <HeroDashboard role={role} orders={effectiveOrders} stock={stock} dataQuality={data.dataQuality} syncBatch={data.syncBatch} bucketCounts={getOrderBucketCounts(effectiveOrders, data.businessDay.date)} /> : null}
""",
    """      {loadError ? <div className=\"sync-error-banner desktop-error-banner\">Supabase orders failed to load —the data below is fallback/demo, not live. {loadError}</div> : null}
      {role === 'viewer' ? <div className=\"sync-error-banner desktop-readonly-banner\">Viewer workspace is read-only. Operational changes, route approval, integrations and team administration are hidden.</div> : null}
      {tab === 'dashboard' ? <HeroDashboard role={role} orders={effectiveOrders} stock={stock} dataQuality={data.dataQuality} syncBatch={data.syncBatch} bucketCounts={getOrderBucketCounts(effectiveOrders, data.businessDay.date)} /> : null}
""",
)

replace_once(
    'src/app/App.tsx',
    """      {tab === 'delivery' ? <DeliveryBoard orders={effectiveOrders} day={day} setDay={setDay} businessDay={data.businessDay} canPlan={role === 'owner' || role === 'account'} /> : null}
""",
    """      {tab === 'delivery' ? <DeliveryBoard orders={effectiveOrders} day={day} setDay={setDay} businessDay={data.businessDay} canPlan={role === 'owner' || role === 'admin' || role === 'account'} /> : null}
""",
)

replace_once(
    'src/app/App.tsx',
    """  const role = roleFromAppRole(authProfile.app_role);
  if (role === 'warehouse') return <WarehouseWorkspace orders={orders} businessDay={data.businessDay} loadError={loadError || undefined} onLogout={logout} actorLabel={authProfile.display_name || authProfile.email} />;
  if (role === 'driver') return <Suspense fallback={<LoadingScreen message=\"Loading driver app...\" />}><DriverApp orders={orders} setOrders={setOrders} businessDay={data.businessDay} onLogout={logout} loadError={loadError || undefined} actorLabel={authProfile.display_name || authProfile.email} /></Suspense>;
""",
    """  const role = roleFromAppRole(authProfile.app_role);
  const workspace = canManageTeam(authProfile) ? new URLSearchParams(window.location.search).get('workspace') : null;
  if (workspace === 'warehouse') return <WarehouseWorkspace orders={orders} businessDay={data.businessDay} loadError={loadError || undefined} onLogout={logout} actorLabel={authProfile.display_name || authProfile.email} />;
  if (workspace === 'driver') return <Suspense fallback={<LoadingScreen message=\"Loading driver app...\" />}><DriverApp orders={orders} setOrders={setOrders} businessDay={data.businessDay} onLogout={logout} loadError={loadError || undefined} actorLabel={authProfile.display_name || authProfile.email} /></Suspense>;
  if (role === 'warehouse') return <WarehouseWorkspace orders={orders} businessDay={data.businessDay} loadError={loadError || undefined} onLogout={logout} actorLabel={authProfile.display_name || authProfile.email} />;
  if (role === 'driver') return <Suspense fallback={<LoadingScreen message=\"Loading driver app...\" />}><DriverApp orders={orders} setOrders={setOrders} businessDay={data.businessDay} onLogout={logout} loadError={loadError || undefined} actorLabel={authProfile.display_name || authProfile.email} /></Suspense>;
""",
)

replace_once(
    'src/app/DriverApp.tsx',
    """  reconcileStopOrder,
  RUN_SIZE_WARNING,
  saveDriverDayState,
""",
    """  reconcileStopOrder,
  saveDriverDayState,
""",
)

replace_once(
    'src/app/DriverApp.tsx',
    """      {rows.length > RUN_SIZE_WARNING ? (
        <p className=\"driver-inline-hint\">{rows.length} stops in one run — consider splitting into Run A / Run B from the office before locking.</p>
      ) : null}

""",
    "",
)

replace_once(
    'src/domain/driverRun.ts',
    """const READY_STATUSES: OrderStatus[] = ['STAGED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'];
/** Soft guidance only — the run is never silently truncated. */
export const RUN_SIZE_WARNING = 16;

""",
    """const READY_STATUSES: OrderStatus[] = ['STAGED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'];

""",
)

replace_once(
    'src/RoleAwareDesktopNavigation.tsx',
    """  if (text.includes('ACCOUNT')) return 'ACCOUNT';
  if (text.includes('OWNER') || text.includes('ADMIN')) return 'OWNER';
""",
    """  if (text.includes('ACCOUNT')) return 'ACCOUNT';
  if (text.includes('ADMIN')) return 'ADMIN';
  if (text.includes('OWNER')) return 'OWNER';
""",
)

replace_once(
    'src/RoleAwareDesktopNavigation.tsx',
    """      nav.classList.toggle('role-nav-account', role === 'ACCOUNT');
      nav.classList.toggle('role-nav-owner', role === 'OWNER');
""",
    """      nav.classList.toggle('role-nav-account', role === 'ACCOUNT');
      nav.classList.toggle('role-nav-owner', role === 'OWNER' || role === 'ADMIN');
""",
)

replace_once(
    'src/RoleAwareDesktopNavigation.tsx',
    """      helper.textContent = role === 'ACCOUNT'
        ? 'Accounts workspace: route planning, statements, stores and order controls.'
        : 'Owner workspace: full operating command centre.';
""",
    """      helper.textContent = role === 'ACCOUNT'
        ? 'Accounts workspace: route planning, statements, stores and order controls.'
        : role === 'ADMIN'
          ? 'Admin workspace: full operations, security and workspace access.'
          : 'Owner workspace: full operating command centre.';
""",
)

replace_once(
    'scripts/audit-warehouse-productisation.mjs',
    """has(app, 'Start next delivery run', 'Owner or Accounts must be able to open the next run after completion.');
has(multiRunMigration, 'v_ecoflow_active_run', 'Database projections must follow the active run namespace.');
""",
    """has(app, 'Start next delivery run', 'Owner or Accounts must be able to open the next run after completion.');
has(app, \"if (appRole === 'ADMIN') return 'admin'\", 'Admin must remain a distinct full-access desktop role.');
has(app, \"if (appRole === 'VIEWER') return 'viewer'\", 'Viewer must never be mapped to Owner.');
has(app, 'Viewer workspace is read-only', 'Viewer must receive an explicit read-only surface.');
has(app, 'Open workspace…', 'Owner/Admin must have an explicit workspace switcher.');
has(app, '/?workspace=warehouse', 'Workspace switcher must open warehouse operations without changing identity.');
lacks(driverApp, 'RUN_SIZE_WARNING', 'Driver route size must not infer van capacity from stop count.');
lacks(driverRun, 'RUN_SIZE_WARNING', 'Domain rules must not contain an unsupported van-capacity threshold.');
has(multiRunMigration, 'v_ecoflow_active_run', 'Database projections must follow the active run namespace.');
""",
)

print('Admin, Viewer and workspace hardening patch complete.')
