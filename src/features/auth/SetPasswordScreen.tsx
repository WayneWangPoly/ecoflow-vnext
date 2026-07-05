import { useEffect, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { BrandMark } from '@/app/Brand';

export function SetPasswordScreen({ supabase }: { supabase: SupabaseClient }) {
  const [user, setUser] = useState<User | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser()
      .then(({ data, error: userError }) => {
        if (!active) return;
        if (userError) setError(userError.message);
        setUser(data.user ?? null);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : String(err)));
    return () => { active = false; };
  }, [supabase]);

  async function savePassword() {
    setError(null);
    setMessage(null);

    if (password.length < 10) {
      setError('Use at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage('Password saved. Redirecting to EcoFlow…');
      window.setTimeout(() => window.location.assign('/'), 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand-row">
          <BrandMark large />
          <div>
            <div className="login-brand-name">EcoFlow</div>
            <div className="login-brand-subtitle">SET PASSWORD</div>
          </div>
        </div>
        <h1>Set your password</h1>
        <p>{user?.email ? `Signed in as ${user.email}.` : 'Open your invitation link again if this page does not recognise your account.'}</p>
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <label htmlFor="confirm-password">Confirm password</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void savePassword()}
        />
        {message ? <div className="sync-error-banner">{message}</div> : null}
        {error ? <div className="error-message">{error}</div> : null}
        <button className="primary-button" type="button" disabled={loading || !user} onClick={() => void savePassword()}>
          {loading ? 'Saving…' : 'Save password and continue'}
        </button>
      </section>
    </main>
  );
}
