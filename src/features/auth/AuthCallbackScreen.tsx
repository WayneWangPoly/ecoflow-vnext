import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BrandMark } from '@/app/Brand';

function friendlyAuthError(message: string) {
  if (message.toLowerCase().includes('code verifier')) {
    return 'This password reset link was opened without its browser verification state. Request a fresh reset link and open it in this browser.';
  }
  return message;
}

export function AuthCallbackScreen({ supabase }: { supabase: SupabaseClient }) {
  const [message, setMessage] = useState('Completing sign-in…');
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
          const { error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
        }

        if (!active) return;
        setMessage('Session ready. Opening password page…');
        window.history.replaceState({}, document.title, '/auth/set-password');
        window.setTimeout(() => window.location.assign('/auth/set-password'), 350);
      } catch (err) {
        if (!active) return;
        const raw = err instanceof Error ? err.message : String(err);
        setError(friendlyAuthError(raw));
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
            <div className="login-brand-subtitle">AUTH</div>
          </div>
        </div>
        <h1>{error ? 'Sign-in link failed' : message}</h1>
        {error ? <div className="error-message">{error}</div> : null}
      </section>
    </main>
  );
}
