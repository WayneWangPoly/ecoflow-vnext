# UNLEASHED-338 image copy window 43

Status: production-verified.

## Production result

- command: `e3483b9e-ae17-46bd-bd63-781754568c5a`
- run: `69425c64-1e68-4e5a-baa8-e0f850c430ad`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 9 / 1 / 0`
- bytes copied: `1462866`
- requested limit: `10`
- requested by: `be8f153a-cf92-4d9d-bf5c-1ff7f707ad0b`
- authorization: `15612d15-f97e-462e-a24f-49889b4668c2`

## Production integrity

- copied/reused asset rows associated with run: `10`
- asset content bytes represented by those rows: `1570009`
- new bytes written by run: `1462866`
- missing Storage objects: `0`
- Storage size mismatches: `0`
- object-path/hash mismatches: `0`
- active claims: `0`

Cumulative production state after W43: 419 private Storage objects / 100570514 bytes, 420 COPIED, 15 PLANNED, 32 terminal BLOCKED and zero active claims. One asset reused an already-present governed object, so 10 assets completed while Storage object count increased by 9.

Authorization revision 2 remains current and APPROVED with 134217728-byte aggregate budget, 2097152-byte per-object limit, unchanged rights scope and no expiry.

W44 may be exposed only by a separate bounded continuation commit that hard-gates this exact W43 result. `main` remains untouched; inventory/opening balance and cutover remain out of scope.
