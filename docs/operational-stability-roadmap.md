# EcoFlow Operational Stability Roadmap

## Product rule

EcoFlow is an operational system, not a dashboard collection. Every order, stock balance, location, role, sync and exception must have one server-authoritative state. Browser storage may cache data for resilience, but it must never become the final business record.

## Engineering rule

New operational features must be owned by normal React routes/components and typed repositories. DOM observers, portals that replace native panels, text repair and CSS overrides are migration bridges only. No new business workflow may be implemented as a DOM enhancer.

---

## Phase 1 — P0 trust and continuity

### Live-data trust

- Production starts from an empty structural dataset, never sample orders, stores, stock or KPIs.
- Required current-lifecycle views fail the snapshot visibly instead of converting database errors into zero counts.
- Supporting master-data failures are reported as degraded sources without erasing trusted active orders.
- The last successful snapshot remains visible when a refresh fails.

### Authentication continuity

- A transient access-profile read failure must not destroy a valid Supabase session.
- A verified profile may be retained in session storage only after matching it to the active Supabase user ID.
- Users with an active session but no readable profile see a recovery screen with Retry and Logout, not the sign-in form.

### Durable sync jobs

- Each Owner/Admin sync request creates one job ID.
- Duplicate jobs of the same mode are rejected while one is queued or running.
- Settings displays queued/running/completed/failed state, stage, requester and error.
- GitHub Actions updates the same job row from start through completion.

### Exit criteria

- No production surface displays demo entities after a failed read.
- Refreshing during a Supabase profile-view interruption does not sign a user out.
- A sync button cannot create duplicate concurrent jobs.
- Core source failure produces a clear unavailable state; supporting-source failure produces a health notice.

---

## Phase 2 — P0 native workspace migration

Migrate in this order:

1. Dashboard
2. Stores and Price Matrix
3. Inventory
4. Warehouse Map
5. Ordermentum Inbox and Exception Control

For each workspace:

- Move ownership into an explicit React page component.
- Remove the corresponding DOM observer, portal replacement and CSS hide rule.
- Put role/capability checks in typed application state, not sidebar text or localStorage.
- Store filter, sort, tab and page state in the URL.
- Use server pagination for large lists.
- Add loading, empty, degraded and unavailable states.

### Exit criteria

- Changing brand text cannot change permissions or disable modules.
- No native panel flashes before an enhancer mounts.
- Browser back/forward and copied URLs restore the same workspace view.

---

## Phase 3 — P1 warehouse operating model

### Initial Stocktake

A location-first guided workflow:

1. Select/scan rack and location.
2. Scan SKU.
3. Scan carton/sleeve/each barcodes.
4. Confirm pack conversion.
5. Count physical quantity.
6. Add additional SKU slots in the same physical cell when needed.
7. Review unknown/duplicate barcode and count exceptions.
8. Supervisor approves opening balances as one auditable batch.

Scanning creates observations first. Stock changes only after batch approval writes the ledger.

### Move SKU

- Source location
- SKU
- Quantity or Move all
- Destination location
- Reason
- Confirmation

The transaction writes linked negative/positive location legs under one transfer reference. Edit Layout never renames or relocates stock.

### Cycle count

- Count assignment by rack/location
- Blind count option
- Variance review
- Supervisor approval
- Adjustment ledger reference

### Exit criteria

- Warehouse Map location hints and Pick instructions use the same live location balance.
- Every quantity change has an actor, reason, reference and timestamp.
- A location cannot be changed by editing display text.

---

## Phase 4 — P1 control-room workflow

### Actionable exceptions

Each exception receives:

- severity
- age
- owner/team
- business impact
- recommended action
- due time/SLA
- resolution code
- notes and audit history
- optional snooze with expiry

System health, sync outcome, data quality, release blockers and commercial alerts remain separate categories.

### Business Day Close

- Verify Ordermentum cutoff/sync
- Release queue cleared or handed over
- Pick/staging complete or carried over
- Route/POD state reconciled
- Exceptions assigned
- Accounts variances acknowledged
- Close day and create explicit carry-over records

### Exit criteria

- No item remains indefinitely “open” without ownership or age.
- The dashboard summary links to the exact actionable queue.

---

## Phase 5 — P2 personalisation and efficiency

### Compact identity card

- Initial/avatar
- display name
- role label
- active state

### Quick Actions

- User chooses up to four shortcuts in Settings.
- Defaults are role-based.
- Preferences are stored against the authenticated user.
- Quick Actions are navigation only; they never bypass permissions or workflow gates.

### Saved views

- User-defined filters for Stores, Orders, Inventory and Exceptions.
- URL state remains shareable and auditable.

---

## Release discipline

- Use one feature branch and one reviewed production deployment per stability release.
- Batch related file changes to avoid unnecessary Vercel Preview builds.
- Database migrations must pass production-schema shadow verification.
- Production deployment requires TypeScript, Vite, warehouse transaction, picking concurrency and commercial-control checks.
- No migration may delete historical Ordermentum, ledger, POD or audit records without a separately approved retention plan.
