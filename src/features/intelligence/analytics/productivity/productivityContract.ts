export const intelligenceSavedViewReadRpcName = 'get_intelligence_saved_views' as const;
export const intelligenceSavedViewCommandRpcName = 'apply_intelligence_saved_view_command' as const;

export const savedViewWorkspaces = [
  'control-room',
  'orders',
  'inventory',
  'customers',
  'delivery',
  'returns',
  'analytics',
] as const;
export type SavedViewWorkspace = (typeof savedViewWorkspaces)[number];

export const savedViewCommands = [
  'CREATE',
  'DUPLICATE',
  'RENAME',
  'DELETE',
  'SET_ROLE_DEFAULT',
  'CLEAR_ROLE_DEFAULT',
] as const;
export type SavedViewCommand = (typeof savedViewCommands)[number];
export type DesktopRole = 'OWNER' | 'ADMIN' | 'ACCOUNT' | 'VIEWER';

export type SavedViewState = {
  filters: readonly string[];
  sort: string | null;
  visibleColumns: readonly string[];
  dateRange: { from: string; to: string } | null;
  comparisonSettings: readonly string[];
  searchTerm: string | null;
};

export type SavedViewRecord = {
  savedViewId: string;
  workspace: SavedViewWorkspace;
  name: string;
  state: SavedViewState;
  scope: 'PRIVATE' | 'ROLE_DEFAULT';
  roleScope: DesktopRole | null;
  isRoleDefault: boolean;
  version: number;
  canManageRoleDefaults: boolean;
  updatedAt: string;
  readAt: string;
};

export type SavedViewIssue = {
  code:
    | 'INVALID_COLLECTION'
    | 'INVALID_ROW'
    | 'INVALID_ID'
    | 'INVALID_WORKSPACE'
    | 'INVALID_NAME'
    | 'INVALID_STATE'
    | 'INVALID_SCOPE'
    | 'INVALID_ROLE'
    | 'INVALID_VERSION'
    | 'INVALID_TIMESTAMP'
    | 'DUPLICATE_VIEW';
  row?: number;
  field?: string;
};

export type SavedViewReadResult =
  | { ok: true; state: 'ready' | 'partial' | 'empty'; data: readonly SavedViewRecord[]; issues: readonly SavedViewIssue[] }
  | { ok: false; state: 'forbidden' | 'invalid' | 'unavailable' | 'failed'; data: null; error: { code: string; message: string } };

export type SavedViewCommandInput = {
  action: SavedViewCommand;
  savedViewId?: string | null;
  workspace?: SavedViewWorkspace | null;
  name?: string | null;
  state?: SavedViewState | null;
  roleScope?: DesktopRole | null;
};

export type SavedViewCommandResult =
  | { ok: true; commandStatus: 'APPLIED'; savedViewId: string | null; version: number | null; updatedAt: string }
  | { ok: false; state: 'forbidden' | 'invalid' | 'conflict' | 'unavailable' | 'failed'; error: { code: string; message: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WORKSPACES = new Set<string>(savedViewWorkspaces);
const ROLES = new Set<string>(['OWNER', 'ADMIN', 'ACCOUNT', 'VIEWER']);

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, maximum = 180): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

function validTimestamp(value: unknown): string | null {
  const text = cleanText(value, 120);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function boundedUniqueStrings(value: unknown, maximumCount: number, maximumLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumCount) return null;
  const output: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const text = cleanText(candidate, maximumLength);
    if (!text || seen.has(text)) return null;
    seen.add(text);
    output.push(text);
  }
  return output;
}

export function normaliseSavedViewState(value: unknown): SavedViewState | null {
  const raw = objectOf(value);
  if (!raw) return null;
  const allowed = new Set(['filters', 'sort', 'visibleColumns', 'dateRange', 'comparisonSettings', 'searchTerm']);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
  const filters = boundedUniqueStrings(raw.filters ?? [], 20, 180);
  const visibleColumns = boundedUniqueStrings(raw.visibleColumns ?? [], 50, 80);
  const comparisonSettings = boundedUniqueStrings(raw.comparisonSettings ?? [], 20, 120);
  if (!filters || !visibleColumns || !comparisonSettings) return null;
  const sort = raw.sort === null || raw.sort === undefined ? null : cleanText(raw.sort, 180);
  const searchTerm = raw.searchTerm === null || raw.searchTerm === undefined ? null : cleanText(raw.searchTerm, 180);
  if ((raw.sort !== null && raw.sort !== undefined && !sort)
    || (raw.searchTerm !== null && raw.searchTerm !== undefined && !searchTerm)) return null;
  let dateRange: SavedViewState['dateRange'] = null;
  if (raw.dateRange !== null && raw.dateRange !== undefined) {
    const range = objectOf(raw.dateRange);
    const from = cleanText(range?.from, 10);
    const to = cleanText(range?.to, 10);
    if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) return null;
    dateRange = { from, to };
  }
  return { filters, sort, visibleColumns, dateRange, comparisonSettings, searchTerm };
}

export function normaliseSavedViewRows(value: unknown): {
  rows: SavedViewRecord[];
  issues: SavedViewIssue[];
  state: 'ready' | 'partial' | 'empty';
} {
  if (!Array.isArray(value)) {
    return { rows: [], issues: [{ code: 'INVALID_COLLECTION' }], state: 'partial' };
  }
  const rows: SavedViewRecord[] = [];
  const issues: SavedViewIssue[] = [];
  const seen = new Set<string>();
  value.forEach((candidate, row) => {
    const raw = objectOf(candidate);
    if (!raw) {
      issues.push({ code: 'INVALID_ROW', row });
      return;
    }
    const savedViewId = cleanText(raw.saved_view_id, 80);
    const workspace = cleanText(raw.workspace, 40);
    const name = cleanText(raw.name, 80);
    const scope = cleanText(raw.scope, 20)?.toUpperCase();
    const roleScope = raw.role_scope === null || raw.role_scope === undefined
      ? null
      : cleanText(raw.role_scope, 20)?.toUpperCase() ?? null;
    const version = typeof raw.version === 'number' ? raw.version : Number(raw.version);
    const updatedAt = validTimestamp(raw.updated_at);
    const readAt = validTimestamp(raw.read_at);
    const state = normaliseSavedViewState(raw.view_state);
    if (!savedViewId || !UUID.test(savedViewId)) issues.push({ code: 'INVALID_ID', row, field: 'saved_view_id' });
    if (!workspace || !WORKSPACES.has(workspace)) issues.push({ code: 'INVALID_WORKSPACE', row, field: 'workspace' });
    if (!name) issues.push({ code: 'INVALID_NAME', row, field: 'name' });
    if (!state) issues.push({ code: 'INVALID_STATE', row, field: 'view_state' });
    if (scope !== 'PRIVATE' && scope !== 'ROLE_DEFAULT') issues.push({ code: 'INVALID_SCOPE', row, field: 'scope' });
    if (roleScope !== null && !ROLES.has(roleScope)) issues.push({ code: 'INVALID_ROLE', row, field: 'role_scope' });
    if (!Number.isSafeInteger(version) || version < 1) issues.push({ code: 'INVALID_VERSION', row, field: 'version' });
    if (!updatedAt || !readAt || (updatedAt && readAt && updatedAt > readAt)) issues.push({ code: 'INVALID_TIMESTAMP', row });
    const invalid = issues.some((issue) => issue.row === row);
    if (invalid || !savedViewId || !workspace || !name || !state || !updatedAt || !readAt) return;
    if (seen.has(savedViewId)) {
      issues.push({ code: 'DUPLICATE_VIEW', row });
      return;
    }
    seen.add(savedViewId);
    rows.push({
      savedViewId,
      workspace: workspace as SavedViewWorkspace,
      name,
      state,
      scope: scope as 'PRIVATE' | 'ROLE_DEFAULT',
      roleScope: roleScope as DesktopRole | null,
      isRoleDefault: raw.is_role_default === true,
      version,
      canManageRoleDefaults: raw.can_manage_role_defaults === true,
      updatedAt,
      readAt,
    });
  });
  return { rows, issues, state: rows.length === 0 && issues.length === 0 ? 'empty' : issues.length ? 'partial' : 'ready' };
}

export const quickActionDefinitions = [
  { key: 'CONTROL_ROOM', label: 'Open Control Room', path: '/control-room', shortcut: 'G C' },
  { key: 'ORDERS', label: 'Open Orders', path: '/orders', shortcut: 'G O' },
  { key: 'INVENTORY', label: 'Open Inventory', path: '/inventory', shortcut: 'G I' },
  { key: 'CUSTOMERS', label: 'Open Customers', path: '/customers', shortcut: 'G U' },
  { key: 'DELIVERY', label: 'Open Delivery', path: '/delivery', shortcut: 'G D' },
  { key: 'RETURNS', label: 'Open Returns', path: '/returns', shortcut: 'G R' },
  { key: 'ANALYTICS', label: 'Open Analytics', path: '/analytics', shortcut: 'G A' },
] as const;
export type QuickActionKey = (typeof quickActionDefinitions)[number]['key'];

export function validateQuickActions(): string[] {
  const issues: string[] = [];
  const keys = new Set<string>();
  const shortcuts = new Set<string>();
  for (const action of quickActionDefinitions) {
    if (keys.has(action.key)) issues.push(`DUPLICATE_KEY:${action.key}`);
    if (shortcuts.has(action.shortcut)) issues.push(`DUPLICATE_SHORTCUT:${action.shortcut}`);
    if (!action.path.startsWith('/') || action.path.includes('?') || action.path.includes('#')) issues.push(`INVALID_PATH:${action.key}`);
    keys.add(action.key);
    shortcuts.add(action.shortcut);
  }
  return issues;
}

export const comparisonEntityKinds = [
  'PRODUCT',
  'CUSTOMER',
  'STORE',
  'ORDER',
  'DELIVERY_RUN',
  'METRIC',
] as const;
export type ComparisonEntityKind = (typeof comparisonEntityKinds)[number];
export type ComparisonPermission = 'ALLOWED' | 'FORBIDDEN' | 'UNAVAILABLE';
export type ComparisonItem = {
  key: string;
  kind: ComparisonEntityKind;
  entityId: string;
  label: string;
  permission: ComparisonPermission;
  dimensionKeys: readonly string[];
  values: Readonly<Record<string, string | number | null>>;
};
export type ComparisonTray = { items: readonly ComparisonItem[]; maximum: 4 };

export function createComparisonItem(input: {
  kind: unknown;
  entityId: unknown;
  label: unknown;
  permission?: ComparisonPermission;
  dimensionKeys?: readonly string[];
  values?: Readonly<Record<string, string | number | null>>;
}): ComparisonItem | null {
  const kind = cleanText(input.kind, 30)?.toUpperCase();
  const entityId = cleanText(input.entityId, 120);
  const label = cleanText(input.label, 120);
  if (!kind || !comparisonEntityKinds.includes(kind as ComparisonEntityKind)
    || !entityId || !SAFE_ID.test(entityId) || !label) return null;
  const dimensionKeys = boundedUniqueStrings(input.dimensionKeys ?? [], 20, 80);
  if (!dimensionKeys) return null;
  const values = input.values ?? {};
  if (Object.keys(values).some((key) => !SAFE_ID.test(key))) return null;
  return {
    key: `${kind}:${entityId}`,
    kind: kind as ComparisonEntityKind,
    entityId,
    label,
    permission: input.permission ?? 'ALLOWED',
    dimensionKeys,
    values,
  };
}

export function pinComparisonItem(tray: ComparisonTray, item: ComparisonItem): { tray: ComparisonTray; issue: string | null } {
  if (item.permission !== 'ALLOWED') return { tray, issue: `PERMISSION_${item.permission}` };
  if (tray.items.some((candidate) => candidate.key === item.key)) return { tray, issue: 'DUPLICATE_ITEM' };
  if (tray.items.length >= tray.maximum) return { tray, issue: 'TRAY_LIMIT_REACHED' };
  return { tray: { ...tray, items: [...tray.items, item] }, issue: null };
}

export function comparisonAlignment(items: readonly ComparisonItem[]): {
  state: 'EMPTY' | 'ALIGNED' | 'PARTIAL' | 'INCOMPATIBLE';
  sharedDimensions: readonly string[];
} {
  if (items.length === 0) return { state: 'EMPTY', sharedDimensions: [] };
  const shared = items[0].dimensionKeys.filter((key) => items.every((item) => item.dimensionKeys.includes(key)));
  if (shared.length === 0) return { state: 'INCOMPATIBLE', sharedDimensions: [] };
  const allSame = items.every((item) => item.dimensionKeys.length === shared.length);
  return { state: allSame ? 'ALIGNED' : 'PARTIAL', sharedDimensions: shared };
}

export type CsvColumn = { key: string; label: string };
export type CsvExportInput = {
  columns: readonly CsvColumn[];
  rows: readonly Readonly<Record<string, unknown>>[];
  selectedKeys?: readonly string[];
  maximumRows?: number;
};
export type CsvExportResult =
  | { ok: true; csv: string; rowCount: number; columnCount: number }
  | { ok: false; issue: 'INVALID_COLUMNS' | 'ROW_LIMIT_EXCEEDED' | 'NO_SELECTED_ROWS' };

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value).slice(0, 4_000);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildCsvExport(input: CsvExportInput): CsvExportResult {
  if (input.columns.length === 0 || input.columns.length > 50
    || input.columns.some((column) => !SAFE_ID.test(column.key) || !cleanText(column.label, 120))) {
    return { ok: false, issue: 'INVALID_COLUMNS' };
  }
  const maximumRows = Math.min(Math.max(input.maximumRows ?? 5_000, 1), 5_000);
  let rows = [...input.rows];
  if (input.selectedKeys) {
    const selected = new Set(input.selectedKeys);
    rows = rows.filter((row) => selected.has(String(row.key ?? '')));
    if (rows.length === 0) return { ok: false, issue: 'NO_SELECTED_ROWS' };
  }
  if (rows.length > maximumRows) return { ok: false, issue: 'ROW_LIMIT_EXCEEDED' };
  const lines = [
    input.columns.map((column) => csvCell(column.label)).join(','),
    ...rows.map((row) => input.columns.map((column) => csvCell(row[column.key])).join(',')),
  ];
  return { ok: true, csv: `${lines.join('\r\n')}\r\n`, rowCount: rows.length, columnCount: input.columns.length };
}
