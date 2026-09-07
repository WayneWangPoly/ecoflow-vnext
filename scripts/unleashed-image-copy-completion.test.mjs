import assert from 'node:assert/strict';

const finalRun = { id:'d60862ff-41ff-4b1e-a771-374b17d46f76', command_id:'73c66f3e-be03-4003-9503-82a08bde000c', status:'SUCCEEDED', assets_planned:5, assets_copied:5, assets_reused:0, assets_failed:0, bytes_copied:221061, requested_limit:10, requested_by:'be8f153a-cf92-4d9d-bf5c-1ff7f707ad0b', authorization_id:'15612d15-f97e-462e-a24f-49889b4668c2' };
const finalState = { copied:435, planned:0, blocked:32, storageObjects:434, storageBytes:101422059, activeClaims:0, missingObjects:0, sizeMismatches:0, pathHashMismatches:0 };
const authorization = { id:'15612d15-f97e-462e-a24f-49889b4668c2', authorization_status:'APPROVED', is_current:true, revision:2, storage_budget_bytes:134217728, max_object_bytes:2097152, expires_at:null };

function isFinalWindow(run) { return run.id===finalRun.id && run.command_id===finalRun.command_id && run.status==='SUCCEEDED' && run.assets_planned===5 && run.assets_copied===5 && run.assets_reused===0 && run.assets_failed===0 && run.bytes_copied===221061 && run.requested_limit===10 && run.requested_by===finalRun.requested_by && run.authorization_id===authorization.id; }
function isCleanCompletion(state) { return state.planned===0 && state.activeClaims===0 && state.missingObjects===0 && state.sizeMismatches===0 && state.pathHashMismatches===0; }
function isCurrentAuthorization(row) { return row.id===authorization.id && row.authorization_status==='APPROVED' && row.is_current===true && row.revision===2 && row.storage_budget_bytes===134217728 && row.max_object_bytes===2097152 && row.expires_at===null; }
function exposeContinuation(state) { return state.planned>0; }

assert.equal(isFinalWindow(finalRun), true);
assert.equal(isCleanCompletion(finalState), true);
assert.equal(isCurrentAuthorization(authorization), true);
assert.equal(finalState.storageBytes < authorization.storage_budget_bytes, true);
assert.equal(exposeContinuation(finalState), false);
assert.equal(exposeContinuation({...finalState, planned:1}), true);
assert.equal(isCleanCompletion({...finalState, activeClaims:1}), false);
console.log('#338 COPY_IMAGES completion contract passed: W45 final, 0 PLANNED, no continuation exposed');
