# ECOFLOW-R3-P4B verification checklist

- [ ] Exact head remains based on protected main `e2c00ce40948b36a3cf58f2eaed91e29001fb3d3`.
- [ ] Legacy `ecoflow_unlock_commercial_wave2_expansion(...)` has no EXECUTE for service_role/authenticated/anon/public.
- [ ] New `ecoflow_unlock_commercial_wave2_expansion_v2(uuid,text,text)` derives actor from `auth.uid()` and has no requested-by argument.
- [ ] New v2 replacement has no EXECUTE grant for service_role/authenticated/anon/public in the migration.
- [ ] P4A remains PASS after legacy authority revocation.
- [ ] Isolated PostgreSQL activation simulation enables exactly 163 EXPANSION rows and writes exactly one EXPANSION phase unlock and one command ledger row.
- [ ] Exact-command replay is idempotent and payload mismatch fails closed.
- [ ] Expansion source revision drift fails before any enablement.
- [ ] No non-CANARY promotion, SKU creation, external mapping creation, provider action, Physical/package/barcode authority, inventory/SOH/location quantity, image action or #339 mutation occurs.
- [ ] Exact-head CI, trusted production-schema shadow and Independent Verification are green.
- [ ] STOP at merge gate. Production expansion remains NOT AUTHORIZED.
