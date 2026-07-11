import { useEffect, useState } from 'react';
import { EmailLoginScreen } from '@/features/auth/EmailLoginScreen';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { hasSupabaseAuthClient, supabase } from '@/lib/supabaseClient';
import { WarehouseMapPage } from './WarehouseMapPage';

const ALLOWED_MAP_ROLES = new Set<EcoFlowAuthProfile['app_role']>(['OWNER', 'ADMIN', 'WAREHOUSE']);

type RouteState = 'checking' | 'signed-out' | 'allowed' | 'denied' | 'inactive' | 'error';

function RouteMessage({ title, detail, allowLogout = false }: { title: string; detail: string; allowLogout?: boolean }) {
  async function logout() {
    window.localStorage.removeItem('ecoflow-role');
    if (supabase) await supabase.auth.signOut();
    window.location.assign('/');
  }

  return (
    <main className="login-page">
      <section className="login-card" role="alert">
        <div className="login-brand-name">EcoFlow</div>
        <div className="login-brand-subtitle">WAREHOUSE MAP ACCESS</div>
        <h1>{title}</h1>
        <p>{detail}</p>
        <a className="primary-button" href="/">Back to EcoFlow</a>
        {allowLogout ? <button type="button" onClick={() => void logout()}>Sign out</button> : null}
      </section>
    </main>
  );
}

export default function WarehouseMapRoute() {
  const authEnabled = hasSupabaseAuthClient() && Boolean(supabase);
  const [state, setState] = useState<RouteState>(() => {
    if (authEnabled) return 'checking';
    const localRole = window.localStorage.getItem('ecoflow-role');
    return localRole === 'owner' || localRole === 'warehouse' ? 'allowed' : 'denied';
  });
  const [profile, setProfile] = useState<EcoFlowAuthProfile | null>(null);
  const [error, setError] = useState('');

  async function refreshProfile() {
    if (!supabase) return;
    const { data, error: profileError } = await supabase
      .from('v_ecoflow_current_user')
      .select('*')
      .maybeSingle();

    if (profileError) {
      setError(profileError.message);
      setProfile(null);
      setState('error');
      return;
    }

    const next = (data ?? null) as EcoFlowAuthProfile | null;
    setProfile(next);
    setError('');
    if (!next) {
      setState('signed-out');
      return;
    }
    if (!next.is_active || next.team_status === 'SUSPENDED' || next.team_status === 'DISABLED') {
      setState('inactive');
      return;
    }
    setState(ALLOWED_MAP_ROLES.has(next.app_role) ? 'allowed' : 'denied');
  }

  useEffect(() => {
    if (!authEnabled || !supabase) return;
    const client = supabase;
    let active = true;

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        setError(sessionError.message);
        setState('error');
        return;
      }
      if (!data.session) {
        setState('signed-out');
        return;
      }
      void refreshProfile();
    });

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) {
        setProfile(null);
        setState('signed-out');
        return;
      }
      void refreshProfile();
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [authEnabled]);

  if (state === 'checking') return <RouteMessage title="Checking warehouse access" detail="EcoFlow is verifying your account and role." />;
  if (state === 'signed-out' && supabase) return <EmailLoginScreen supabase={supabase} authError={error} onSignedIn={refreshProfile} redirectTo="/warehouse-map" />;
  if (state === 'inactive') return <RouteMessage title="Account is not active" detail="This account is suspended, disabled or still awaiting activation." allowLogout />;
  if (state === 'denied') return <RouteMessage title="Warehouse Map is not a role" detail={`The map is a protected feature for Owner, Admin and Warehouse accounts. Your ${profile?.app_role || 'current'} role does not have map access.`} allowLogout={Boolean(profile)} />;
  if (state === 'error') return <RouteMessage title="Warehouse access could not be verified" detail={error || 'The secure warehouse profile is unavailable.'} allowLogout />;
  return <WarehouseMapPage />;
}
