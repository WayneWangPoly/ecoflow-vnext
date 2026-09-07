# UNLEASHED-338 image copy window 10

Status: VERIFIED in production; continuation to W11 permitted.

## Production predecessor gate

W10 was permitted only when the browser could read the exact W9 predecessor:

- command: `e4096248-3cc6-47e2-b54a-823f69023d32`
- run: `d1b76f79-7da9-44be-94d5-9462e4c4be8e`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `2240093`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

## W10 production verification

- command: `8853f42e-9890-47ce-9530-cbd6e2397749`
- run: `1495a45f-60ae-463c-ae1a-96341f8bd747`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `1398224`
- distinct hashes: `10`
- missing Storage objects: `0`
- size mismatches: `0`
- content-hash path mismatches: `0`
- active claims: `0`
- cumulative Storage: `100 objects / 27,496,818 bytes`
- statuses: `100 COPIED / 340 PLANNED / 27 BLOCKED`
- authorization remains `APPROVED`, revision 1, current, no expiry, 64 MiB total / 2 MiB per object

A browser retry of the same fixed W10 command did not create a second logical run.

`main` is not modified. Inventory/opening balance and cutover remain out of scope.
