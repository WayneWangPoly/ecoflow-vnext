# Phase 6 — Personalisation & Productivity

## Production status

The original Phase 6 roadmap defined four packages:

1. INTEL-PER-001 — Saved Views — active
2. INTEL-PER-002 — Quick Actions — active
3. INTEL-PER-003 — Comparison Tray — restored by TRANSFORM-008B on governed server candidates
4. INTEL-PER-004 — Export — production presentation withdrawn by TRANSFORM-008A and remains gated for TRANSFORM-008C

A roadmap package is not treated as production-complete merely because a historical browser implementation existed.

## Saved Views

Saved Views are durable server-side records rather than browser-local preferences. A private view belongs to one user. A role default belongs to one desktop role and workspace, and only active Owner or Admin users may set or clear it.

Each Saved View can retain filters, sort order, visible columns, date range, comparison settings and search term. Users can create, duplicate, rename and delete their private views. The RPC boundary prevents one user from reading or changing another user's private views. Browser roles have no direct table privileges.

## Quick Actions

The Analytics productivity workspace provides canonical shortcuts for Control Room, Orders, Inventory, Customers, Delivery, Returns and Analytics. The command palette is available from `Ctrl+K` or `Command+K` and remains navigation-only.

## Comparison Tray

Comparison discovery is server-authoritative through `public.ecoflow_read_comparison_candidates_v1`; the browser cannot type arbitrary entity IDs or manufacture permission.

The canonical comparison kinds are:

- Customer — maximum 2;
- Commercial SKU — maximum 2;
- Physical SKU — maximum 6;
- Delivery Run — maximum 2.

Commercial and Physical SKU identity remain separate. Commercial candidates require an ACTIVE published Family Link to an ACTIVE SKU Family. Physical candidates require ACTIVE Physical SKU and Family identity. Delivery Run candidates are LOCKED server route snapshots. Duplicate candidates are rejected and the tray remains bounded.

## Export

The historical client-side CSV helper remains only as a dormant safety contract. Production buttons for current table, selected records and chart dataset are not active because browser-local rows are not sufficient evidence of an authoritative export dataset.

Authoritative export is the next work package, TRANSFORM-008C. XLSX is not introduced by 008B.

## Security and operational boundary

Phase 6 personalisation does not mutate orders, inventory, customers, routes, returns or exception state. Saved View writes are limited to the dedicated personalisation authority. Quick Actions navigate. Comparison performs read-only discovery through a fail-closed RPC. Export remains quarantined until its server authority is implemented.

## Permanent verification

`INTEL-GATE-006`, TRANSFORM-008A and TRANSFORM-008B gates verify:

- private and role-default Saved View isolation;
- RPC-only Saved View and Comparison browser access;
- four canonical Comparison kinds and per-kind limits;
- Product Identity ACTIVE/READY eligibility;
- LOCKED Delivery Run eligibility;
- absence of arbitrary Comparison entity IDs and browser-declared permission;
- canonical Quick Actions and command palette;
- continued absence of production current-data export UI;
- responsive and reduced-motion presentation;
- TypeScript, Vite and PostgreSQL/shadow coverage;
- absence of localStorage, sessionStorage, IndexedDB and XLSX dependencies.
