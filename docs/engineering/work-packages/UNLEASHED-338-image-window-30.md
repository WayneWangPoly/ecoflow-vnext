# UNLEASHED-338 image copy window 30

Status: production verified.

## Production result

- command: `702f771d-d57a-4270-8831-c4757ed8a181`
- run: `82b41005-fbe8-4bac-80b4-85ce34d775cb`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `4447008`
- requested by: `be8f153a-cf92-4d9d-bf5c-1ff7f707ad0b`
- authorization: `15612d15-f97e-462e-a24f-49889b4668c2` revision 2
- copied rows: 10
- missing Storage objects: 0
- Storage size mismatches: 0
- object-path/hash mismatches: 0
- active claims: 0

After W30 production verification: 290 COPIED, 145 PLANNED, 32 BLOCKED; private Storage 290 objects / 71485837 bytes. Aggregate authorization remains 128 MiB and per-object cap remains 2 MiB.

W31 may be exposed only with an exact predecessor gate for this verified run. `main` is not modified.
