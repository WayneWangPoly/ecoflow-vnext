# UNLEASHED-338 image copy window 32

Status: production verified.

## Production predecessor gate

W32 was permitted only when the browser could read the exact W31 predecessor:

- command: `8ca61897-3cda-4909-8515-b6de152e98d2`
- run: `2a857937-ff68-49e8-9f2c-a3b99c5766ea`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `4779765`
- authorization: `15612d15-f97e-462e-a24f-49889b4668c2`

## W32 production result

- command: `4149b23d-a24e-4e31-b0c9-0c26bf4df758`
- run: `18fc4e2e-242a-4512-a50f-c49423bcc038`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `4143423`
- authorization: `15612d15-f97e-462e-a24f-49889b4668c2`
- copied rows: `10`
- distinct hashes: `10`
- missing Storage objects: `0`
- size mismatches: `0`
- object-path/hash mismatches: `0`
- active claims: `0`

After W32 production verification: 310 private Storage objects / 80409025 bytes, 125 PLANNED, 32 terminal BLOCKED and zero active claims.

Authorization revision 2 remains current: APPROVED, 134217728-byte aggregate budget, 2097152-byte per-object cap, unchanged rights scope and no expiry.

W33 may be exposed only with an exact predecessor gate on the W32 run above. `main`, inventory/opening balances and cutover remain out of scope.
