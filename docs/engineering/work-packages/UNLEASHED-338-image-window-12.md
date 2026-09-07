# UNLEASHED-338 image copy window 12

Status: VERIFIED in production; W13 may be exposed only against the exact verified W12 predecessor below.

## Production predecessor gate used for W12

W12 was permitted only when the browser could read the exact W11 predecessor:

- command: `2c7b2cf0-65f0-49e7-8cf1-4a661580404b`
- run: `1575c3d7-2348-406b-bf46-61ef8f521779`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `2310821`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

W11 production verification established 110 private Storage objects / 29,807,639 bytes, zero active claims, no missing objects, no size mismatches, and no content-hash path mismatches. W11 contained 10 distinct content hashes across 10 identity-scoped objects.

## W12 bound

- command: `f70d6b49-1c62-456c-b9a7-124572c95313`
- maximum planned assets: `10`
- action: `COPY_IMAGES`
- `main` was not modified
- inventory/opening balance and cutover remained out of scope

## Production verification

W12 completed as the single logical run for its fixed command id:

- run: `924f762c-2b93-48b8-a839-8c03a7812813`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `1475613`
- requested by: `be8f153a-cf92-4d9d-bf5c-1ff7f707ad0b`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`
- completed: `2026-09-07T04:23:40.770442+00:00`

Object-level production verification:

- copied rows: `10`
- copied bytes: `1475613`
- distinct content hashes: `10`
- missing Storage objects: `0`
- Storage/content length mismatches: `0`
- object-path/content-hash mismatches: `0`
- active asset claims: `0`

Post-W12 governed state:

- Storage: `120` private objects / `31,283,252` bytes
- assets: `120 COPIED / 320 PLANNED / 27 BLOCKED`
- authorization: `APPROVED`, revision `1`, current, no expiry
- readiness: `copy_allowed = true`

W13 may be exposed only by binding these exact production facts. No W14 is exposed here.
