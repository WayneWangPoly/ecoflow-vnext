# UNLEASHED-338 image copy window 20

Status: production PARTIAL, adjudicated and closed for continuation.

## Production result

- command: `cd35fb77-cae0-430b-a733-e224a270bbb2`
- run: `210f3abe-b825-47c0-91a8-db39571b8ed3`
- status: `PARTIAL`
- planned/copied/reused/failed: `10 / 7 / 0 / 3`
- bytes copied: `1731521`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

The seven copied rows were production-verified: 7 copied rows / 7 distinct hashes, 0 missing Storage objects, 0 size mismatches, 0 content-hash path mismatches, and 0 active claims.

All three failed source objects were deterministic MIME/content safety rejects and were terminally adjudicated as `BLOCKED` without changing the 2 MiB/object limit or source data:

- `32792498-12af-4bd5-8ce5-15e5eeac6c2b`
- `a16ce48b-e71e-47f2-b1e6-7a127037dc30`
- `f41c87ea-0813-4b3c-9ac3-fba70f95bfd6`

Each remains attempt count 1, unclaimed, uncopied, with `UNLEASHED_IMAGE_MIME_CONTENT_MISMATCH`. The production failure RPC now also treats this error as terminal `BLOCKED`, alongside `UNLEASHED_IMAGE_OBJECT_TOO_LARGE`, so the same deterministic safety reject will not re-enter a later copy window as retryable `FAILED`.

Post-adjudication production state: 196 private Storage objects / 53,196,844 bytes, 196 COPIED, 240 PLANNED, 31 BLOCKED, zero active claims.

No W21 action was taken before these production checks and adjudication completed. `main` remains untouched; inventory/opening balance and cutover remain out of scope.
