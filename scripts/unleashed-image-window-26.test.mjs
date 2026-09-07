import test from 'node:test';
import assert from 'node:assert/strict';
import {runAuthorizedImageCopyWindow26, IMAGE_COPY_WINDOW_26} from '../src/features/team/unleashedImageCopyWindow26.ts';

const predecessor={
  id:'01003d4b-7117-490f-8e9a-58a8b98e6542',status:'SUCCEEDED',assets_planned:10,
  assets_copied:10,assets_reused:0,assets_failed:0,bytes_copied:789720,
  authorization_id:'9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c'
};
const result={runId:'w26',status:'SUCCEEDED',assetsPlanned:10,assetsCopied:10,assetsReused:0,assetsFailed:0,bytesCopied:100,errorCode:null,replayed:false};

function client(run=predecessor,response=result,runError=null){
  const calls=[];
  return {
    calls,
    from:()=>({select:()=>({eq:()=>({single:async()=>({data:run,error:runError})})})}),
    functions:{invoke:async(...args)=>{calls.push(args);return {data:response,error:null};}}
  };
}

test('exact W25 predecessor permits bounded W26 command',async()=>{
  const c=client();
  await runAuthorizedImageCopyWindow26(c);
  assert.equal(c.calls.length,1);
  assert.equal(c.calls[0][0],'trigger-unleashed-master-migration');
  assert.equal(c.calls[0][1].body.commandId,IMAGE_COPY_WINDOW_26.commandId);
  assert.equal(c.calls[0][1].body.limit,10);
});

test('mismatched W25 predecessor never invokes copy',async()=>{
  for(const run of [null,{...predecessor,status:'PARTIAL'},{...predecessor,assets_copied:9},{...predecessor,assets_failed:1},{...predecessor,bytes_copied:0},{...predecessor,authorization_id:'other'}]){
    const c=client(run);
    await assert.rejects(()=>runAuthorizedImageCopyWindow26(c));
    assert.equal(c.calls.length,0);
  }
});

test('predecessor read error prevents invoke',async()=>{
  const c=client(predecessor,result,new Error('read failed'));
  await assert.rejects(()=>runAuthorizedImageCopyWindow26(c));
  assert.equal(c.calls.length,0);
});

test('malformed or over-limit response cannot report completed window',async()=>{
  for(const r of [{...result,status:'RUNNING'},{...result,assetsPlanned:11},{...result,assetsCopied:9},{...result,bytesCopied:-1}]){
    await assert.rejects(()=>runAuthorizedImageCopyWindow26(client(predecessor,r)));
  }
});
