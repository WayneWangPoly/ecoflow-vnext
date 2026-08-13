# TRANSFORM-008A — Analytics productivity truth boundary

## Status

Implementation branch. TRANSFORM-007 Phase 5 final-main evidence is green; this package is the first bounded TRANSFORM-008 slice.

## Problem

The legacy Phase 6 Personalisation/Productivity surface mixed governed features with browser-declared authority:

- Comparison Tray accepted an arbitrary entity ID and entity kind from the browser.
- The browser constructed comparison records with `permission: 'ALLOWED'` instead of receiving authorization from an authoritative read model.
- Export controls were labelled as the current table, selected records, and current chart dataset while exporting Saved View metadata or locally assembled comparison data rather than the actual visible business dataset.

Those behaviours violate the production-truth rule established by TRANSFORM-001 through TRANSFORM-007: the browser may present state, but it may not invent authorization or represent synthetic/local metadata as authoritative operational data.

## Scope

1. Keep Saved Views because their reads and commands already use the server RPC boundary.
2. Keep Quick Actions because they are bounded navigation shortcuts and do not grant capability.
3. Remove the manual Comparison Tray from the production panel until candidate identity, visibility and permissions are supplied by an authoritative read model.
4. Remove current-data CSV controls until the active table/chart adapters can provide the exact authorized dataset, `as_of`/freshness context and hidden-field policy.
5. Add a permanent static audit and GitHub Actions gate that prevents the removed browser-authority patterns from returning.

## Non-goals

- No forecasting model or forecast UI.
- No new analytics facts, metrics, database tables, migrations or RPCs.
- No operational business-table writes.
- No Survey #281 work.
- No Ordermentum sync repair in this package.
- No redesign of Commercial SKU versus Physical SKU semantics.

## Truth invariants

- The client must not hard-code an entity permission as `ALLOWED`.
- Arbitrary browser-entered entity IDs must not become authorized comparison candidates.
- Analytics must remain read-only with respect to operational business tables.
- A control labelled as exporting a current table/chart must be wired to that exact authorized current dataset; otherwise it must not be exposed.
- Saved Views remain backed by `get_intelligence_saved_views` and `apply_intelligence_saved_view_command`.
- Quick Actions remain navigation-only and must not bypass route or command authorization.
- Missing/unavailable production data must not be replaced by fake zero, demo rows or synthetic values.

## Acceptance gate

The package is green only when all of the following pass on the exact PR head:

- `npm run audit:transform-008a`
- `npm run build`
- GitHub Actions workflow `TRANSFORM-008A Analytics productivity truth`
- diff review confirms no database migration, operational mutation path or unrelated feature work

## Follow-on dependency

TRANSFORM-008B may restore comparison only after a governed server-authoritative comparison-candidate/read-model contract exists for the intended entity classes (including explicit Commercial SKU / Physical SKU separation).

TRANSFORM-008C may restore export only after the current table/chart surfaces expose an authorized export adapter with exact visible/selected dataset semantics, freshness/`as_of` metadata and hidden-field filtering.

Forecasting remains blocked until 008A–008C have a production-truth gate; forecast outputs must not be built on browser-fabricated identity, permission or datasets.
