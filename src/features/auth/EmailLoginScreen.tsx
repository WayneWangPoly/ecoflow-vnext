import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BrandMark } from '@/app/Brand';

function friendlyResetError(message: string) {
  if (message.toLowerCase().includes('rate limit')) {
    return 'Too many password reset emails. Try again later or ask an owner/admin to set the password directly.';
  }
  return message;
}

export function EmailLoginScreen({
  supabase,
  authError,
  onSignedIn,
}: {
  supabase: SupabaseClient;
  authError?: string;
  onSignedIn: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(authError || null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      if (resetError) throw resetError;
      setMessage('Password reset email sent.');
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(friendlyResetError(raw));
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
            <div className="login-brand-subtitle">SECURE OPERATIONS</div>
          </div>
        </div>
        <h1>Sign in</h1>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          autoFocus
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void signIn()}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void signIn()}
        />
        {message ? <div className="sync-error-banner">{message}</div> : null}
        {error ? <div className="error-message">{error}</div> : null}
        <button className="primary-button" type="button" disabled={loading || !email.trim() || !password} onClick={() => void signIn()}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" disabled={loading || !email.trim()} onClick={() => void resetPassword()}>
          Reset password
        </button>
      </section>
    </main>
  );
}
