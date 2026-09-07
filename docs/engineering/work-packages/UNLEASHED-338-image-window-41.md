# UNLEASHED-338 image copy window 41

Status: production-verified.

## Production result

- command: `83eda0a8-04d6-4645-a883-d0a28139425f`
- run: `6ef35508-e8bb-47a1-9e93-ef2d780ec134`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `2255073`
- requested limit: `10`
- requested by: `be8f153a-cf92-4d9d-bf5c-1ff7f707ad0b`
- authorization: `15612d15-f97e-462e-a24f-49889b4668c2`

## Production integrity

- copied asset rows: `10`
- copied asset bytes: `2255073`
- missing Storage objects: `0`
- Storage size mismatches: `0`
- object-path/hash mismatches: `0`
- active claims: `0`

Cumulative production state after W41: 400 private Storage objects / 97097156 bytes, 400 COPIED, 35 PLANNED, 32 terminal BLOCKED and zero active claims.

Authorization revision 2 remains current and APPROVED with 134217728-byte aggregate budget, 2097152-byte per-object limit, unchanged rights scope and no expiry.

W42 may be exposed only by a separate bounded continuation commit that hard-gates this exact W41 result. `main` remains untouched; inventory/opening balance and cutover remain out of scope.
