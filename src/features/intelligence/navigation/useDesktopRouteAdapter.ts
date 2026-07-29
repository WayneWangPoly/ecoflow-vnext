import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { DesktopTab, Role } from '@/domain/types';
import { intelligenceFeatureFlags } from '../featureFlags';
import {
  pathForLegacyDesktopTab,
  resolveIntelligenceRoute,
  type IntelligenceWorkspaceId,
} from './routeContract';

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

export function useDesktopRouteAdapter(role: Role): {
  tab: DesktopTab;
  setTab: (tab: DesktopTab) => void;
  boundary: DesktopRouteBoundaryState | null;
  routed: boolean;
} {
  const location = useLocation();
  const navigate = useNavigate();
  const [legacyTab, setLegacyTab] = useState<DesktopTab>('dashboard');
  const enabled = intelligenceFeatureFlags.overlay_navigation_v1;

  const model = useMemo(
    () => deriveDesktopRouteAdapterModel({
      enabled,
      pathname: location.pathname,
      role,
      legacyTab,
    }),
    [enabled, legacyTab, location.pathname, role],
  );

  useEffect(() => {
    if (!model.canonicalRedirect) return;
    navigate(
      { pathname: model.canonicalRedirect, search: location.search },
      { replace: true },
    );
  }, [location.search, model.canonicalRedirect, navigate]);

  const setTab = useCallback((nextTab: DesktopTab) => {
    if (!enabled) {
      setLegacyTab(nextTab);
      return;
    }
    navigate(desktopTabNavigationTarget(nextTab, location.search));
  }, [enabled, location.search, navigate]);

  return {
    tab: model.tab,
    setTab,
    boundary: model.boundary,
    routed: enabled,
  };
}
