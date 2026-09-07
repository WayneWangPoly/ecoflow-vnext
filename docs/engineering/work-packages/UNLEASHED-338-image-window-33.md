# UNLEASHED-338 image copy window 33

Status: production verified.

## W33 production result

- command: `2a4b5e7e-662e-4d76-a682-3dfc70ccd2e2`
- run: `c9d04dbd-53eb-435d-8006-3f49834d0d86`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `2557686`
- authorization: `15612d15-f97e-462e-a24f-49889b4668c2`
- copied rows: `10`
- distinct hashes: `10`
- missing Storage objects: `0`
- size mismatches: `0`
- object-path/hash mismatches: `0`
- active claims: `0`

After W33 production verification: 320 private Storage objects / 82966711 bytes, 115 PLANNED, 32 terminal BLOCKED and zero active claims.

Authorization revision 2 remains current: APPROVED, 134217728-byte aggregate budget, 2097152-byte per-object cap, unchanged rights scope and no expiry.

W34 may be exposed only with an exact predecessor gate on the W33 run above. `main`, inventory/opening balances and cutover remain out of scope.
