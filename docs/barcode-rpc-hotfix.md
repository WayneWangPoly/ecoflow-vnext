# Barcode RPC ambiguity hotfix

The barcode mapping RPCs return columns named `sku` and `barcode`. In PL/pgSQL those output columns are variables, so unqualified SQL references such as `where sku = v_sku` and `on conflict (sku)` can raise PostgreSQL error `42702`.

Migration `20260725100000_fix_barcode_rpc_ambiguous_sku.sql` qualifies source columns, uses named constraints for upserts and enables strict variable-conflict checking.
