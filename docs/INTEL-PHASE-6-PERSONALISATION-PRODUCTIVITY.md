# Phase 6 — Personalisation & Productivity

## Completion statement

Phase 6 completes all four roadmap packages:

1. INTEL-PER-001 — Saved Views
2. INTEL-PER-002 — Quick Actions
3. INTEL-PER-003 — Comparison Tray
4. INTEL-PER-004 — Export

## Saved Views

Saved Views are durable server-side records rather than browser-local preferences. A private view belongs to one user. A role default belongs to one desktop role and workspace, and only active Owner or Admin users may set or clear it.

Each Saved View can retain:

- filters;
- sort order;
- visible columns;
- date range;
- comparison settings;
- search term.

Users can create, duplicate, rename and delete their private views. The RPC boundary prevents one user from reading or changing another user's private views. Browser roles have no direct table privileges.

## Quick Actions

The Analytics productivity workspace provides canonical shortcuts for Control Room, Orders, Inventory, Customers, Delivery, Returns and Analytics. The command palette is available from `Ctrl+K` or `Command+K` and remains navigation-only.

## Comparison Tray

The Comparison Tray accepts governed Product, Customer, Store, Order, Delivery Run and Metric identities. It is limited to four items, rejects duplicates, preserves permission state and identifies aligned, partially aligned or incompatible dimensions. Missing comparison values remain unavailable rather than becoming numeric zero.

## Export

Export supports:

- the current table view;
- selected records;
- the current chart dataset.

The initial format is CSV. Exports are limited to 5,000 rows, 50 columns and 4,000 characters per cell. Spreadsheet formula prefixes are neutralised. XLSX is intentionally not included because the current requirement does not justify another dependency or a wider data surface.

## Security and operational boundary

Phase 6 does not mutate orders, inventory, customers, routes, returns or exception state. Saved View writes are limited to the dedicated personalisation table and pass through security-definer RPCs with active desktop-role checks. Quick Actions navigate, the Comparison Tray compares already-authorised entities, and Export only serialises rows already present in the current authorised surface.

## Permanent verification

`INTEL-GATE-006` verifies:

- all four roadmap packages;
- private and role-default Saved View isolation;
- RPC-only browser access;
- the six comparison entity kinds and four-item limit;
- canonical Quick Actions and command palette;
- bounded CSV export and formula protection;
- responsive and reduced-motion presentation;
- TypeScript, Vite and PostgreSQL contract coverage;
- absence of localStorage, sessionStorage, IndexedDB and XLSX dependencies.
