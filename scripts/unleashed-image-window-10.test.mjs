import test from 'node:test';
import assert from 'node:assert/strict';
import {runAuthorizedImageCopyWindow10, IMAGE_COPY_WINDOW_10} from '../src/features/team/unleashedImageCopyWindow10.ts';

const baseline={
  id:'d1b76f79-7da9-44be-94d5-9462e4c4be8e',
  status:'SUCCEEDED',
  assets_planned:10,
  assets_copied:10,
  assets_reused:0,
  assets_failed:0,
  bytes_copied:2240093,
  authorization_id:'9719f6ff-f1bf-4b3d-ae45-02bfca8a2f9c'
};
const result={runId:'w10',status:'SUCCEEDED',assetsPlanned:10,assetsCopied:10,assetsReused:0,assetsFailed:0,bytesCopied:100,errorCode:null,replayed:false};

function client(row=baseline,response=result,readError=null){
  const calls=[];
  return {
    calls,
    from:()=>({select:()=>({eq:()=>({single:async()=>({data:row,error:readError})})})}),
    functions:{invoke:async(...args)=>{calls.push(args);return {data:response,error:null};}}
  };
}

test('only exact successful predecessor permits bounded W10 command',async()=>{
  const c=client();
  await runAuthorizedImageCopyWindow10(c);
  assert.equal(c.calls.length,1);
  assert.equal(c.calls[0][0],'trigger-unleashed-master-migration');
  assert.equal(c.calls[0][1].body.commandId,IMAGE_COPY_WINDOW_10.commandId);
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
    await assert.rejects(()=>runAuthorizedImageCopyWindow10(c));
    assert.equal(c.calls.length,0);
  }
  const c=client(baseline,result,new Error('offline'));
  await assert.rejects(()=>runAuthorizedImageCopyWindow10(c));
  assert.equal(c.calls.length,0);
});

test('malformed or running response cannot report completed window',async()=>{
  for(const r of [
    {...result,status:'RUNNING'},
    {...result,assetsPlanned:11},
    {...result,assetsCopied:9},
    {...result,bytesCopied:-1}
  ]){
    await assert.rejects(()=>runAuthorizedImageCopyWindow10(client(baseline,r)));
  }
});
