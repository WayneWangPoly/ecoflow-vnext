# ECOFLOW-345-METRIC-ENG-R1 — Governed Sales Metric Semantics

## Objective

Create DRAFT semantic candidates for Revenue, Sales Orders, and Average Revenue per
Order from governed sales invoice / credit-note facts. Repair the invoice status
mapping required to distinguish Completed from Parked invoices. This package is
engineering-only: it does not refresh production facts and does not activate a
metric.

## Evidence frozen before engineering

Production materialisation at main `f78c8daa745e455835baccbeeaa1cae6f246a5c6` contains 3,097 current transaction
documents and 14,800 current transaction lines.

Raw invoice status evidence:
- 3,057 invoices are `InvoiceStatus=Completed`.
- 35 invoices are `InvoiceStatus=Parked`.
- current FACT R1 mapped invoice `document_status` from `Status`, which is absent
  on all 3,092 invoice payloads.
- all 5 credit notes are `Status=Completed`.

If Parked invoices were incorrectly included:
- net base-currency ex-tax Revenue = 1,066,442.95
- distinct invoiced Sales Orders = 3,087
- Average Revenue per Order = 345.46256883705865

Completed-only candidate baseline:
- invoice subtotal = 1,021,088.32
- credit subtotal = 10,063.77
- net Revenue = 1,011,024.55
- distinct completed-invoiced Sales Orders = 3,054
- Average Revenue per Order = 331.04929600523906
- Parked invoice subtotal excluded = 55,418.40

## External semantic anchor

Unleashed documents Sales Invoices as the monetary/revenue representation of a
sale. Its invoice Sub Total is sale value including charges and excluding tax.
Completed Sales Invoices are the accounting/export boundary; Parked invoices
remain open/editable.

## Candidate semantics

### Revenue v2 — DRAFT

- source: current sales transaction document facts
- currency basis: base currency
- amount basis: document header `BCSubTotal`
- tax basis: exclusive
- invoices: positive
- credits: negative via `effect_sign`
- date basis: invoice / credit transaction date
- eligibility: completed transaction, non-null transaction date and base subtotal,
  non-INVALID document
- header/line amount variance remains visible quality evidence and is not balanced

### Sales Orders v1 — DRAFT

- count distinct `source_order_number`
- only eligible Completed invoice documents create denominator orders
- credit notes do not create denominator orders
- multiple invoices for one Sales Order count once in the selected period
- non-additive across periods

### Average Revenue per Order v1 — DRAFT

- Revenue v2 / Sales Orders v1 over the same explicit selected period
- credits reduce numerator on credit date
- credits do not create denominator orders
- zero denominator returns NULL
- non-additive across periods

## Cross-period evidence

Five source orders have multiple invoices. Two span different invoice dates.
All five credit notes occur after their source invoice by 7–80 days. Therefore
daily/monthly distinct Sales Orders cannot be safely summed to obtain a larger
period, and credit-period revenue adjustments must not invent denominator orders.

## Implementation

- repair refresh mapping: invoice `InvoiceStatus` with legacy `Status` fallback;
  credit-note `Status` remains unchanged
- add service-only, security-invoker
  `analytics.v_sales_transaction_metric_input_internal`
- add service-only `analytics.reconcile_sales_transaction_metrics(date,date)`
- add Revenue v2, Sales Orders v1, Average Revenue per Order v1 as DRAFT definitions
- preserve Revenue v1 unchanged and DRAFT
- no metric activation/deprecation
- no production refresh/materialisation
- no provider traffic

## Release boundary

Engineering may create and verify a PR. Merge, production deployment, production
fact refresh, metric activation, revenue-authority cutover, UI cutover, and any
provider acquisition remain separately governed.
