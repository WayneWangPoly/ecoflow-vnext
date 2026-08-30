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

1. **Discovery** — Unleashed remains business authority. WAYNX observes normal
   authenticated behaviour and documents workflows; it does not copy Unleashed
   source code or branding.
2. **Shadow import** — Unleashed remains authority for imported ERP/inventory
   facts. WAYNX stores bounded provenance-tagged copies for migration and
   reconciliation. Existing EcoFlow warehouse/delivery capabilities continue
   under explicit ownership rules.
3. **Reconciled opening balance** — a declared `as_at` Unleashed stock snapshot
   becomes a candidate WAYNX opening-balance batch. It is not authoritative
   until reconciliation and cutover gates pass.
4. **Cutover** — direct Ordermentum becomes the upstream commercial-order source
   and WAYNX becomes inventory/warehouse/delivery operational authority.
   Unleashed runtime reads are disabled.

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
- Prefer specific-ID, `modifiedSince`, webhook/event and bounded-window sync over
  recurring full scans.
- Large backfills are explicit/manual and subject to database-headroom checks.
- Raw payload retention is bounded; structured operational fields and provenance
  are retained without permanent duplicate JSON when unnecessary.
- After cutover, direct Ordermentum integration targets
  `https://api.ordermentum.com` with server-side `x-api-key` authentication;
  deprecated username/password authentication is not the target design.

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
- open Purchase Orders where required;
- per-mapped-SKU/warehouse inventory parity at a declared boundary;
- allocated/reserved/available semantic reconciliation;
- permissions/RLS;
- retry, idempotency and conflict behaviour;
- real warehouse golden path;
- delivery/Driver/POD/notification golden path;
- Owner and Warehouse field acceptance.

Unexplained variance is blocking. It is not resolved by copying whichever system
has the latest number.

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

## Migration plan

1. Map actual Unleashed workflows and classify P0/P1/P2/P3 requirements.
2. Build a bounded read-only Unleashed snapshot connector.
3. Import master data, external IDs and owned product-image copies.
4. Define and verify the opening-balance inventory contract.
5. Deliver Unleashed-familiar native React office surfaces for required flows.
6. Run shadow reconciliation and field acceptance until cutover gates pass.
7. Switch upstream order authority to direct Ordermentum and disable Unleashed
   runtime dependencies.
8. Perform post-cutover reconciliation and retire temporary migration credentials
   and probes through the governed release process.
