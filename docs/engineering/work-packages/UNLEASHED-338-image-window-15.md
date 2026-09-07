# UNLEASHED-338 image copy window 15

Status: production-verified; W16 may be exposed on the governed preview branch.

## Production predecessor gate

W15 was permitted only when the browser could read the exact W14 predecessor:

- command: `e3a4d692-ddaf-4535-8277-5d709c3bed40`
- run: `779c6179-1a3d-481a-a006-76ce3134b136`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `4380450`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

## W15 production verification

- command: `39771ddf-19be-44ef-aa0f-ac99ff5001ff`
- run: `a1e5afa1-13ef-4c16-b9bb-10ffb29b5289`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `1523918`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`
- copied rows: `10`
- distinct content hashes: `10`
- missing Storage objects: `0`
- size mismatches: `0`
- content-hash path mismatches: `0`
- active claims: `0`
- cumulative Storage: `150` private objects / `42,047,946` bytes
- remaining assets: `290 PLANNED / 27 BLOCKED`

W16 remains capped at 10 planned assets and W17 remains unexposed until W16 production verification. `main` is not modified; inventory/opening balance and cutover remain out of scope.
