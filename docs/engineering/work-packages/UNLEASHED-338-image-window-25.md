# UNLEASHED-338 image copy window 25

Status: production-verified PASS.

## Production predecessor gate

W25 was permitted only after exact W24 production verification:

- command: `10c70593-802d-42b9-91a6-21f93cb923a3`
- run: `097d3b0e-5593-4fa3-9d95-ebe549860830`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `847062`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`

## W25 production verification

- command: `488d4bb7-b1d0-4079-9b20-5f5c5ea9d064`
- run: `01003d4b-7117-490f-8e9a-58a8b98e6542`
- status: `SUCCEEDED`
- planned/copied/reused/failed: `10 / 10 / 0 / 0`
- bytes copied: `789720`
- authorization: `9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c`
- copied rows / distinct hashes: `10 / 10`
- missing objects / size mismatches / path-hash mismatches / active claims: `0 / 0 / 0 / 0`
- cumulative Storage: `246 private objects / 58,905,914 bytes`
- asset states: `246 COPIED / 190 PLANNED / 31 BLOCKED`
- readiness: `copy_allowed=true`

W26 is not permitted unless the browser reads this exact W25 predecessor. `main` remains untouched; inventory/opening balance and cutover remain out of scope.
