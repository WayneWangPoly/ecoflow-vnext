import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  bindOperationalSessionUser,
  clearOperationalSession,
} from '@/operational/operationalActionJournal';

/**
 * Prevents work tabs and Recent actions from crossing authenticated user
 * boundaries inside the same browser tab. Token refresh for the same user does
 * not clear the session; a different user ID does.
 */
export function OperationalSessionIdentityBinder() {
  useEffect(() => {
    if (!supabase) return;
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const userId = data.session?.user.id;
      if (userId) bindOperationalSessionUser(userId);
      else clearOperationalSession();
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user.id;
      if (userId) bindOperationalSessionUser(userId);
      else clearOperationalSession();
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return null;
}
