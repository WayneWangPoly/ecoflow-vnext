# EcoFlow Architecture

One-page orientation for anyone (human or AI) continuing this codebase.
Historical feature write-ups live in `docs/archive/`.

## Surfaces and roles

| Surface | Roles | Entry |
|---|---|---|
| Desktop office | OWNER, ADMIN, ACCOUNT, VIEWER | `src/app/App.tsx` → `DesktopWorkspace` |
| Driver mobile | DRIVER (Owner/Admin via `?workspace=driver`) | `src/app/DriverApp.tsx` (lazy chunk) |
| Warehouse mobile | WAREHOUSE (Owner/Admin via `?workspace=warehouse`) | `WarehouseWorkspace` in App.tsx |
| Warehouse Map | OWNER, ADMIN, WAREHOUSE (route-guarded feature, not a role) | `/warehouse-map` → `WarehouseMapRoute` (lazy) |

Roles come from `v_ecoflow_current_user` (Supabase auth). The legacy passcode
login is **development-only**: it is compiled out of production bundles
(`import.meta.env.DEV` gate in App.tsx) and production without Supabase env
renders a hard lock screen (`ProductionConfigurationError` in main.tsx).

## Two-layer UI

1. **Core React app** (`src/app/*`): login, shells, order inbox, pick board,
   driver run, run/route approval.
2. **Enhancer layer** (`src/*.tsx` + `src/enhancers/*`): feature modules that
   locate DOM anchors and portal themselves in. They are grouped into lazy
   bundles loaded per surface by `SurfaceModuleGate` (main.tsx):
   Owner / Account / Driver / WarehouseOps / WarehouseMapRoute.
   `FieldModeEnhancer` serves every surface and lazy-loads separately.

Rules for new enhancers:
- Register DOM observation through `observeBody` (`src/lib/domObserver.ts`) —
  one shared MutationObserver with a 150ms batch. Never create your own
  body-wide observer.
- Put the component into the correct group file in `src/enhancers/`.
- Read structured state (data attributes, row classes), never operator copy.

## Shared operational state (the day state)

`DriverDayState` (`src/domain/driverRun.ts`) is the single shared fact set:
released orders, stop progress, pick state, shift events, run code. It syncs
through the `ecoflow_day_state` table via `usePickSync` (4s poll, per-scope
last-write-wins, tombstones for un-release/unstage/unlock).

- Multi-run: scopes are prefixed `run:<CODE>:`; `run-control` holds the active
  run; `shift` is shared across runs.
- RLS write matrix (`20260711181000_operational_state_auth_hardening.sql`):
  OWNER/ADMIN everything; ACCOUNT `release/meta/run-control`;
  WAREHOUSE+DRIVER `task/alloc/stage/prep`; DRIVER `stop/route/shift`.
- 401/403 pushes surface as the `denied` sync status and do not hot-retry the
  same changeset (see `usePickSync`).
- POD photos: uploaded to the private `pod-photos` bucket, then the base64 is
  dropped from day state (localStorage quota protection). Old day-scoped keys
  are pruned on startup (`pruneEcoflowStorage`).

## Data flow (happy path)

Ordermentum sync (edge fn / scripts) → raw tables → views (`v_ecoflow_*`) →
office inbox → internalise RPC → release to run (day state) → office approves
& locks route (box letters freeze) → warehouse bulk pick (barcode-gated, live
ledger deduction, task claims) → sort → stage → driver departure declaration →
route (GPS samples) → POD 1+2 → delivery notification email (photos inline) →
returns loop (RET code + zone QR + geofence + next-shift inspection) →
statements (PDF generation + dispatch).

## Edge functions

| Function | Purpose | Auth |
|---|---|---|
| `trigger-ordermentum-sync` | pull Ordermentum data | Owner/Admin |
| `notify-route-start` | one "delivery today" email per store | Driver/Owner/Admin + departure ack required |
| `delivery-notification-dispatch` | delivery email with inline+attached POD photos | service (queue-driven) |
| `statement-dispatch` | generate statement PDF, email with attachment | Owner/Admin/Account |
| `storage-retention` | delete pod-photos older than 90 days | Owner/Admin, dry-run default |

All recipient addresses are resolved server-side; the browser can never pick
arbitrary recipients.
