import type { DesktopTab, Role } from '@/domain/types';

export type IntelligenceWorkspaceId =
  | 'control-room'
  | 'ordermentum'
  | 'orders'
  | 'inventory'
  | 'customers'
  | 'stores'
  | 'delivery'
  | 'returns'
  | 'exceptions'
  | 'analytics'
  | 'logs'
  | 'settings';

export type IntelligenceEntityKind =
  | 'order'
  | 'commercial-sku'
  | 'physical-sku'
  | 'customer'
  | 'store'
  | 'delivery-run';

export type IntelligenceRouteMatch = {
  workspace: IntelligenceWorkspaceId;
  canonicalPath: string;
  entityKind?: IntelligenceEntityKind;
  entityId?: string;
  legacyDesktopTab: DesktopTab | null;
};

export type IntelligenceRouteResolution =
  | { status: 'READY'; route: IntelligenceRouteMatch }
  | { status: 'FORBIDDEN'; route: IntelligenceRouteMatch; reason: 'ROLE_NOT_AUTHORISED' }
  | { status: 'UNAVAILABLE'; pathname: string; reason: 'ROUTE_NOT_FOUND' | 'INVALID_ENTITY_ID' };

export type DesktopRouteBoundaryState =
  | {
      status: 'FORBIDDEN';
      pathname: string;
      workspace: IntelligenceWorkspaceId;
      reason: 'ROLE_NOT_AUTHORISED';
    }
  | {
      status: 'UNAVAILABLE';
      pathname: string;
      workspace?: IntelligenceWorkspaceId;
      reason: 'ROUTE_NOT_FOUND' | 'INVALID_ENTITY_ID' | 'WORKSPACE_NOT_MIGRATED';
    };

export type DesktopRouteAdapterModel = {
  enabled: boolean;
  tab: DesktopTab;
  boundary: DesktopRouteBoundaryState | null;
  canonicalRedirect?: string;
};

type StaticRoute = {
  path: string;
  workspace: IntelligenceWorkspaceId;
  legacyDesktopTab: DesktopTab | null;
};

type DynamicRoute = StaticRoute & {
  entityKind: IntelligenceEntityKind;
  pattern: RegExp;
};

const STATIC_ROUTES: readonly StaticRoute[] = [
  { path: '/control-room', workspace: 'control-room', legacyDesktopTab: 'dashboard' },
  { path: '/ordermentum', workspace: 'ordermentum', legacyDesktopTab: 'ordermentum' },
  { path: '/orders', workspace: 'orders', legacyDesktopTab: 'orders' },
  { path: '/inventory', workspace: 'inventory', legacyDesktopTab: 'inventory' },
  { path: '/customers', workspace: 'customers', legacyDesktopTab: 'stores' },
  { path: '/delivery', workspace: 'delivery', legacyDesktopTab: 'delivery' },
  { path: '/returns', workspace: 'returns', legacyDesktopTab: null },
  { path: '/exceptions', workspace: 'exceptions', legacyDesktopTab: null },
  { path: '/analytics', workspace: 'analytics', legacyDesktopTab: 'reconciliation' },
  { path: '/logs', workspace: 'logs', legacyDesktopTab: 'logs' },
  { path: '/settings', workspace: 'settings', legacyDesktopTab: 'settings' },
] as const;

const DYNAMIC_ROUTES: readonly DynamicRoute[] = [
  { path: '/orders/:orderId', pattern: /^\/orders\/([^/]+)\/?$/, workspace: 'orders', entityKind: 'order', legacyDesktopTab: 'orders' },
  { path: '/inventory/commercial/:skuId', pattern: /^\/inventory\/commercial\/([^/]+)\/?$/, workspace: 'inventory', entityKind: 'commercial-sku', legacyDesktopTab: 'inventory' },
  { path: '/inventory/physical/:itemId', pattern: /^\/inventory\/physical\/([^/]+)\/?$/, workspace: 'inventory', entityKind: 'physical-sku', legacyDesktopTab: 'inventory' },
  { path: '/customers/:customerId', pattern: /^\/customers\/([^/]+)\/?$/, workspace: 'customers', entityKind: 'customer', legacyDesktopTab: 'stores' },
  { path: '/stores/:storeId', pattern: /^\/stores\/([^/]+)\/?$/, workspace: 'stores', entityKind: 'store', legacyDesktopTab: 'stores' },
  { path: '/delivery/runs/:runCode', pattern: /^\/delivery\/runs\/([^/]+)\/?$/, workspace: 'delivery', entityKind: 'delivery-run', legacyDesktopTab: 'delivery' },
] as const;

const OWNER_ADMIN_WORKSPACES = new Set<IntelligenceWorkspaceId>(STATIC_ROUTES.map((route) => route.workspace).concat(['stores']));
const ACCOUNT_WORKSPACES = new Set<IntelligenceWorkspaceId>(['control-room', 'orders', 'customers', 'stores', 'delivery', 'analytics', 'settings']);
const VIEWER_WORKSPACES = new Set<IntelligenceWorkspaceId>(['control-room', 'orders', 'inventory', 'customers', 'stores', 'delivery', 'analytics', 'logs']);

const LEGACY_TAB_PATHS: Readonly<Record<DesktopTab, string>> = {
  dashboard: '/control-room',
  ordermentum: '/ordermentum',
  orders: '/orders',
  delivery: '/delivery',
  inventory: '/inventory',
  stores: '/customers',
  reconciliation: '/analytics',
  logs: '/logs',
  settings: '/settings',
};

function normalisePathname(pathname: string) {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] || '/';
  if (withoutQuery === '/') return '/control-room';
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery;
}

function decodeEntityId(rawValue: string): string | null {
  try {
    const decoded = decodeURIComponent(rawValue).trim();
    if (!decoded || decoded.length > 180 || decoded.includes('/')) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function pathForLegacyDesktopTab(tab: DesktopTab): string {
  return LEGACY_TAB_PATHS[tab];
}

export function matchIntelligenceRoute(pathname: string): IntelligenceRouteResolution {
  const normalised = normalisePathname(pathname);

  for (const route of DYNAMIC_ROUTES) {
    const match = route.pattern.exec(normalised);
    if (!match) continue;
    const entityId = decodeEntityId(match[1]);
    if (!entityId) return { status: 'UNAVAILABLE', pathname: normalised, reason: 'INVALID_ENTITY_ID' };
    return {
      status: 'READY',
      route: {
        workspace: route.workspace,
        canonicalPath: route.path,
        entityKind: route.entityKind,
        entityId,
        legacyDesktopTab: route.legacyDesktopTab,
      },
    };
  }

  const route = STATIC_ROUTES.find((candidate) => candidate.path === normalised);
  if (!route) return { status: 'UNAVAILABLE', pathname: normalised, reason: 'ROUTE_NOT_FOUND' };
  return {
    status: 'READY',
    route: {
      workspace: route.workspace,
      canonicalPath: route.path,
      legacyDesktopTab: route.legacyDesktopTab,
    },
  };
}

export function canRoleAccessIntelligenceWorkspace(role: Role, workspace: IntelligenceWorkspaceId): boolean {
  if (role === 'owner' || role === 'admin') return OWNER_ADMIN_WORKSPACES.has(workspace);
  if (role === 'account') return ACCOUNT_WORKSPACES.has(workspace);
  if (role === 'viewer') return VIEWER_WORKSPACES.has(workspace);
  return false;
}

export function resolveIntelligenceRoute(pathname: string, role: Role): IntelligenceRouteResolution {
  const matched = matchIntelligenceRoute(pathname);
  if (matched.status !== 'READY') return matched;
  if (!canRoleAccessIntelligenceWorkspace(role, matched.route.workspace)) {
    return { status: 'FORBIDDEN', route: matched.route, reason: 'ROLE_NOT_AUTHORISED' };
  }
  return matched;
}

export function deriveDesktopRouteAdapterModel(input: {
  enabled: boolean;
  pathname: string;
  role: Role;
  legacyTab: DesktopTab;
}): DesktopRouteAdapterModel {
  if (!input.enabled) {
    return { enabled: false, tab: input.legacyTab, boundary: null };
  }

  const resolution = resolveIntelligenceRoute(input.pathname, input.role);
  if (resolution.status === 'FORBIDDEN') {
    return {
      enabled: true,
      tab: input.legacyTab,
      boundary: {
        status: 'FORBIDDEN',
        pathname: input.pathname,
        workspace: resolution.route.workspace,
        reason: resolution.reason,
      },
    };
  }

  if (resolution.status === 'UNAVAILABLE') {
    return {
      enabled: true,
      tab: input.legacyTab,
      boundary: {
        status: 'UNAVAILABLE',
        pathname: input.pathname,
        reason: resolution.reason,
      },
    };
  }

  const routeTab = resolution.route.legacyDesktopTab;
  if (!routeTab) {
    return {
      enabled: true,
      tab: input.legacyTab,
      boundary: {
        status: 'UNAVAILABLE',
        pathname: input.pathname,
        workspace: resolution.route.workspace,
        reason: 'WORKSPACE_NOT_MIGRATED',
      },
    };
  }

  return {
    enabled: true,
    tab: routeTab,
    boundary: null,
    canonicalRedirect: input.pathname === '/' ? '/control-room' : undefined,
  };
}

export function desktopTabNavigationTarget(tab: DesktopTab, search: string): string {
  const query = search.startsWith('?') || !search ? search : `?${search}`;
  return `${pathForLegacyDesktopTab(tab)}${query}`;
}

export function canonicalIntelligencePaths(): readonly string[] {
  return [...STATIC_ROUTES.map((route) => route.path), ...DYNAMIC_ROUTES.map((route) => route.path)];
}
