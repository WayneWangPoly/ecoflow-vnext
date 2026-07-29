import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { DesktopTab, Role } from '@/domain/types';
import { intelligenceFeatureFlags } from '../featureFlags';
import {
  deriveDesktopRouteAdapterModel,
  desktopTabNavigationTarget,
  type DesktopRouteBoundaryState,
} from './routeContract';

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
