import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@/domain/types';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { hasSupabaseAuthClient, supabase } from '@/lib/supabaseClient';

const PROFILE_CACHE_KEY = 'ecoflow:last-verified-profile';

export type OperationalSessionValue = {
  authEnabled: boolean;
  authChecked: boolean;
  hasSession: boolean;
  profile: EcoFlowAuthProfile | null;
  role: Role | null;
  authError: string;
  refreshProfile: () => Promise<EcoFlowAuthProfile | null>;
  logout: () => Promise<void>;
};

const OperationalSessionContext = createContext<OperationalSessionValue | null>(null);

function readCachedProfile(userId?: string | null) {
  try {
    const raw = window.sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EcoFlowAuthProfile;
    if (!parsed?.user_id || !parsed.app_role) return null;
    if (userId && parsed.user_id !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: EcoFlowAuthProfile | null) {
  if (profile) window.sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
  else window.sessionStorage.removeItem(PROFILE_CACHE_KEY);
}

export function roleFromOperationalProfile(profile: EcoFlowAuthProfile): Role {
  if (profile.app_role === 'ADMIN') return 'admin';
  if (profile.app_role === 'ACCOUNT') return 'account';
  if (profile.app_role === 'WAREHOUSE') return 'warehouse';
  if (profile.app_role === 'DRIVER') return 'driver';
  if (profile.app_role === 'VIEWER') return 'viewer';
  return 'owner';
}

function developmentProfile(authEnabled: boolean): EcoFlowAuthProfile | null {
  if (!import.meta.env.DEV || authEnabled) return null;
  const appRole = (window.localStorage.getItem('ecoflow-role') || 'owner').toUpperCase() as EcoFlowAuthProfile['app_role'];
  return {
    user_id: '00000000-0000-4000-8000-000000000001',
    email: 'development@ecoflow.local',
    display_name: 'Development user',
    app_role: appRole,
    team_status: 'ACTIVE',
    is_active: true,
    invited_at: null,
    accepted_at: null,
    last_seen_at: null,
  };
}

export function OperationalSessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const authEnabled = hasSupabaseAuthClient() && Boolean(supabase);
  const [authChecked, setAuthChecked] = useState(!authEnabled);
  const [hasSession, setHasSession] = useState(false);
  const [profile, setProfile] = useState<EcoFlowAuthProfile | null>(() => readCachedProfile());
  const [authError, setAuthError] = useState('');

  const refreshProfile = useCallback(async () => {
    if (!supabase) return developmentProfile(authEnabled);
    const { data, error } = await supabase.from('v_ecoflow_current_user').select('*').maybeSingle();
    if (error) {
      setAuthError(error.message);
      const sessionResult = await supabase.auth.getSession();
      const cached = readCachedProfile(sessionResult.data.session?.user.id);
      if (cached) setProfile(cached);
      return cached;
    }
    const next = (data ?? null) as EcoFlowAuthProfile | null;
    setProfile(next);
    writeCachedProfile(next);
    setAuthError('');
    return next;
  }, [authEnabled]);

  useEffect(() => {
    if (!authEnabled || !supabase) {
      const local = developmentProfile(authEnabled);
      setProfile(local);
      setHasSession(Boolean(local));
      setAuthChecked(true);
      return;
    }

    const client = supabase;
    let active = true;
    void client.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error) {
        setAuthError(error.message);
        setAuthChecked(true);
        return;
      }
      setHasSession(Boolean(data.session));
      if (data.session) await refreshProfile();
      else {
        setProfile(null);
        writeCachedProfile(null);
      }
      if (active) setAuthChecked(true);
    });

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setHasSession(Boolean(session));
      if (session) void refreshProfile().finally(() => setAuthChecked(true));
      else {
        setProfile(null);
        writeCachedProfile(null);
        setAuthChecked(true);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [authEnabled, refreshProfile]);

  const effectiveProfile = profile ?? developmentProfile(authEnabled);
  const role = effectiveProfile ? roleFromOperationalProfile(effectiveProfile) : null;

  const logout = useCallback(async () => {
    writeCachedProfile(null);
    if (supabase) await supabase.auth.signOut();
    setProfile(null);
    setHasSession(false);
    navigate('/control-room', { replace: true });
  }, [navigate]);

  const value = useMemo<OperationalSessionValue>(() => ({
    authEnabled,
    authChecked,
    hasSession: authEnabled ? hasSession : Boolean(effectiveProfile),
    profile: effectiveProfile,
    role,
    authError,
    refreshProfile,
    logout,
  }), [authEnabled, authChecked, authError, effectiveProfile, hasSession, logout, refreshProfile, role]);

  return <OperationalSessionContext.Provider value={value}>{children}</OperationalSessionContext.Provider>;
}

export function useOperationalSession() {
  const value = useContext(OperationalSessionContext);
  if (!value) throw new Error('useOperationalSession must be used within OperationalSessionProvider.');
  return value;
}