# UNLEASHED-338 image copy window 14

Status: production-verified; W15 may be exposed on the governed preview branch.

## Production predecessor gate

W14 was permitted only when the browser could read the exact W13 predecessor:

- command: `b019f9e8-4e48-4b67-8124-41df6978b13d`
- run: `cdf5b53f-7763-4344-9a36-99ca6f5fabaa`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `4860326`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

## W14 production verification

- command: `e3a4d692-ddaf-4535-8277-5d709c3bed40`
- run: `779c6179-1a3d-481a-a006-76ce3134b136`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `4380450`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`
- copied rows: `10`
- distinct content hashes: `10`
- missing Storage objects: `0`
- size mismatches: `0`
- content-hash path mismatches: `0`
- active claims: `0`
- cumulative Storage: `140` private objects / `40,524,028` bytes
- remaining assets: `300 PLANNED / 27 BLOCKED`

W15 remains capped at 10 planned assets and W16 remains unexposed until W15 production verification. `main` is not modified; inventory/opening balance and cutover remain out of scope.
