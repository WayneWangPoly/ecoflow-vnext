# UNLEASHED-338 image copy window 13

Status: production verified; W14 may now be exposed on the governed preview branch.

## Production predecessor gate

W13 was permitted only when the browser could read the exact W12 predecessor:

- command: `f70d6b49-1c62-456c-b9a7-124572c95313`
- run: `924f762c-2b93-48b8-a839-8c03a7812813`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `1475613`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

W12 production verification established 120 private Storage objects / 31,283,252 bytes, zero active claims, no missing objects, no size mismatches, and no content-hash path mismatches. W12 contained 10 distinct content hashes across 10 identity-scoped objects.

## W13 bound

- command: `b019f9e8-4e48-4b67-8124-41df6978b13d`
- maximum planned assets: `10`
- action: `COPY_IMAGES`
- `main` was not modified
- inventory/opening balance and cutover remain out of scope

## W13 production verification

Production verification after browser execution established:

- run: `cdf5b53f-7763-4344-9a36-99ca6f5fabaa`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `4860326`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`
- copied asset rows: `10`
- copied asset bytes: `4860326`
- distinct content hashes: `10`
- missing Storage objects: `0`
- Storage size mismatches: `0`
- content-hash/object-path mismatches: `0`
- active claims: `0`
- cumulative private Storage: `130 objects / 36,143,578 bytes`
- asset status: `130 COPIED / 310 PLANNED / 27 BLOCKED`
- authorization remains `APPROVED`, current, revision `1`, no expiry, 64 MiB aggregate / 2 MiB per object

W14 is exposed only after this production verification. A browser refresh by itself never advances the governed window; the preview branch must first receive and deploy the next exact-head exposure commit.
