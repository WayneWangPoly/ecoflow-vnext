# TRANSFORM-008C — Authoritative Export

## Purpose

Restore production CSV export without restoring browser-local data as authority.

## Authority contract

The browser may submit only a bounded governed descriptor. `public.ecoflow_read_authoritative_export_v1` re-resolves all rows on the server at export time.

### Current table view

- Dataset: `COMPARISON_CANDIDATES` only.
- Kind: Customer, Commercial SKU, Physical SKU or Delivery Run only.
- Query: at most 120 characters.
- The export RPC re-runs `public.ecoflow_read_comparison_candidates_v1`.
- The existing comparison candidate cap remains 100 rows.

### Selected records

- Dataset: `COMPARISON_SELECTION` only.
- Browser input is only stable `{kind, entity_id}` selectors.
- Selector count is 1–8 and duplicates are rejected.
- Commercial SKU requires a current ACTIVE Family Link and ACTIVE Family.
- Physical SKU requires current ACTIVE Physical SKU and ACTIVE Family identity.
- Customer is re-read from `ecoflow_store_sites`.
- Delivery Run requires a current LOCKED server route snapshot.
- Any stale/missing/no-longer-eligible selector fails the whole request closed.

### Chart dataset

- Dataset: `INITIAL_KPI_SHADOW` only.
- Metrics: `fill_rate` and `substitution_rate` only.
- Date range: at most 366 days.
- Rows: at most 5,000.
- Server source: `analytics.get_initial_kpi_shadow_projection`.
- Existing Owner/Admin shadow access is preserved; it is not broadened for export.

## Security properties

- authenticated user required at execution time;
- generic read envelope: OWNER/ADMIN/ACCOUNT/VIEWER;
- chart shadow output: OWNER/ADMIN only;
- SECURITY DEFINER with explicit `pg_catalog,public,analytics` search path;
- public/anon/authenticated execute is revoked before authenticated execute is granted;
- no operational DML;
- no arbitrary SQL identifiers, table names, row arrays or browser-authored permissions;
- no cache fallback used as export authority.

## CSV safety

The RPC returns deterministic column definitions, filename base, generated timestamp, row indexes and server-resolved JSON rows. The repository validates one consistent envelope before serialization. Rows are ordered by server indexes, cells are limited to 4,000 characters, spreadsheet formula-leading text is prefixed with an apostrophe, and filenames are sanitized. No XLSX package is introduced.

## Release proof

008C is complete only after:

1. contract and static authority audits pass;
2. TypeScript and production Vite build pass;
3. exact-head pull-request CI passes;
4. required `Supabase shadow gate (required)` passes on the exact PR head;
5. the PR merges through the protected `main` ruleset;
6. post-main database shadow and production migration deployment pass;
7. post-main application/frontend-database consistency checks pass.
