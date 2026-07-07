import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Email recovery/invite links are often opened from mail apps, another tab,
        // or another browser. PKCE requires the original code verifier to still be
        // in local storage, so it breaks those links with "code verifier not found".
        // This SPA only uses email/password + recovery links, so implicit keeps the
        // reset-password flow usable for warehouse/driver/owner accounts.
        flowType: 'implicit',
      },
    })
  : null;

export function hasSupabaseAuthClient() {
  return Boolean(supabaseUrl && supabaseAnonKey && supabase);
}
