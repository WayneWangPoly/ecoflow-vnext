# EcoFlow Supabase Ordermentum Views Patch

This patch connects the front end to the Supabase read views:

- `v_ecoflow_ordermentum_inbox`
- `v_ecoflow_ordermentum_exceptions`
- `v_ecoflow_ordermentum_sync_health`

It keeps the local sample snapshot as a fallback. If `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing, or if the views are not readable, the UI still opens using the local data.

## Files

- `src/app/App.tsx`
- `src/data/repositories/supabaseOrdermentumViews.ts`

## Required Vercel environment variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Local build checked

`npm run build` passed in the patch workspace.
