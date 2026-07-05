import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BrandMark } from '@/app/Brand';

export function AuthCallbackScreen({ supabase }: { supabase: SupabaseClient }) {
  const [message, setMessage] = useState('Completing secure sign-in…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function completeCallback() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          // detectSessionInUrl handles older hash-token invite and recovery links.
          const { error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
        }

        if (!active) return;
        setMessage('Secure session created. Continue to set or confirm your password.');
        window.history.replaceState({}, document.title, '/auth/set-password');
        window.setTimeout(() => window.location.assign('/auth/set-password'), 500);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    void completeCallback();

    return () => { active = false; };
  }, [supabase]);

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand-row">
          <BrandMark large />
          <div>
            <div className="login-brand-name">EcoFlow</div>
            <div className="login-brand-subtitle">AUTH CALLBACK</div>
          </div>
        </div>
        <h1>{error ? 'Sign-in link failed' : message}</h1>
        {error ? <div className="error-message">{error}</div> : <p>Please keep this tab open.</p>}
      </section>
    </main>
  );
}
