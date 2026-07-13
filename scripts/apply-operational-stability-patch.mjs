#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/app/App.tsx';
let source = await readFile(path, 'utf8');

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  "import { buildEcoFlowData } from '@/domain/ecoflowData';",
  "import { buildEcoFlowData } from '@/domain/ecoflowData';\nimport { buildProductionEmptyData } from '@/domain/productionData';",
  'production data import',
);

replaceOnce(
  'const initialData = buildEcoFlowData();',
  `const initialData = import.meta.env.DEV ? buildEcoFlowData() : buildProductionEmptyData();
const AUTH_PROFILE_CACHE_KEY = 'ecoflow:last-verified-profile';

function readCachedAuthProfile(): EcoFlowAuthProfile | null {
  try {
    const raw = window.sessionStorage.getItem(AUTH_PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EcoFlowAuthProfile;
    return parsed?.user_id && parsed?.app_role ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedAuthProfile(profile: EcoFlowAuthProfile | null) {
  if (!profile) window.sessionStorage.removeItem(AUTH_PROFILE_CACHE_KEY);
  else window.sessionStorage.setItem(AUTH_PROFILE_CACHE_KEY, JSON.stringify(profile));
}`,
  'production initial data',
);

replaceOnce(
  "function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'danger' | 'blue' }) {",
  `function ProfileRecoveryScreen({ error, onRetry, onLogout }: { error: string; onRetry: () => void; onLogout: () => void }) {
  return (
    <main className="login-page">
      <section className="login-card" role="alert">
        <div className="login-brand-row">
          <BrandMark large />
          <div><div className="login-brand-name">EcoFlow</div><div className="login-brand-subtitle">SECURE SESSION ACTIVE</div></div>
        </div>
        <h1>Reloading your access profile</h1>
        <p>Your secure session is still active. EcoFlow will not sign you out because a profile read was interrupted.</p>
        {error ? <div className="error-message">{error}</div> : null}
        <div className="row-actions">
          <button className="primary-button" type="button" onClick={onRetry}>Retry access profile</button>
          <button className="soft-button" type="button" onClick={onLogout}>Logout</button>
        </div>
      </section>
    </main>
  );
}

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'danger' | 'blue' }) {`,
  'profile recovery screen',
);

replaceOnce(
  `  const [authChecked, setAuthChecked] = useState(!authEnabled);
  const [authProfile, setAuthProfile] = useState<EcoFlowAuthProfile | null>(null);
  const [authError, setAuthError] = useState('');`,
  `  const [authChecked, setAuthChecked] = useState(!authEnabled);
  const [hasSecureSession, setHasSecureSession] = useState(false);
  const [authProfile, setAuthProfile] = useState<EcoFlowAuthProfile | null>(() => readCachedAuthProfile());
  const [authError, setAuthError] = useState('');`,
  'auth state',
);

replaceOnce(
  `  async function refreshAuthProfile() {
    if (!supabase) return null;
    const { data: currentUser, error } = await supabase
      .from('v_ecoflow_current_user')
      .select('*')
      .maybeSingle();

    if (error) {
      setAuthError(error.message);
      setAuthProfile(null);
      return null;
    }

    const profile = (currentUser ?? null) as EcoFlowAuthProfile | null;
    setAuthProfile(profile);
    setAuthError('');
    return profile;
  }`,
  `  async function refreshAuthProfile() {
    if (!supabase) return null;
    const { data: currentUser, error } = await supabase
      .from('v_ecoflow_current_user')
      .select('*')
      .maybeSingle();

    if (error) {
      setAuthError(error.message);
      const sessionResult = await supabase.auth.getSession();
      const cached = readCachedAuthProfile();
      if (cached && sessionResult.data.session?.user.id === cached.user_id) {
        setAuthProfile(cached);
        return cached;
      }
      return null;
    }

    const profile = (currentUser ?? null) as EcoFlowAuthProfile | null;
    setAuthProfile(profile);
    writeCachedAuthProfile(profile);
    setAuthError('');
    return profile;
  }`,
  'profile reload behavior',
);

replaceOnce(
  `      if (sessionResult.session) {
        await refreshAuthProfile();
      } else {
        setAuthProfile(null);
      }`,
  `      if (sessionResult.session) {
        setHasSecureSession(true);
        const cached = readCachedAuthProfile();
        if (cached && cached.user_id !== sessionResult.session.user.id) {
          writeCachedAuthProfile(null);
          setAuthProfile(null);
        }
        await refreshAuthProfile();
      } else {
        setHasSecureSession(false);
        setAuthProfile(null);
        writeCachedAuthProfile(null);
      }`,
  'initial session handling',
);

replaceOnce(
  `      if (session) {
        void refreshAuthProfile().finally(() => setAuthChecked(true));
      } else {
        setAuthProfile(null);
        setAuthChecked(true);
      }`,
  `      if (session) {
        setHasSecureSession(true);
        void refreshAuthProfile().finally(() => setAuthChecked(true));
      } else {
        setHasSecureSession(false);
        setAuthProfile(null);
        writeCachedAuthProfile(null);
        setAuthChecked(true);
      }`,
  'auth event handling',
);

replaceOnce(
  `    window.localStorage.removeItem('ecoflow-role');
    if (supabase) await supabase.auth.signOut();
    setLegacyRole(null);
    setAuthProfile(null);`,
  `    window.localStorage.removeItem('ecoflow-role');
    writeCachedAuthProfile(null);
    if (supabase) await supabase.auth.signOut();
    setHasSecureSession(false);
    setLegacyRole(null);
    setAuthProfile(null);`,
  'logout cache clearing',
);

replaceOnce(
  `      const views = await loadSupabaseOrdermentumViews();
      if (!views) return;`,
  `      const views = await loadSupabaseOrdermentumViews();
      if (!views) throw new Error('Supabase live views are not configured.');`,
  'required live views',
);

source = source
  .replaceAll('Supabase orders failed to load —the data below is fallback/demo, not live.', 'Live operational refresh failed. The last trusted snapshot remains on screen; EcoFlow is not showing demo data.')
  .replaceAll('Supabase orders failed to load —showing fallback data.', 'Live operational refresh failed. The last trusted snapshot remains on screen; EcoFlow is not showing demo data.')
  .replaceAll("action: 'Read fallback active'", "action: 'Live refresh unavailable'");

replaceOnce(
  `  if (!authChecked) return <LoadingScreen />;
  if (!authProfile) return <EmailLoginScreen supabase={supabase!} authError={authError} onSignedIn={() => void refreshAuthProfile()} />;`,
  `  if (!authChecked) return <LoadingScreen />;
  if (hasSecureSession && !authProfile) return <ProfileRecoveryScreen error={authError} onRetry={() => void refreshAuthProfile()} onLogout={() => void logout()} />;
  if (!authProfile) return <EmailLoginScreen supabase={supabase!} authError={authError} onSignedIn={() => void refreshAuthProfile()} />;`,
  'secure profile recovery render',
);

await writeFile(path, source);
console.log('Operational stability patch applied to src/app/App.tsx');
