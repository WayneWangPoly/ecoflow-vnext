# UNLEASHED-338 image copy window 42

Status: production-verified.

## Production result

- command: `a105b23f-ca63-476e-ad91-689db436f0ec`
- run: `f3257832-a582-427d-a483-528aace6137a`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `2010492`
- requested limit: `10`
- requested by: `be8f153a-cf92-4d9d-bf5c-1ff7f707ad0b`
- authorization: `15612d15-f97e-462e-a24f-49889b4668c2`

## Production integrity

- copied asset rows: `10`
- copied asset bytes: `2010492`
- missing Storage objects: `0`
- Storage size mismatches: `0`
- object-path/hash mismatches: `0`
- active claims: `0`

Cumulative production state after W42: 410 private Storage objects / 99107648 bytes, 410 COPIED, 25 PLANNED, 32 terminal BLOCKED and zero active claims.

Authorization revision 2 remains current and APPROVED with 134217728-byte aggregate budget, 2097152-byte per-object limit, unchanged rights scope and no expiry.

W43 may be exposed only by a separate bounded continuation commit that hard-gates this exact W42 result. `main` remains untouched; inventory/opening balance and cutover remain out of scope.
