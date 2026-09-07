# UNLEASHED-338 image copy window 29

Status: production-adjudicated PARTIAL.

## Production result

- command: `4d731c72-ba5b-4292-8407-ae0f641a0391`
- run: `2d8151ec-7e4a-4831-9377-802e905542cb`
- status: `PARTIAL`
- planned/copied/reused/failed: `10 / 5 / 0 / 5`
- bytes copied: `1318029`
- authorization used by run: revision 1 / `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`
- five copied rows passed Storage/provenance integrity checks
- all five failures were `UNLEASHED_IMAGE_BUDGET_EXCEEDED`
- zero active claims remain

The operator then explicitly authorized an aggregate budget increase from 64 MiB to 128 MiB. Authorization revision 2 is current and APPROVED as `15612d15-f97e-462e-a24f-49889b4668c2`; max object size remains 2 MiB, rights scope is unchanged, expiry remains null, and the private bucket policy is unchanged.

The five budget-exceeded assets remain retryable FAILED rows. The COPY_IMAGES selector intentionally includes both `PLANNED` and `FAILED`, ordered by `created_at`, so W30 may safely retry them under revision 2 without mutating source data or relaxing any per-object control.

No W31 is exposed until W30 production verification.
