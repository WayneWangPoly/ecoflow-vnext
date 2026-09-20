# ECOFLOW-345-FACT-ENG-R1 — Governed Sales Transaction Fact Foundation

## Objective

Add an additive, service-only analytics foundation for versioned Unleashed sales
invoice and credit-note documents and lines. Preserve source accounting evidence,
including header/line amount-basis variance and negative invoice charges, without
changing any metric definition or materialising production facts in the migration.

## Scope

- Add `analytics.fact_sales_transaction_document`.
- Add `analytics.fact_sales_transaction_line`.
- Add `analytics.refresh_sales_transaction_facts(timestamptz)`.
- Add service-only `analytics.v_sales_transaction_source_quality_internal`.
- Register document and line refresh datasets in `NEVER` state.
- Add SQL contract tests and a static migration audit.

## Non-goals

- No provider/API traffic or new acquisition.
- No production refresh/backfill.
- No mutation or activation of analytics metric definitions.
- No revenue-recognition or eligibility decision.
- No dimension modelling project.
- No unrelated RLS remediation.

## Source and grain

The only inputs are immutable rows already present in
`public.unleashed_raw_snapshots` for `SalesInvoices`, `CreditNotes`, and
`SalesOrders`. The document grain is one version of an invoice or credit note.
The line grain is one version of a source line. Sales orders provide enrichment
only through exact `OrderNumber` identity. Credit-to-invoice linkage is exact
`InvoiceNumber` identity.

## Invariants

- Raw source amounts are preserved without sign rewriting.
- `effect_sign` is `+1` for invoices and `-1` for credits.
- Line classification is limited to `INVOICE_LINE`, `INVOICE_CHARGE`, and
  `CREDIT_LINE`.
- Header totals and line aggregates remain separate; no balancing rows are made.
- `HEADER_LINE_AMOUNT_BASIS_VARIANCE` records non-zero header/line subtotal
  variance.
- Missing optional sales-order enrichment degrades quality but does not invalidate
  a transaction.
- Exact-linkage ambiguity or absence is preserved and surfaced; rows are not
  discarded.
- Identical source/enrichment hashes replay in place. A changed version hash closes
  the prior row and inserts one new current version.
- Structurally corrupt payloads fail the refresh subtransaction closed.
- Only `service_role` may read the facts/view or execute the refresh.

## Verification

- Migration static audit: object, permission, no-invocation, no-metric-mutation,
  and source-boundary checks.
- Database contract test: ordinary invoice, negative zero-quantity charge,
  nine-percent header/line variance, positive raw credit with reversal sign, exact
  linkage, missing salesperson, replay, changed-payload versioning, and fail-closed
  malformed numeric input.
- The unbounded document/line grains and fixture paths cover the current-corpus
  acceptance capacities of 3,097 documents (3,092 invoices plus 5 credits) and
  14,800 lines (14,791 invoice lines plus 9 credit lines); these are verification
  expectations only and are not materialised by this change.
- Exact-head CI and database checks before handoff.

## Release gate

Engineering may create and verify a pull request. Merge, production deployment,
and production fact refresh remain explicitly unauthorised.
