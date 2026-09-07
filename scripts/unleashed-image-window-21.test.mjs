import test from 'node:test';
import assert from 'node:assert/strict';
import {runAuthorizedImageCopyWindow21, IMAGE_COPY_WINDOW_21} from '../src/features/team/unleashedImageCopyWindow21.ts';

const predecessor={
  id:'210f3abe-b825-47c0-91a8-db39571b8ed3',status:'PARTIAL',assets_planned:10,
  assets_copied:7,assets_reused:0,assets_failed:3,bytes_copied:1731521,
  authorization_id:'9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c'
};
const blocks=[
  '32792498-12af-4bd5-8ce5-15e5eeac6c2b',
  'a16ce48b-e71e-47f2-b1e6-7a127037dc30',
  'f41c87ea-0813-4b3c-9ac3-fba70f95bfd6'
].map(id=>({id,asset_status:'BLOCKED',attempt_count:1,last_error_code:'UNLEASHED_IMAGE_MIME_CONTENT_MISMATCH',claimed_in_run_id:null,copied_in_run_id:null}));
const result={runId:'w21',status:'SUCCEEDED',assetsPlanned:10,assetsCopied:10,assetsReused:0,assetsFailed:0,bytesCopied:100,errorCode:null,replayed:false};

function client(run=predecessor,terminalBlocks=blocks,response=result,runError=null,blockError=null){
  const calls=[];
  return {
    calls,
    from:(table)=>({
      select:()=>table==='ecoflow_unleashed_asset_copy_runs'
        ? {eq:()=>({single:async()=>({data:run,error:runError})})}
        : {in:()=>({order:async()=>({data:terminalBlocks,error:blockError})})}
    }),
    functions:{invoke:async(...args)=>{calls.push(args);return {data:response,error:null};}}
  };
}

test('exact W20 partial plus three terminal MIME blocks permits bounded W21 command',async()=>{
  const c=client();
  await runAuthorizedImageCopyWindow21(c);
  assert.equal(c.calls.length,1);
  assert.equal(c.calls[0][0],'trigger-unleashed-master-migration');
  assert.equal(c.calls[0][1].body.commandId,IMAGE_COPY_WINDOW_21.commandId);
  assert.equal(c.calls[0][1].body.limit,10);
});

test('mismatched W20 predecessor never invokes copy',async()=>{
  for(const run of [null,{...predecessor,status:'SUCCEEDED'},{...predecessor,assets_copied:8},{...predecessor,assets_failed:2},{...predecessor,bytes_copied:0},{...predecessor,authorization_id:'other'}]){
    const c=client(run);
    await assert.rejects(()=>runAuthorizedImageCopyWindow21(c));
    assert.equal(c.calls.length,0);
  }
});

test('all three terminal MIME blocks must remain exact and unclaimed',async()=>{
  for(const terminalBlocks of [
    blocks.slice(0,2),
    blocks.map((row,i)=>i===0?{...row,asset_status:'FAILED'}:row),
    blocks.map((row,i)=>i===1?{...row,last_error_code:'OTHER'}:row),
    blocks.map((row,i)=>i===2?{...row,claimed_in_run_id:'run'}:row),
    blocks.map((row,i)=>i===0?{...row,copied_in_run_id:'run'}:row),
  ]){
    const c=client(predecessor,terminalBlocks);
    await assert.rejects(()=>runAuthorizedImageCopyWindow21(c));
    assert.equal(c.calls.length,0);
  }
});

test('malformed or running response cannot report completed window',async()=>{
  for(const r of [{...result,status:'RUNNING'},{...result,assetsPlanned:11},{...result,assetsCopied:9},{...result,bytesCopied:-1}]){
    await assert.rejects(()=>runAuthorizedImageCopyWindow21(client(predecessor,blocks,r)));
  }
});
