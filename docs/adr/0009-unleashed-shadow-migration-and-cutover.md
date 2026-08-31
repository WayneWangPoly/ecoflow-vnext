# ADR-0009: Unleashed shadow migration and cutover authority

- Status: Accepted
- Date: 2026-08-30
- Owners: Chief Engineer, Domain, Platform/Data

## Context

EcoFlow already has a functioning Ordermentum ingestion path, canonical Product
Identity boundaries, warehouse execution, delivery, Driver, POD, notifications,
returns and statement flows. Unleashed currently provides familiar ERP and
inventory workflows for the business, while the target is to remove the runtime
and subscription dependency after EcoFlow/WAYNX can prove equivalent operational
coverage.

The migration must minimise retraining for Owner and Warehouse users, avoid
manual re-entry of products, images and stock, preserve auditability, and avoid
creating simultaneous inventory authorities across Unleashed, Ordermentum and
WAYNX.

## Decision

### Authority phases

1. **Discovery** — no system changes authority. WAYNX observes normal
   authenticated behaviour and documents workflows; it does not copy Unleashed
   source code or branding.
2. **Shadow import** — incumbent systems remain authoritative according to the
   matrix below. WAYNX stores bounded provenance-tagged copies for migration and
   reconciliation. Existing EcoFlow warehouse/delivery capabilities continue
   under their accepted ownership rules.
3. **Reconciled opening balance** — a declared `as_at` Unleashed stock snapshot
   becomes a candidate WAYNX opening-balance batch. It is not authoritative
   until reconciliation and cutover gates pass.
4. **Cutover** — Ordermentum remains upstream commercial authority and WAYNX
   becomes its direct operational consumer plus the inventory, purchasing,
   warehouse and delivery authority declared below. Unleashed runtime reads are
   disabled only after the transactional fence and all P0 gates pass.

### Authority matrix

Importing or displaying a record never transfers authority. If a prerequisite
in this matrix is incomplete, the incumbent writer remains authoritative and
WAYNX stays read-only for that domain.

| Domain | Discovery | Shadow import | After fenced cutover |
|---|---|---|---|
| Customer/store master, commercial product catalogue and customer pricing | Ordermentum is upstream commercial authority; Unleashed may hold a downstream ERP copy | Ordermentum remains upstream; WAYNX stores mapped read models and exceptions | Ordermentum remains upstream; WAYNX consumes it directly and may add only separately governed operational fields |
| Customer Sales Orders, invoices and payments | Ordermentum is upstream transaction authority; Unleashed remains the incumbent ERP work surface where used | Ordermentum facts remain authoritative; Unleashed and WAYNX are reconciled consumers | Ordermentum remains upstream; WAYNX becomes the direct operational processor. WAYNX does not originate invoices or payments without a later accepted contract |
| Supplier master, Purchase Orders, receiving, costing and supplier returns | Unleashed is the incumbent business writer for the Owner-used purchasing workflow | Unleashed remains the sole authority; any existing WAYNX purchasing surface is non-authoritative until a bounded domain contract and field acceptance pass | WAYNX becomes authority only after supplier/PO migration, in-flight transaction drain, receiving/costing/return command tests and Owner acceptance pass |
| Physical SKU, package, barcode and warehouse-location identity | Existing EcoFlow Product Identity and warehouse-location contracts remain authoritative; Unleashed identities are external evidence | Same; mappings are explicit and ambiguous rows are quarantined | WAYNX remains authority; imported external IDs remain provenance only |
| On-hand, allocated/reserved, available and on-purchase quantities | Unleashed is inventory authority | Unleashed remains authority; WAYNX opening balances are candidates only | WAYNX ledger becomes sole authority at the activated authority epoch; Unleashed writes and runtime reads are fenced off |
| Product images and other assets | Source ownership/licence controls use | Only rights-cleared assets may be copied into EcoFlow-controlled storage | EcoFlow-controlled copies serve production; Unleashed URLs are not runtime dependencies |
| Paid Sales Intelligence, targets and notifications | The Owner-used Unleashed add-on is presentation/decision authority; source transactions retain the authorities above | Unleashed definitions and values are reconciled against versioned WAYNX semantic metrics | WAYNX analytics becomes decision-support authority only after #345 KPI, filter, drill, target and notification parity is field-accepted |
| Picking, route approval, Driver, POD, notifications, returns and statements | Existing WAYNX contracts remain operational authority | Existing WAYNX contracts remain operational authority | Existing WAYNX contracts remain operational authority |

No row in this matrix authorises a second writer. A future change to an authority
assignment requires a superseding ADR or the domain-specific contract named by
this ADR.

### Identity

- Ordermentum product/variant identity is a **commercial ordering identity**.
- Unleashed Product GUID/code is an **external source identity** retained for
  migration and historical provenance.
- EcoFlow Product Identity, SKU Family, Physical SKU, package and barcode
  binding remain the **physical warehouse identity**.
- Relationships are explicit mappings. Name/image similarity may support review
  but never silently creates authority.

### Inventory

- All authoritative inventory quantity changes are server-side commands that
  produce inventory movements.
- Imported Unleashed stock becomes a dated opening-balance movement/batch, not
  a periodically overwritten scalar balance.
- On-hand, allocated/reserved, available and on-purchase remain distinct
  semantics and are reconciled explicitly.
- No critical inventory fact has two authoritative writers after cutover.
- Historical movements are never edited to force equality; corrections use
  compensating movements.

### Master data and assets

- Existing product/customer/supplier/warehouse data is migrated where available
  instead of manually re-entered.
- Product images required after cutover are copied into EcoFlow-controlled
  storage with source provenance and checksums.
- Production UI must not depend on Unleashed-hosted image URLs after cutover.

### Pre-ingestion authorisation, privacy and asset rights

Before any bulk snapshot, export, image copy or PII backfill:

- the Unleashed account owner records authorisation for the migration and the
  intended data classes;
- the team confirms that API/export use is permitted by the applicable account
  agreement and access rights;
- customer, supplier and contact fields are classified, minimised and assigned
  an approved retention/access policy before ingestion;
- product-image ownership or licence is verified. Unclear third-party images are
  quarantined rather than copied or served; and
- evidence excludes credentials, unnecessary personal data, bundled source code
  and protected visual assets.

The bounded four-record connector acceptance is technical connection evidence;
it does not authorise a bulk backfill or image migration.

### UI and user habits

- WAYNX may preserve generic workflow names, field order, table columns,
  navigation order, filters and interaction habits when doing so materially
  reduces retraining.
- The goal is continuity of **muscle memory**, not pixel-identical imitation.
- Do not copy Unleashed source code, branding, logos or protected visual assets.
- New surfaces use native React routes/components and typed repositories. No new
  DOM enhancer, body observer, portal replacement or CSS hide-and-replace layer
  is permitted.

### Integration and sync

- The migration-phase Unleashed connector is read-only unless a later ADR
  explicitly authorises writes.
- Credentials are server-side secrets. Secrets and access tokens must not be
  placed in URL query strings, browser code, Git history or screenshots.
- Unleashed credentials may be sent only to the exact
  `https://api.unleashedsoftware.com:443` origin. Unexpected schemes, hosts,
  ports, base paths, query strings and fragments fail closed. Redirects are not
  followed with credentials; any cross-origin redirect is a hard failure.
- Prefer specific-ID, `modifiedSince`, webhook/event and bounded-window sync over
  recurring full scans.
- Large backfills are explicit/manual and subject to database-headroom checks.
- Before a bulk/backfill run, raw staging declares per-resource row/byte limits,
  expiry, purge evidence and the structured fields that survive expiry. The run
  fails closed when the approved database-headroom threshold would be crossed.

### Ordermentum authentication prerequisite

Migration of every production Ordermentum workflow to
`https://api.ordermentum.com` with server-side `x-api-key` authentication is an
independent prerequisite, not a post-Unleashed task. The legacy username/password
`/v1/auth` path and automatic fallback must be removed after shadow comparison,
before Unleashed cutover and before Ordermentum begins deprecating the older
method on 1 January 2027, whichever is earlier. Authentication migration must
prove scheduled, targeted and manual refresh paths against the same canonical
ingestion contracts without expanding polling.

### Existing operational core

The existing Picking, warehouse execution, route approval, Driver, POD,
notifications, returns and statement pipeline is retained. It may be changed
only through separately approved bounded work packages with regression evidence.

### Cutover gate

Unleashed may be disconnected only after the reconciliation gate reports PASS
for all P0 domains, including:

- product/external identity mapping;
- product image ownership;
- customer/store mapping;
- open Sales Orders;
- supplier mapping plus the Owner-used Purchase Order, receiving, costing and
  supplier-return workflows;
- all open Purchase Orders and in-flight receipts/returns deterministically
  owned on one side of the boundary;
- per-mapped-SKU/warehouse inventory parity at a declared boundary;
- allocated/reserved/available semantic reconciliation;
- every Owner-used P0 paid Sales Intelligence KPI, date basis, filter, drill,
  target and notification workflow from #345;
- production Ordermentum `x-api-key` authentication with no legacy fallback;
- permissions/RLS;
- retry, idempotency and conflict behaviour;
- real warehouse golden path;
- delivery/Driver/POD/notification golden path;
- Owner and Warehouse field acceptance.

Unexplained variance is blocking. It is not resolved by copying whichever system
has the latest number.

### Transactional cutover fence and reversal

Cutover is a controlled authority-epoch change, not a deployment timestamp:

1. Declare a cutover batch, `as_at` time and authority epoch. Announce and
   enforce a write freeze in Unleashed for every transferring domain.
2. Drain or explicitly assign every in-flight Sales Order, Purchase Order,
   receipt, return, stock adjustment and warehouse transfer to exactly one side
   of the boundary using stable external IDs.
3. Capture the final bounded delta through the fence time, preserve hashes and
   high-watermarks, and rerun per-record plus aggregate reconciliation.
4. Abort before activation if a source is stale/unavailable, an in-flight item
   is unassigned, a P0 variance is unexplained, or any role, retry, idempotency,
   warehouse, purchasing, delivery or analytics gate fails.
5. Activate the new authority epoch server-side. Commands with the wrong epoch
   or a pre-fence revision are rejected; Unleashed writes and runtime reads for
   transferred domains are disabled before WAYNX accepts new authoritative
   commands.
6. Run the purchasing, inventory, warehouse, delivery and analytics golden paths
   and a post-cutover reconciliation for the next complete business cycle.

Before activation, aborting returns to the unchanged incumbent authorities. An
abort after WAYNX has accepted authoritative commands must freeze further writes,
preserve every accepted movement, and reconcile or compensate those movements
into the selected authority under a recorded recovery decision. It must never
silently re-enable Unleashed as a concurrent writer, edit ledger history or
overwrite balances to force equality.

## Alternatives considered

### Rebuild an ERP from scratch before observing Unleashed

Rejected. It repeats product-discovery work already validated by a system the
users know and increases retraining risk.

### Keep Unleashed permanently as the upstream database

Rejected as the target architecture. It preserves the subscription cost and
sync boundary that the migration is intended to remove.

### Copy Unleashed frontend/source implementation

Rejected. The business value is in validated workflows and behaviour contracts,
not in reusing bundled source or proprietary appearance.

### Treat Ordermentum SKU as the physical warehouse SKU

Rejected. This contradicts ADR-0002 and the canonical Product Identity model.

### Periodically overwrite WAYNX stock from Unleashed

Rejected. It destroys ledger auditability, makes conflicts opaque and creates
race conditions between two inventory authorities.

## Consequences

- Migration is staged and evidence-driven rather than a one-step replacement.
- Some familiar UI can ship while Unleashed is still authoritative.
- Ambiguous identity mappings deliberately fail closed and require review.
- A formal reconciliation boundary is required before inventory authority can
  move.
- Imported images and master data remain useful after Unleashed disconnect.
- Database/storage headroom remains a design constraint during backfill.
- Existing connector behaviour that does not yet meet the exact-host, redirect
  or raw-retention rules is not grandfathered; it blocks bulk/backfill and
  cutover until corrected and verified.

## Migration plan

1. Record account-owner authorisation, privacy/retention classes and asset-rights
   gates; map actual Unleashed workflows and classify P0/P1/P2/P3 requirements.
2. Migrate every Ordermentum production path to `api.ordermentum.com` plus
   `x-api-key`, verify shadow equivalence and remove the legacy auth fallback.
3. Complete the bounded read-only Unleashed connector, exact-host/redirect guard,
   disable path and raw-retention policy before bulk ingestion.
4. Import master data, external IDs and rights-cleared product-image copies.
5. Define and verify the supplier/purchasing and opening-balance inventory
   contracts.
6. Deliver Unleashed-familiar native React office surfaces for required flows,
   including Owner-used purchasing.
7. Reproduce and reconcile the paid Sales Intelligence capability in #345.
8. Run shadow reconciliation and field acceptance until every cutover gate passes.
9. Execute the freeze, drain, final-delta, reconciliation and authority-epoch
   protocol; then disable Unleashed runtime dependencies.
10. Perform post-cutover reconciliation and retire temporary migration
    credentials and probes through the governed release process.
