import test from 'node:test';
import assert from 'node:assert/strict';
import {runAuthorizedImageCopyWindow27, IMAGE_COPY_WINDOW_27} from '../src/features/team/unleashedImageCopyWindow27.ts';

const predecessor={
  id:'3cfff46f-b65c-41e9-bf2b-e98f2e380e98',status:'PARTIAL',assets_planned:10,
  assets_copied:9,assets_reused:0,assets_failed:1,bytes_copied:2880905,
  authorization_id:'9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c'
};
const terminalBlock={
  id:'5a121d99-eefb-4287-b16d-4ae78f40ca9e',asset_status:'BLOCKED',attempt_count:1,
  last_error_code:'UNLEASHED_IMAGE_MIME_CONTENT_MISMATCH',claimed_in_run_id:null,copied_in_run_id:null
};
const result={runId:'w27',status:'SUCCEEDED',assetsPlanned:10,assetsCopied:10,assetsReused:0,assetsFailed:0,bytesCopied:100,errorCode:null,replayed:false};

function client(run=predecessor,block=terminalBlock,response=result,runError=null,blockError=null){
  const calls=[];
  return {
    calls,
    from:(table)=>({
      select:()=>table==='ecoflow_unleashed_asset_copy_runs'
        ? {eq:()=>({single:async()=>({data:run,error:runError})})}
        : {in:()=>({order:async()=>({data:block?[block]:[],error:blockError})})}
    }),
    functions:{invoke:async(...args)=>{calls.push(args);return {data:response,error:null};}}
  };
}

test('exact adjudicated W26 predecessor permits bounded W27 command',async()=>{
  const c=client();
  await runAuthorizedImageCopyWindow27(c);
  assert.equal(c.calls.length,1);
  assert.equal(c.calls[0][0],'trigger-unleashed-master-migration');
  assert.equal(c.calls[0][1].body.commandId,IMAGE_COPY_WINDOW_27.commandId);
  assert.equal(c.calls[0][1].body.limit,10);
});

test('mismatched W26 predecessor never invokes copy',async()=>{
  for(const run of [null,{...predecessor,status:'SUCCEEDED'},{...predecessor,assets_copied:8},{...predecessor,assets_failed:0},{...predecessor,bytes_copied:0},{...predecessor,authorization_id:'other'}]){
    const c=client(run);
    await assert.rejects(()=>runAuthorizedImageCopyWindow27(c));
    assert.equal(c.calls.length,0);
  }
});

test('terminal block drift prevents invoke',async()=>{
  for(const block of [null,{...terminalBlock,asset_status:'FAILED'},{...terminalBlock,attempt_count:2},{...terminalBlock,last_error_code:'OTHER'},{...terminalBlock,claimed_in_run_id:'claim'},{...terminalBlock,copied_in_run_id:'copy'}]){
    const c=client(predecessor,block);
    await assert.rejects(()=>runAuthorizedImageCopyWindow27(c));
    assert.equal(c.calls.length,0);
  }
});

test('predecessor or terminal block read error prevents invoke',async()=>{
  await assert.rejects(()=>runAuthorizedImageCopyWindow27(client(predecessor,terminalBlock,result,new Error('read failed'))));
  await assert.rejects(()=>runAuthorizedImageCopyWindow27(client(predecessor,terminalBlock,result,null,new Error('block read failed'))));
});

test('malformed or over-limit response cannot report completed window',async()=>{
  for(const r of [{...result,status:'RUNNING'},{...result,assetsPlanned:11},{...result,assetsCopied:9},{...result,bytesCopied:-1}]){
    await assert.rejects(()=>runAuthorizedImageCopyWindow27(client(predecessor,terminalBlock,r)));
  }
});
