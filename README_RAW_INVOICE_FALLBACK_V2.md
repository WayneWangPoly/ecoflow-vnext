# EcoFlow raw invoice fallback v2

Run `supabase/migrations/20260630_ordermentum_raw_invoice_line_fallback_v2.sql` in Supabase SQL Editor after `import:ordermentum:missing-invoices` has created raw invoice records but the control view still reports the records as blocked.

The migration does not delete data. It normalises raw invoice metadata and recreates read-only views so `v_ecoflow_ordermentum_inbox` and release gate views can use raw invoice payloads immediately.
