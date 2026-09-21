# ECOFLOW-345-METRIC-ENG-R2 — Transform-version-aware fact rematerialisation

## Incident evidence

After production migration `20260921015000_sales_transaction_metric_semantics.sql`
was deployed, one separately-authorized refresh ran at
`2026-09-21T04:36:31.242482Z`.

The function executed successfully and advanced both refresh ledgers, but all
3,092 invoice document facts and all 14,791 invoice line facts retained a null
`document_status`.

The raw snapshots were not ambiguous:
- 3,057 invoices: `InvoiceStatus=Completed`
- 35 invoices: `InvoiceStatus=Parked`
- 5 credit notes: `Status=Completed`

All 3,092 current invoice facts still had a raw `source_snapshot_hash` exactly
matching their source snapshot. No document or line SCD history was created.

## Root cause

The R1 refresh maps `InvoiceStatus` correctly, but the SCD change detector only
compares `source_version_hash`.

That hash represented raw/linkage evidence only. A transformation-code change
therefore produced the same hash when the raw payload was unchanged. The
same-hash replay branch updates observation and quality fields, but intentionally
does not rewrite semantic fields such as `document_status`.

This made a transformation repair invisible to SCD.

## R2 repair

The compensating migration introduces the explicit transform contract:

`sales_transaction_transform_v2_invoice_status`

The transform contract is included in both:
- transaction-document `source_version_hash`
- transaction-line `source_version_hash`

Therefore the first separately-authorized refresh after this migration will see
legacy transform hashes as different even when raw snapshot hashes are unchanged.
The existing SCD path will close the old fact versions and insert current versions
using the corrected `InvoiceStatus` mapping.

Future transformation-semantic changes must bump this contract version whenever
they can change persisted fact values without requiring a raw-source change.

## Governance boundary

This engineering package:
- does **not** edit any deployed migration
- does **not** invoke production or test refresh from the migration itself
- does **not** activate/deprecate any metric
- does **not** perform provider traffic
- does **not** mutate existing production fact rows at migration-apply time

Production merge, deployment, and the next production fact refresh are separate
authorities.

## Regression contract

The sales-transaction DB contract must emulate the production failure mode:

1. Build current facts.
2. Convert invoice current rows into a simulated legacy transform version while
   keeping their raw `source_snapshot_hash` unchanged and clearing
   `document_status`.
3. Re-run the refresh against unchanged raw snapshots.
4. Require the legacy versions to close and new current versions to materialise
   Completed/Parked status.
5. Require the subsequent same-transform replay to create no additional versions.


## Exact-head verification boundary

This PR is not merge-authorized by branch-push validation alone. The final exact
head must also complete the repository's PR-level checks, required Supabase shadow
gate, and Vercel verification. A successful engineering gate does not authorize
merge, production deployment, or a second production fact refresh.
