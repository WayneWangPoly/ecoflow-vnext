# EcoFlow Auth callback + Settings team access

This patch connects the invite-based team management layer to the current EcoFlow UI.

## What it adds

- Supabase browser client at `src/lib/supabaseClient.ts`
- Email/password sign-in screen
- `/auth/callback` screen for Supabase invite and recovery links
- `/auth/set-password` screen for invited staff to set their own password
- Owner/Admin team invitation panel inside the existing Settings tab
- Vercel SPA rewrite so `/auth/callback` and `/auth/set-password` load the React app directly

## Required browser environment variables

Only these public values should be exposed to the browser:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Do not expose these to the browser:

```text
SUPABASE_SERVICE_ROLE_KEY
ORDERMENTUM_PASSWORD
ORDERMENTUM_BEARER_TOKEN
ADMIN_PASSWORD
```

## Supabase Auth URL settings

In Supabase Dashboard → Authentication → URL Configuration:

- Site URL: your production Vercel URL, for example `https://ecoflow-vnext.vercel.app`
- Redirect URLs:
  - `https://ecoflow-vnext.vercel.app/auth/callback`
  - `http://localhost:5173/auth/callback`

## Edge Function redirect

Set the invitation redirect URL used by `invite-team-member` to:

```text
https://ecoflow-vnext.vercel.app/auth/callback
```

For local testing:

```text
http://localhost:5173/auth/callback
```

## Install dependency

The browser auth flow and team panel use `@supabase/supabase-js`.

```powershell
npm install @supabase/supabase-js
```

## Apply files

Copy the patch files into the project, then run:

```powershell
npm install
npm run build
npm run dev
```

## Expected behaviour

If `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present, EcoFlow uses Supabase Auth:

1. User signs in with their own email/password.
2. App reads `v_ecoflow_current_user`.
3. `OWNER` and `ADMIN` map to the desktop owner shell.
4. `ACCOUNT` maps to the account desktop shell.
5. `WAREHOUSE` maps to the warehouse mobile shell.
6. `DRIVER` maps to the driver mobile shell.
7. Settings shows Team access only for OWNER/ADMIN.

If the Vite env values are absent, the old role/passcode screen remains as a local fallback only.

## Important production note

The existing Ordermentum dashboard loader still uses the older REST loader. If you later make every operational view strict-auth only, update `loadSupabaseOrdermentumViews` to send the signed-in user's access token instead of the anon key alone.
