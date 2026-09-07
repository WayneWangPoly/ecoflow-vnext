# UNLEASHED-338 image copy window 44

Status: production-verified.

## Production result

- command: `ff6153da-5726-4df6-a961-fbbfd5796643`
- run: `e71577c6-c584-4eb6-94a7-7cb45b7c2251`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `630484`
- requested limit: `10`
- requested by: `be8f153a-cf92-4d9d-bf5c-1ff7f707ad0b`
- authorization: `15612d15-f97e-462e-a24f-49889b4668c2`

## Production integrity

- copied asset rows associated with run: `10`
- asset content bytes represented by those rows: `630484`
- distinct content hashes: `8`
- missing Storage objects: `0`
- Storage size mismatches: `0`
- object-path/hash mismatches: `0`
- active claims: `0`

Cumulative production state after W44: 429 private Storage objects / 101200998 bytes, 430 COPIED, 5 PLANNED, 32 terminal BLOCKED and zero active claims.

Authorization revision 2 remains current and APPROVED with 134217728-byte aggregate budget, 2097152-byte per-object limit, unchanged rights scope and no expiry.

W45 is exposed only by a separate bounded continuation commit that hard-gates this exact W44 result. `main` remains untouched; inventory/opening balance and cutover remain out of scope.
