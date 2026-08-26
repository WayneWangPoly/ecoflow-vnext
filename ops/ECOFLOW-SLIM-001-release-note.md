# ECOFLOW-SLIM-001 release note

This change reduces automatic Ordermentum workload only. It performs no production data deletion and no schema mutation.

Post-merge verification:

1. Confirm scheduled Ordermentum cloud sync is four times daily.
2. Confirm successful Supabase deployment triggers Complete Mirror in `verify_only` mode.
3. Confirm weekly Complete Mirror uses `recent` mode.
4. Confirm workflow artifacts expire after one day.
5. Re-measure production database size before proceeding to targeted-resource sync and JSON-retention work.
