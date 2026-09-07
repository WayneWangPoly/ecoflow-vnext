# UNLEASHED-338 image copy window 26

Status: production-adjudicated PARTIAL; continuation permitted only after terminal block verification.

## Production result

- command: `f3b54e4f-d8ce-493b-a486-709b10e66f33`
- run: `3cfff46f-b65c-41e9-bf2b-e98f2e380e98`
- status: `PARTIAL`
- planned/copied/reused/failed: `10 / 9 / 0 / 1`
- bytes copied: `2880905`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

The one failed item was deterministically adjudicated as terminal `BLOCKED`:

- asset: `5a121d99-eefb-4287-b16d-4ae78f40ca9e`
- error: `UNLEASHED_IMAGE_MIME_CONTENT_MISMATCH`
- attempt count: `1`
- no active claim and no copied provenance row for the blocked asset

Production verification established 255 private Storage objects / 61,786,819 bytes, 180 PLANNED, 32 BLOCKED, zero active claims, 9 copied rows / 2,880,905 bytes for W26, and no missing objects, size mismatches, or content-hash path mismatches.

## Continuation gate

W27 may be exposed only while the exact W26 run and terminal-block asset remain in the states above. `main` is not modified. Inventory/opening balance and cutover remain out of scope.
