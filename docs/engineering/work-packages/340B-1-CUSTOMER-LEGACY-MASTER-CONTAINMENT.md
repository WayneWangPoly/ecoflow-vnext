# ECOFLOW-340B-1: Customer legacy-master containment

## Objective

Remove direct browser Data API authority from the four legacy Customer master
tables without changing Customer data, incumbent governed reads, provider
traffic, inventory, Product Identity, or Customer promotion authority.

## Owner and reviewers

- Implementation role: Platform/Security.
- Verification role: independent database/security verification.
- Chief Engineer: required for the migration and merge gate.
- Dependencies: #340A complete; protected base
  `63151cd82892627f6ec60a05a4336d5f1e75243b`.
- Planned merge order: containment first; production compatibility postflight;
  Customer Wave-1 promotion only in a later `ECOFLOW-340B-2` package.

## In scope

- One forward migration for `public.customers`, `public.customer_sites`,
  `public.addresses`, and `public.external_customer_mappings`.
- PostgreSQL 17 denial, continuity, replay, and zero-row-change contracts.
- A static caller/scope contract and a dedicated exact-head workflow.

## Out of scope

- Customer/Site candidate creation or promotion, including `CUST-00000296`.
- Customer command ledgers or a Customer Wave-1 mutation RPC.
- UI redesign, provider traffic, deployment, merge, inventory/#339, Product
  Identity/#338, SKU, warehouse, supplier, or broad legacy-master containment.

## Production SELECT-only preflight

Preflight was repeated against EcoFlow production before implementation. It did
not mutate schema or data.

- All four tables are owned by `postgres`, have `relrowsecurity=false`,
  `relforcerowsecurity=false`, and zero policies.
- `anon`, `authenticated`, and `service_role` each effectively hold
  `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`,
  and PostgreSQL 17 `MAINTAIN` on every table. The ACLs are direct; `PUBLIC`
  has no table ACL on the four relations.
- Raw `pg_attribute.attacl` inspection found zero explicit column ACLs on all
  four tables, so no column-level browser grant survives the table revocation.
- Every table currently contains one row.
- Supabase Security Advisor reports all four under
  `rls_disabled_in_public` (ERROR). The migration creates no view, function,
  or policy, so it introduces no new `security_definer_view` or callable-RPC
  surface. `rls_enabled_no_policy` after containment is intentional fail-closed
  information because the browser roles also have no table grants.
- `anon` and `authenticated` cannot `CREATE` in `public`; `service_role` has
  `BYPASSRLS`, while the browser roles do not.

## Fresh dependency and caller audit

| Caller/dependency class | Fresh result | Containment consequence |
|---|---:|---|
| Frontend/browser direct `.from(...)` for the four tables | 0 | Safe to revoke direct browser table access. |
| Frontend governed Customer callers | 2 RPC calls | Preserve `ecoflow_read_operational_records_v1` and `ecoflow_read_operational_record_detail_v1`. |
| Edge Function direct callers | 0 | No Edge change or replacement authority required. |
| Node/script/workflow direct callers | 0 | No server runner requires legacy-table grants. |
| Production SQL function relational references | 0 | No incumbent function reads or writes the four base tables. |
| Production view/materialized-view dependencies | 0 | Approved Customer views are independent of these legacy tables. |
| User triggers on the four tables | 0 | No trigger execution path is affected. |
| Foreign-key dependencies | 9 | Structural references remain intact; no FK or row is changed. |
| Seed/test-only mentions | Resource/route fixtures only | Unleashed resource name `customers` and `/customers` route fixtures are not base-table callers. |

The nine production FKs are from `account_reconciliation_items`,
`customer_sites`, `delivery_stops`, `external_customer_mappings`,
`external_site_mappings`, `orders` (two), and `warehouses`, plus the internal
`customer_sites -> addresses` relationship. Enabling RLS and revoking browser
grants do not alter those constraints.

The approved Customer/store surfaces remain separate:

- `v_ecoflow_customer_store_directory`: authenticated SELECT, anon denied;
- `v_ecoflow_customer_store_order_history`: authenticated SELECT, anon denied;
- `ecoflow_delivery_notification_contacts`: governed authenticated read;
- Customer overview/detail operational RPCs: postgres-owned `SECURITY DEFINER`,
  fixed `search_path=pg_catalog, public`, authenticated execute, anon denied;
- accounts/dashboard refresh functions: postgres-owned `SECURITY DEFINER`,
  fixed `search_path=pg_catalog, public`, service-only execute.

Because browser roles cannot create in `public`, the fixed search paths do not
admit an untrusted browser-created object. This package does not modify any
existing function or EXECUTE grant and introduces no function.

Production read-only continuity evidence before implementation:

- directory rows: 462;
- order-history rows: 82;
- Customer overview RPC total/page rows: 462/10;
- Customer detail rows for the first governed record: 4;
- accounts customer read-model rows: 231.

## Behaviour contract

After the migration, each legacy table has RLS enabled and no policy. All table
privileges are revoked from `anon` and `authenticated`, including PostgreSQL 17
`MAINTAIN`. The migration does not grant, revoke, or otherwise change
`service_role`, `postgres`, `ecoflow_shadow_read`, view, or function authority.
It contains no DML and is safe to apply repeatedly.

The governed views and authenticated operational-record RPCs remain the browser
Customer read path. No browser replacement write path is added.

## Acceptance criteria

- [ ] Both browser roles are denied direct SELECT, INSERT, UPDATE, DELETE, and
  TRUNCATE on every target table; REFERENCES, TRIGGER, MAINTAIN, and column
  privileges are also absent.
- [ ] All four tables have RLS enabled and zero permissive policies.
- [ ] Governed directory/order-history reads and Customer/accounts RPC reads
  still succeed for an active authenticated office user.
- [ ] Existing SECURITY DEFINER ownership, fixed search paths, and EXECUTE
  grants are unchanged.
- [ ] `service_role` and `postgres` incumbent authority is not widened or
  narrowed by this migration.
- [ ] Two applications of the migration pass.
- [ ] Target row fingerprints, inventory sentinel, and commercial sentinel are
  unchanged.
- [ ] Trusted production-schema shadow and exact-head workflows pass.

## Test plan

| Layer | Command/scenario | Expected result |
|---|---|---|
| Static | `node --test scripts/customer-legacy-master-containment-contract.test.mjs` | One migration, exact allowlisted statements, no direct caller, no scope drift. |
| PostgreSQL 17 | `psql -v ON_ERROR_STOP=1 -f scripts/customer-legacy-master-containment-db-contract-test.sql` | RLS/grants/actual denial, governed continuity, replay, and zero-row-change PASS. |
| Regression | Dedicated workflow plus existing TRANSFORM-007 workflow | Customer, warehouse, commercial, master-data and inventory-reference contracts remain green. |
| Build/hygiene | `npm run typecheck`, `npm run build`, `npm run audit:repository-hygiene` | PASS. |
| Trusted shadow | Required production-schema shadow workflow | The single candidate migration applies on the current production schema with no production write. |

## Rollback

Before deployment, close the PR or revert its commit. After deployment, never
edit this migration. A separately authorised forward compensating migration may
restore only a specifically approved governed privilege/policy after a caller
and authorization audit. Do not restore broad browser DML as a rollback.

## Decision log

### Decisions

- Revoke all table privileges rather than enumerating only DML, because
  PostgreSQL 17 also exposed `MAINTAIN` and RLS does not govern TRUNCATE.
- Add no RLS policy: the base tables are intentionally removed from browser
  authority, while existing governed read surfaces remain available.
- Leave server-role ACLs untouched to avoid widening or breaking incumbent
  server authority.

### Risks

- An undocumented direct-table browser caller would fail after deployment. The
  repository caller audit, production dependency audit, authenticated read-only
  smoke, and post-deployment compatibility gate address this risk.

### Deferred

- `ECOFLOW-340B-2` Customer/Site Wave-1 promotion.
- Separate dependency audits for `skus`, `external_product_mappings`, and
  `warehouses`.
