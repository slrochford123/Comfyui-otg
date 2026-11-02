// One bounded Fibo Turbo image-edit regression per explicitly selected GPU.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {audioTestClient} from '../audio-editing-test-client.mjs';
const gpu=process.env.AUDIO_QA_GPU;
assert(['rtx3090','rtx5060ti'].includes(gpu));
const c=await audioTestClient();
const out=fs.mkdtempSync('/home/shawn-rochford/AI/research/release-qualification-20261101-DYHhxBWc/image-'+gpu+'-');
const report={ok:false,gpu,checks:[],outputs:[]};
try {
  const input=await sharp(Buffer.from('<svg width="384" height="384"><rect width="384" height="384" fill="#dfdfdf"/><rect x="100" y="100" width="184" height="184" fill="#e13939"/></svg>')).png().toBuffer();
  fs.writeFileSync(path.join(out,'source.png'),input);
  const form=new FormData();
  form.set('model','fibo2-edit-turbo');form.set('prompt','Change the red square to a blue square. Preserve the gray background and simple centered composition.');
  form.set('width','384');form.set('height','384');form.set('seed','424242');form.set('clientRequestId',crypto.randomUUID());
  form.set('image',new File([input],'source.png',{type:'image/png'}));
  const start=performance.now(),created=await c.postForm('/api/images/native',form);
  report.jobId=created.jobId;report.promptId=created.promptId;
  const expected=gpu==='rtx3090'?'http://100.75.162.64:8189':'http://100.98.212.116:8188';
  assert.equal(created.comfyBaseUrl,expected);
  report.checks.push('Manual GPU selection resolves to the correct physical worker');
  let done;
  for(let i=0;i<450;i++){
    const job=await c.request('/api/images/native?jobId='+created.jobId);
    if(job.status==='completed'){done=job;break;}
    assert(!['failed','canceled'].includes(job.status),job.error||job.status);
    await new Promise(r=>setTimeout(r,2000));
  }
  assert(done,'Image did not complete within 15 minutes; do not retry automatically');
  const output=path.join(out,'edited.png');await c.download({url:done.imageUrl},output);
  const meta=await sharp(output).metadata();assert.equal(meta.width,384);assert.equal(meta.height,384);
  const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  assert.notEqual(hash(fs.readFileSync(output)),hash(input));
  report.outputs.push({file:output,sha256:hash(fs.readFileSync(output)),width:meta.width,height:meta.height});
  report.totalSeconds=(performance.now()-start)/1000;
  report.checks.push('Real four-step image edit completes and exact job output downloads as a distinct PNG');
  const history=await fetch(expected+'/history/'+created.promptId).then(r=>r.json());
  assert(history[created.promptId]?.outputs?.['461']?.images?.length);
  report.checks.push('Delivered image has a completed matching ComfyUI output-node history');
  report.ok=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await c.logout();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,out,error:report.error}));}
