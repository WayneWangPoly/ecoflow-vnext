# UNLEASHED-338 image copy window 30

Status: preview-only exposure after W29 adjudication and explicit authorization revision 2.

## Production predecessor gate

W30 is permitted only when the browser can read the exact W29 predecessor:

- command: `4d731c72-ba5b-4292-8407-ae0f641a0391`
- run: `2d8151ec-7e4a-4831-9377-802e905542cb`
- status: `PARTIAL`
- planned/copied/reused/failed: `10 / 5 / 0 / 5`
- bytes copied: `1318029`
- run authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

W29 production verification established 280 private Storage objects / 67,038,829 bytes, 150 PLANNED, 5 retryable FAILED budget-exceeded rows, 32 terminal BLOCKED, zero active claims, and no copied-object integrity defects.

## Current authorization gate

- current authorization: `15612d15-f97e-462e-a24f-49889b4668c2`
- revision: `2`
- status: `APPROVED`
- aggregate storage budget: `134217728` bytes (128 MiB)
- max object bytes: `2097152` (2 MiB)
- rights scope unchanged from revision 1
- expiry: none

## W30 bound

- command: `702f771d-d57a-4270-8831-c4757ed8a181`
- maximum planned assets: `10`
- action: `COPY_IMAGES`
- retryable FAILED rows are eligible under the existing COPY_IMAGES selector
- no W31 is exposed until W30 production verification
- `main` is not modified
- inventory/opening balance and cutover remain out of scope
