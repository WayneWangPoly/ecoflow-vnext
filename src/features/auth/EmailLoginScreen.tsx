import { useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BrandMark } from '@/app/Brand';

function friendlyResetError(message: string) {
  if (message.toLowerCase().includes('rate limit')) {
    return 'Too many password reset emails. Try again later or ask an owner/admin to set the password directly.';
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
}: {
  supabase: SupabaseClient;
  authError?: string;
  onSignedIn: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(authError || null);
  const [loading, setLoading] = useState(false);

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
      setMessage('Signed in. Opening portal…');
      await onSignedIn();
      window.setTimeout(() => window.location.assign('/'), 250);
    } catch (err) {
      setMessage(null);
      setError(err instanceof Error ? err.message : String(err));
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
        {message ? <div className="sync-error-banner">{message}</div> : null}
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
