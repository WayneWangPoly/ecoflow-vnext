import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BrandMark } from '@/app/Brand';

function friendlyResetError(message: string) {
  if (message.toLowerCase().includes('rate limit')) {
    return 'Too many password reset emails. Try again later or ask an owner/admin to set the password directly.';
  }
  return friendlyAuthError(message);
}

function friendlyAuthError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('current transaction is aborted') || normalized.includes('transaction block') || normalized.includes('25p02')) {
    return 'Your secure session was created, but EcoFlow could not finish loading your access profile. Wait a moment and sign in again. If this continues, ask an owner or administrator to check the first database error in Supabase.';
  }
  if (normalized.includes('postgres') || normalized.includes('database error') || normalized.includes('failed to fetch user profile')) {
    return 'EcoFlow could not load your access profile from the live database. Please try again shortly or contact an owner or administrator.';
  }
  return message;
}

function readLoginForm(form: HTMLFormElement) {
  const formData = new FormData(form);
  return {
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
  };
}

export function EmailLoginScreen({
  supabase,
  authError,
  onSignedIn,
  redirectTo = '/',
}: {
  supabase: SupabaseClient;
  authError?: string;
  onSignedIn: () => void | Promise<void>;
  redirectTo?: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(authError ? friendlyAuthError(authError) : null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setError(authError ? friendlyAuthError(authError) : null);
  }, [authError]);

  async function signIn(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const formValues = event ? readLoginForm(event.currentTarget) : { email: email.trim(), password };
    const nextEmail = formValues.email;
    const nextPassword = formValues.password;

    if (!nextEmail || !nextPassword) {
      setError('Enter email and password.');
      return;
    }

    setLoading(true);
    setError(null);
    setMessage('Signing in…');
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: nextEmail,
        password: nextPassword,
      });
      if (signInError) throw signInError;
      if (!data.session) throw new Error('Sign-in did not return a session. Try again.');
      setMessage('Secure session created. Loading your EcoFlow profile…');
      await onSignedIn();
      window.setTimeout(() => window.location.assign(redirectTo), 350);
    } catch (err) {
      setMessage(null);
      const raw = err instanceof Error ? err.message : String(err);
      setError(friendlyAuthError(raw));
      setLoading(false);
    }
  }

  async function resetPassword() {
    const nextEmail = email.trim();
    if (!nextEmail) {
      setError('Enter your email first.');
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(nextEmail, {
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
      <form className="login-card" onSubmit={(event) => void signIn(event)}>
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
          name="email"
          type="email"
          value={email}
          autoFocus
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
        />
        {message ? <div className="success-message">{message}</div> : null}
        {error ? <div className="error-message">{error}</div> : null}
        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" disabled={loading || !email.trim()} onClick={() => void resetPassword()}>
          Reset password
        </button>
      </form>
    </main>
  );
}
