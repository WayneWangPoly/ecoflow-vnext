import test from 'node:test';
import assert from 'node:assert/strict';
import {runAuthorizedImageCopyWindow5, IMAGE_COPY_WINDOW_5} from '../src/features/team/unleashedImageCopyWindow5.ts';

const baseline={
  id:'356d0e2d-8c5b-48ae-be1d-b832662d349b',
  status:'SUCCEEDED',
  assets_planned:10,
  assets_copied:10,
  assets_reused:0,
  assets_failed:0,
  bytes_copied:2018178,
  authorization_id:'9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c'
};
const result={runId:'w5',status:'SUCCEEDED',assetsPlanned:10,assetsCopied:10,assetsReused:0,assetsFailed:0,bytesCopied:100,errorCode:null,replayed:false};

function client(row=baseline,response=result,readError=null){
  const calls=[];
  return {
    calls,
    from:()=>({select:()=>({eq:()=>({single:async()=>({data:row,error:readError})})})}),
    functions:{invoke:async(...args)=>{calls.push(args);return {data:response,error:null};}}
  };
}

test('only exact successful predecessor permits bounded W5 command',async()=>{
  const c=client();
  await runAuthorizedImageCopyWindow5(c);
  assert.equal(c.calls.length,1);
  assert.equal(c.calls[0][0],'trigger-unleashed-master-migration');
  assert.equal(c.calls[0][1].body.commandId,IMAGE_COPY_WINDOW_5.commandId);
  assert.equal(c.calls[0][1].body.limit,10);
});

test('missing, failed, or mismatched predecessor never invokes copy',async()=>{
  for(const row of [
    null,
    {...baseline,status:'PARTIAL'},
    {...baseline,bytes_copied:0},
    {...baseline,assets_failed:1},
    {...baseline,authorization_id:'other'}
  ]){
    const c=client(row);
    await assert.rejects(()=>runAuthorizedImageCopyWindow5(c));
    assert.equal(c.calls.length,0);
  }
  const c=client(baseline,result,new Error('offline'));
  await assert.rejects(()=>runAuthorizedImageCopyWindow5(c));
  assert.equal(c.calls.length,0);
});

test('malformed or running response cannot report completed window',async()=>{
  for(const r of [
    {...result,status:'RUNNING'},
    {...result,assetsPlanned:11},
    {...result,assetsCopied:9},
    {...result,bytesCopied:-1}
  ]){
    await assert.rejects(()=>runAuthorizedImageCopyWindow5(client(baseline,r)));
  }
});
