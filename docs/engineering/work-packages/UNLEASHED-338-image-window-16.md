# UNLEASHED-338 image copy window 16

Status: production-verified; W17 may be exposed on the governed preview branch.

## Production predecessor gate

W16 was permitted only when the browser could read the exact W15 predecessor:

- command: `39771ddf-19be-44ef-aa0f-ac99ff5001ff`
- run: `a1e5afa1-13ef-4c16-b9bb-10ffb29b5289`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `1523918`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

## W16 production verification

- command: `e83b3a7f-e660-4be6-96ba-b64b8a619ff2`
- run: `6018dfba-da70-4ae3-8912-2a3276942a14`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `1150470`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`
- copied rows: `10`
- distinct content hashes: `10`
- missing Storage objects: `0`
- size mismatches: `0`
- content-hash path mismatches: `0`
- active claims: `0`
- cumulative Storage: `160` private objects / `43,198,416` bytes
- remaining assets: `280 PLANNED / 27 BLOCKED`

W17 remains capped at 10 planned assets and W18 remains unexposed until W17 production verification. `main` is not modified; inventory/opening balance and cutover remain out of scope.
