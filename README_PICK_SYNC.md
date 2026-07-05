# EcoFlow Pick State Sync (multi-device picking progress)

Driver and Warehouse devices share the same pick board state through Supabase:
route lock, bulk task progress, sort allocations and staged stops sync within ~4 seconds.

## Apply

1. Run `supabase/migrations/20260705_ecoflow_pick_state_sync.sql` in the Supabase SQL Editor.

2. Give the front end its Supabase keys (if not already set). Create `.env.local` in the project root:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```

The anon public key is in Supabase Dashboard → Settings → API → `anon` `public`.
Never put the service role key in a VITE_ variable — it would ship inside the browser bundle.

3. `npm run dev` (or redeploy). The pick board header shows the sync state:
   - `Live sync` — connected, polling every 4 s
   - `Connecting…` — first fetch in flight
   - `Sync error` — table missing or network problem (the app keeps working locally)
   - `Local only` — no Supabase keys configured

## How it works

- One row per `(business_day, scope)` in `public.ecoflow_pick_state`; each pick action
  upserts only its own scope row, so two devices working different SKUs never conflict.
- Devices poll rows with `updated_at` greater than their cursor and merge them in;
  `updated_at` is set by a database trigger, so device clock skew doesn't matter.
- Locking the route on the driver phone makes the pick plan appear on the warehouse
  device on the next poll; unlocking propagates the same way (meta row with `lockedAt: null`).
- Driver-personal state (shift clock, POD, delivery progress) intentionally stays local.
