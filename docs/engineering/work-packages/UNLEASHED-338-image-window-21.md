# UNLEASHED-338 image copy window 21

Status: preview-only exposure after production verification and terminal adjudication of W20.

## Production predecessor gate

W21 is permitted only when the browser can read the exact W20 predecessor:

- command: `cd35fb77-cae0-430b-a733-e224a270bbb2`
- run: `210f3abe-b825-47c0-91a8-db39571b8ed3`
- status: `PARTIAL`
- planned/copied/reused/failed: `10 / 7 / 0 / 3`
- bytes copied: `1731521`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

W21 additionally requires the three W20 deterministic failures to remain terminal `BLOCKED`, attempt count 1, unclaimed and uncopied, with error `UNLEASHED_IMAGE_MIME_CONTENT_MISMATCH`:

- `32792498-12af-4bd5-8ce5-15e5eeac6c2b`
- `a16ce48b-e71e-47f2-b1e6-7a127037dc30`
- `f41c87ea-0813-4b3c-9ac3-fba70f95bfd6`

W20 verification established 196 private Storage objects / 53,196,844 bytes, 240 PLANNED, 31 BLOCKED, and zero active claims.

## W21 bound

- command: `a9fb6b96-28b1-4f77-b07c-941c7816409a`
- maximum planned assets: `10`
- action: `COPY_IMAGES`
- no W22 is exposed until W21 production verification
- `main` is not modified
- inventory/opening balance and cutover remain out of scope
