from pathlib import Path


def replace_once(text: str, before: str, after: str, label: str) -> str:
    count = text.count(before)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(before, after, 1)


app_path = Path('src/app/App.tsx')
app = app_path.read_text()

app = replace_once(
    app,
    "import { TeamInviteSettingsPanel } from '@/features/settings/TeamInviteSettingsPanel';",
    "import { TeamInviteSettingsPanel } from '@/features/settings/TeamInviteSettingsPanel';\nimport { DashboardPage } from '@/features/dashboard/DashboardPage';",
    'DashboardPage import',
)
app = replace_once(
    app,
    '<span>PACKAGING OPERATIONS</span>',
    "<span>{role === 'account' ? 'ACCOUNTS OPERATIONS' : `${roleLabel(role).toUpperCase()} OPERATIONS`}</span>",
    'native role title',
)
app = replace_once(
    app,
    "{item.id === 'ordermentum' ? 'Inbox' : item.id === 'reconciliation' ? 'Accounts' : item.label}",
    "{item.id === 'ordermentum' ? 'Ordermentum Inbox' : item.id === 'reconciliation' ? 'Accounts' : item.label}",
    'mobile inbox name',
)

desktop_signature_before = """function DesktopWorkspace({ role, data, orders, setOrders, stock, stores, logs, onLogout, loadError, authProfile, onReload }: {
  role: Role;
  data: EcoFlowDataSet;
  orders: ImportedOrder[];
  setOrders: React.Dispatch<React.SetStateAction<ImportedOrder[]>>;
  stock: StockRow[];
  stores: StoreProfile[];
  logs: Activity[];
  onLogout: () => void;
  loadError?: string;
  authProfile?: EcoFlowAuthProfile | null;
  onReload: () => Promise<void>;
}) {"""
desktop_signature_after = """function DesktopWorkspace({ role, data, orders, setOrders, stock, stores, logs, onLogout, loadError, authProfile, onReload, snapshotReady, snapshotLoading, healthNotice }: {
  role: Role;
  data: EcoFlowDataSet;
  orders: ImportedOrder[];
  setOrders: React.Dispatch<React.SetStateAction<ImportedOrder[]>>;
  stock: StockRow[];
  stores: StoreProfile[];
  logs: Activity[];
  onLogout: () => void;
  loadError?: string;
  authProfile?: EcoFlowAuthProfile | null;
  onReload: () => Promise<void>;
  snapshotReady: boolean;
  snapshotLoading: boolean;
  healthNotice?: string;
}) {"""
app = replace_once(app, desktop_signature_before, desktop_signature_after, 'DesktopWorkspace signature')

app = replace_once(
    app,
    "{tab === 'dashboard' ? <HeroDashboard role={role} orders={effectiveOrders} stock={stock} dataQuality={data.dataQuality} syncBatch={data.syncBatch} bucketCounts={getOrderBucketCounts(effectiveOrders, data.businessDay.date)} /> : null}",
    "{tab === 'dashboard' ? <DashboardPage role={role} data={data} orders={effectiveOrders} snapshotReady={snapshotReady} loading={snapshotLoading} loadError={loadError} healthNotice={healthNotice} onReload={onReload} onOpenOrders={() => setTab('orders')} /> : null}",
    'native DashboardPage render',
)
app = replace_once(
    app,
    "  const [loadError, setLoadError] = useState('');",
    "  const [loadError, setLoadError] = useState('');\n  const [loadWarning, setLoadWarning] = useState('');\n  const [snapshotReady, setSnapshotReady] = useState(import.meta.env.DEV);\n  const [snapshotLoading, setSnapshotLoading] = useState(false);",
    'snapshot state',
)

before_reload = """  const reloadViews = useCallback(async () => {
    try {
      const views = await loadSupabaseOrdermentumViews();
      if (!views) throw new Error('Supabase live views are not configured.');
      const nextData = applySupabaseOrdermentumViews(initialData, views);
      setData(nextData);
      setOrders(nextData.orders);
      setLoadError('');
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'Supabase order inbox is unavailable.');
    }
  }, []);

  useEffect(() => {
    void reloadViews();
  }, [reloadViews, authProfile?.user_id]);"""

after_reload = """  const reloadViews = useCallback(async () => {
    setSnapshotLoading(true);
    try {
      const views = await loadSupabaseOrdermentumViews();
      if (!views) throw new Error('Supabase live views are not configured.');
      const nextData = applySupabaseOrdermentumViews(initialData, views);
      setData(nextData);
      setOrders(nextData.orders);
      setSnapshotReady(true);
      setLoadWarning(
        views.diagnostics
          .filter((row) => row.status === 'DEGRADED')
          .map((row) => row.source)
          .join(', ')
      );
      setLoadError('');
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : 'Supabase order inbox is unavailable.');
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authEnabled && !authProfile?.user_id) return;
    void reloadViews();
  }, [reloadViews, authEnabled, authProfile?.user_id]);"""
app = replace_once(app, before_reload, after_reload, 'trusted snapshot reload')

legacy_before = "return <DesktopWorkspace role={legacyRole} data={data} orders={orders} setOrders={setOrders} stock={data.stock} stores={data.stores} logs={loadError ? [{ at: 'sync', actor: 'Supabase', action: 'Live refresh unavailable', detail: loadError }, ...data.logs] : data.logs} onLogout={logout} loadError={loadError || undefined} authProfile={null} onReload={reloadViews} />;"
legacy_after = "return <DesktopWorkspace role={legacyRole} data={data} orders={orders} setOrders={setOrders} stock={data.stock} stores={data.stores} logs={loadError ? [{ at: 'sync', actor: 'Supabase', action: 'Live refresh unavailable', detail: loadError }, ...data.logs] : data.logs} onLogout={logout} loadError={loadError || undefined} authProfile={null} onReload={reloadViews} snapshotReady={snapshotReady} snapshotLoading={snapshotLoading} healthNotice={loadWarning || undefined} />;"
app = replace_once(app, legacy_before, legacy_after, 'legacy desktop workspace')

auth_before = "return <DesktopWorkspace role={role} data={data} orders={orders} setOrders={setOrders} stock={data.stock} stores={data.stores} logs={loadError ? [{ at: 'sync', actor: 'Supabase', action: 'Live refresh unavailable', detail: loadError }, ...data.logs] : data.logs} onLogout={logout} loadError={loadError || undefined} authProfile={authProfile} onReload={reloadViews} />;"
auth_after = "return <DesktopWorkspace role={role} data={data} orders={orders} setOrders={setOrders} stock={data.stock} stores={data.stores} logs={loadError ? [{ at: 'sync', actor: 'Supabase', action: 'Live refresh unavailable', detail: loadError }, ...data.logs] : data.logs} onLogout={logout} loadError={loadError || undefined} authProfile={authProfile} onReload={reloadViews} snapshotReady={snapshotReady} snapshotLoading={snapshotLoading} healthNotice={loadWarning || undefined} />;"
app = replace_once(app, auth_before, auth_after, 'authenticated desktop workspace')
app_path.write_text(app)

main_path = Path('src/main.tsx')
main = main_path.read_text()
main = replace_once(main, "import { OwnerCommandCenter } from './OwnerCommandCenter';\n", '', 'OwnerCommandCenter import')
main = replace_once(main, "import './dashboardBootstrap.css';\n", '', 'dashboard bootstrap import')
main = replace_once(main, '          <OwnerCommandCenter />\n', '', 'OwnerCommandCenter mount')
main_path.write_text(main)

Path('src/OwnerCommandCenter.tsx').unlink(missing_ok=True)
Path('src/dashboardBootstrap.css').unlink(missing_ok=True)
