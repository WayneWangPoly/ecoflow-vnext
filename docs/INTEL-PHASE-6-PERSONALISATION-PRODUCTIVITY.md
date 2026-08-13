# Phase 6 — Personalisation & Productivity

## Production status

The Phase 6 roadmap defines four packages:

1. INTEL-PER-001 — Saved Views — active
2. INTEL-PER-002 — Quick Actions — active
3. INTEL-PER-003 — Comparison Tray — restored by TRANSFORM-008B on governed server candidates
4. INTEL-PER-004 — Authoritative Export — restored by TRANSFORM-008C through server re-resolution

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

## Authoritative Export

TRANSFORM-008C restores CSV export through `public.ecoflow_read_authoritative_export_v1`. The browser may describe a governed request, but browser row objects, cached labels and client-authored permissions are never export authority.

Three export modes are supported:

- **Current governed table** — sends the current Comparison candidate kind/query and the server re-runs `ecoflow_read_comparison_candidates_v1` at export time.
- **Selected governed records** — sends only stable `{kind, entity_id}` selectors. The server re-resolves each selector against current Product Identity, Customer Store or LOCKED Delivery Run authority and fails closed if a selector is stale or no longer eligible.
- **Governed chart dataset** — sends only `fill_rate` or `substitution_rate` plus a bounded date range. The server re-runs `analytics.get_initial_kpi_shadow_projection`; its existing Owner/Admin shadow-access boundary is preserved.

Export is read-only. Generic governed exports retain the existing OWNER/ADMIN/ACCOUNT/VIEWER read envelope, while shadow-metric export remains Owner/Admin only. Table results are bounded to the governed candidate reader, selected records to the Comparison Tray maximum, and chart output to 5,000 rows and 366 days.

CSV columns and row order are server-defined. The browser serializer validates one consistent export envelope, limits cells to 4,000 characters, prefixes spreadsheet formula-leading cells, and sanitizes the filename. XLSX dependencies are not introduced.

## Security and operational boundary

Phase 6 personalisation does not mutate orders, inventory, customers, routes, returns or exception state. Saved View writes are limited to the dedicated personalisation authority. Quick Actions navigate. Comparison and Export perform read-only work through fail-closed RPCs. Export does not accept arbitrary SQL identifiers or browser-provided row datasets.

## Permanent verification

`INTEL-GATE-006`, TRANSFORM-008A, TRANSFORM-008B and TRANSFORM-008C gates verify:

- private and role-default Saved View isolation;
- RPC-only Saved View, Comparison and Export browser access;
- four canonical Comparison kinds and per-kind limits;
- Product Identity ACTIVE/READY eligibility;
- LOCKED Delivery Run eligibility;
- absence of arbitrary Comparison entity IDs and browser-declared permission;
- server re-query for current-table export;
- server re-resolution of selected stable selectors;
- governed shadow-metric re-run for chart export with Owner/Admin restriction;
- deterministic export columns/order plus row, date, cell and filename hardening;
- canonical Quick Actions and command palette;
- responsive and reduced-motion presentation;
- TypeScript, Vite and PostgreSQL/shadow coverage;
- absence of localStorage, sessionStorage, IndexedDB and XLSX dependencies.
