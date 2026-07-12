# EcoFlow shared day state (multi-device operational facts)

Driver, Warehouse and Office share one operational fact source through Supabase:
release-to-run, route lock, pick progress, staging, delivery status, POD and shift
events sync across devices within ~4 seconds. The office Delivery board reads the
same rows the driver writes.

## Apply

1. Run `supabase/migrations/20260705_ecoflow_pick_state_sync.sql` in the Supabase SQL Editor.
   It creates `public.ecoflow_day_state`, the `pod-photos` Storage bucket + policies,
   and grants the app access to the `ecoflow_internalise_ordermentum_orders` RPC.

2. Give the front end its Supabase keys (if not already set). Create `.env.local`:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```

The anon public key is in Supabase Dashboard → Settings → API → `anon` `public`.
Never put the service role key in a VITE_ variable — it would ship inside the browser bundle.

3. `npm run dev` (or redeploy). The pick board header shows the sync state:
   `Live sync` / `Connecting…` / `Sync error` / `Local only`.

## Scopes in ecoflow_day_state

| scope | payload | written by |
|---|---|---|
| `release:<orderId>` | `{ releasedAt }` | office (Release to run) |
| `meta` | `{ lockedAt, stopOrder, boxCodes }` | driver (route lock; lockedAt null = unlock) |
| `task:<sku>` | PickTaskState | picker |
| `alloc:<sku>\|<orderId>` | `{ done }` | picker (sort phase) |
| `stage:<orderId>` | `{ stagedAt }` | picker (seal & stage) |
| `stop:<orderId>` | StopProgress (POD as Storage paths) | driver |
| `route` | `{ startedAt, endedAt }` | driver |
| `shift` | `{ events: [...] }` | driver |

- `updated_at` is set by a DB trigger — device clock skew never corrupts ordering.
- POD photos/signatures upload to the `pod-photos` bucket; only paths travel in scope rows;
  the local data-URL stays as an offline cache on the capturing device.
- The formal internal-order creation goes through the `ecoflow_internalise_ordermentum_orders`
  RPC (the "Internalise eligible" button) — the front end never flips release state itself.

## Known limits (next batch)

- Push has no retry queue yet: if a push fails mid-outage, the change stays local until the
  next action re-diffs it. An outbox queue is planned.
- Simultaneous route locks are last-write-wins; a lock guard is planned.
- `updated_by` carries the signed-in name/email when Supabase Auth is enabled, otherwise a role label.
