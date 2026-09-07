import test from 'node:test';
import assert from 'node:assert/strict';
import {runAuthorizedImageCopyWindow19, IMAGE_COPY_WINDOW_19} from '../src/features/team/unleashedImageCopyWindow19.ts';

const predecessor={
  id:'6ef22524-1bd4-46d6-97b2-3ea6426842ac',
  status:'PARTIAL',
  assets_planned:10,
  assets_copied:9,
  assets_reused:0,
  assets_failed:1,
  bytes_copied:3538396,
  authorization_id:'9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c'
};
const terminalBlock={
  id:'9a224708-61f5-497f-a86e-6ae6f2055025',
  asset_status:'BLOCKED',
  attempt_count:1,
  last_error_code:'UNLEASHED_IMAGE_OBJECT_TOO_LARGE',
  claimed_in_run_id:null,
  copied_in_run_id:null
};
const result={runId:'w19',status:'SUCCEEDED',assetsPlanned:10,assetsCopied:10,assetsReused:0,assetsFailed:0,bytesCopied:100,errorCode:null,replayed:false};

function client(run=predecessor,block=terminalBlock,response=result,runError=null,blockError=null){
  const calls=[];
  return {
    calls,
    from:(table)=>({
      select:()=>({
        eq:()=>({
          single:async()=>table==='ecoflow_unleashed_asset_copy_runs'
            ? {data:run,error:runError}
            : {data:block,error:blockError}
        })
      })
    }),
    functions:{invoke:async(...args)=>{calls.push(args);return {data:response,error:null};}}
  };
}

test('exact W18 partial plus adjudicated terminal block permits bounded W19 command',async()=>{
  const c=client();
  await runAuthorizedImageCopyWindow19(c);
  assert.equal(c.calls.length,1);
  assert.equal(c.calls[0][0],'trigger-unleashed-master-migration');
  assert.equal(c.calls[0][1].body.commandId,IMAGE_COPY_WINDOW_19.commandId);
  assert.equal(c.calls[0][1].body.limit,10);
});

test('mismatched W18 predecessor never invokes copy',async()=>{
  for(const run of [
    null,
    {...predecessor,status:'SUCCEEDED'},
    {...predecessor,assets_copied:10},
    {...predecessor,assets_failed:0},
    {...predecessor,bytes_copied:0},
    {...predecessor,authorization_id:'other'}
  ]){
    const c=client(run);
    await assert.rejects(()=>runAuthorizedImageCopyWindow19(c));
    assert.equal(c.calls.length,0);
  }
});

test('terminal block must remain exact and unclaimed',async()=>{
  for(const block of [
    null,
    {...terminalBlock,asset_status:'FAILED'},
    {...terminalBlock,last_error_code:'OTHER'},
    {...terminalBlock,claimed_in_run_id:'run'},
    {...terminalBlock,copied_in_run_id:'run'}
  ]){
    const c=client(predecessor,block);
    await assert.rejects(()=>runAuthorizedImageCopyWindow19(c));
    assert.equal(c.calls.length,0);
  }
});

test('malformed or running response cannot report completed window',async()=>{
  for(const r of [
    {...result,status:'RUNNING'},
    {...result,assetsPlanned:11},
    {...result,assetsCopied:9},
    {...result,bytesCopied:-1}
  ]){
    await assert.rejects(()=>runAuthorizedImageCopyWindow19(client(predecessor,terminalBlock,r)));
  }
});
