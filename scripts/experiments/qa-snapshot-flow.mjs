// Real browser frame capture and private upload; no generated content or GPU.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export async function checkSnapshotFlow({page,panel,user,call,state,out,sid,record}) {
  const source=path.join(out,'snapshot-colors.mp4');
  execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=red:size=1920x1080:rate=24:duration=1','-f','lavfi','-i','color=blue:size=1920x1080:rate=24:duration=1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p',source]);
  const sourceHash=hash(fs.readFileSync(source)),initial=(await state()).find(s=>s.id===sid),uploadsBefore=initial.assets.length;
  const dialog=page.getByRole('dialog',{name:'Snapshot from Video',exact:true});
  await panel.getByRole('button',{name:'Snapshot',exact:true}).click();
  await dialog.getByRole('button',{name:'Close Snapshot',exact:true}).click();
  assert.equal((await state()).find(s=>s.id===sid).assets.length,uploadsBefore);
  async function open() {
    await panel.getByRole('button',{name:'Snapshot',exact:true}).click();
    assert.equal(await dialog.getByRole('button',{name:'Close Snapshot',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Snapshot close button must be above the app header');
    await dialog.locator('input[type="file"]').setInputFiles(source);
    await page.waitForFunction(()=>{const v=document.querySelector('[data-otg="video-snapshot-picker"] video');return v?.readyState>=2&&v.duration===2;});
    await dialog.getByRole('button',{name:'Use Snapshot',exact:true}).waitFor();
  }
  async function capture(action,expectedTime,color) {
    const before=(await state()).find(s=>s.id===sid).assets.map(a=>a.id);
    const done=page.waitForResponse(r=>r.url().includes('/api/h3/nsfw/assets?')&&r.request().method()==='POST');
    await dialog.getByRole('button',{name:action,exact:true}).click();assert.equal((await done).status(),201);
    await dialog.waitFor({state:'hidden'});await panel.getByText('Saved',{exact:true}).waitFor();
    const session=(await state()).find(s=>s.id===sid),added=session.assets.filter(a=>!before.includes(a.id));assert.equal(added.length,1);
    const asset=added[0];assert.equal(asset.mime,'image/jpeg');assert(asset.name.includes(expectedTime),asset.name);
    const response=await call(user,'/api/h3/nsfw/assets?id='+asset.id);assert.equal(response.status(),200);const bytes=await response.body();
    const meta=await sharp(bytes).metadata();assert.equal(meta.format,'jpeg');assert.equal(meta.width,1536);assert.equal(meta.height,864);
    const stats=await sharp(bytes).stats();assert(stats.channels[color==='red'?0:2].mean>200);assert(stats.channels[color==='red'?2:0].mean<30);
    assert.equal(hash(bytes),asset.sha256);fs.writeFileSync(path.join(out,asset.name),bytes);
    return {asset,session};
  }
  await open();await dialog.getByLabel('Snapshot video position',{exact:true}).fill('1.25');
  await page.waitForFunction(()=>{const v=document.querySelector('[data-otg="video-snapshot-picker"] video');return v&&!v.seeking&&Math.abs(v.currentTime-1.25)<0.001;});
  await page.screenshot({path:path.join(out,'snapshot-mobile-picker.png'),fullPage:false});
  const downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download Snapshot',exact:true}).click();
  const download=await downloadEvent;assert.match(download.suggestedFilename(),/00-01-250\.jpg$/);const downloadPath=path.join(out,'snapshot-downloaded.jpg');await download.saveAs(downloadPath);
  const downloadStats=await sharp(downloadPath).stats();assert(downloadStats.channels[2].mean>200);
  await page.route('**/api/h3/nsfw/assets?*',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'QA snapshot upload unavailable'})}):route.continue());
  await dialog.getByRole('button',{name:'Use Snapshot',exact:true}).click();await dialog.getByText('The frame was captured but could not be inserted. Try again.',{exact:true}).waitFor();
  assert.deepEqual((await state()).find(s=>s.id===sid).settings.selectedSources,initial.settings.selectedSources);assert.equal((await state()).find(s=>s.id===sid).assets.length,uploadsBefore);
  await page.unroute('**/api/h3/nsfw/assets?*');
  let release;let posts=0;
  await page.route('**/api/h3/nsfw/assets?*',async route=>{if(route.request().method()==='POST'){posts++;await new Promise(r=>release=r);}await route.continue();});
  const currentCapture=capture('Use Snapshot','00-01-250','blue');
  for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,50));assert(release,'Upload should start');
  assert.equal(await dialog.getByRole('button',{name:'Use Snapshot',exact:true}).isDisabled(),true);
  assert.equal(await dialog.getByRole('button',{name:'Close Snapshot',exact:true}).isDisabled(),true);
  await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);release();
  const current=await currentCapture;await page.unroute('**/api/h3/nsfw/assets?*');assert.equal(posts,1);
  assert.deepEqual(current.session.settings.selectedSources,[...initial.settings.selectedSources,current.asset.id]);
  await panel.getByRole('button',{name:'Remove '+current.asset.name,exact:true}).click();await panel.getByRole('article',{name:'Reference '+current.asset.name,exact:true}).waitFor({state:'hidden'});
  await panel.getByRole('button',{name:'Undo removal',exact:true}).click();await panel.getByRole('article',{name:'Reference '+current.asset.name,exact:true}).waitFor();await panel.getByText('Saved',{exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:'H3 NSFW',exact:true}).click();await panel.getByRole('article',{name:'Reference '+current.asset.name,exact:true}).waitFor();
  await panel.getByRole('button',{name:'Image',exact:true}).click();await open();const first=await capture('Use First Frame','00-00-000','red');
  assert.deepEqual(first.session.settings.selectedSources,[first.asset.id]);assert.equal(first.session.assets.length,uploadsBefore+2);
  await open();const last=await capture('Use Last Frame','00-01-999','blue');assert.deepEqual(last.session.settings.selectedSources,[last.asset.id]);
  assert.equal(last.session.assets.length,uploadsBefore+3);assert.equal(hash(fs.readFileSync(source)),sourceHash);
  assert.equal((await(await call(user,'/api/h3/nsfw?jobs='+sid)).json()).jobs.length,0);
  await panel.getByRole('button',{name:'Reference',exact:true}).click();await panel.getByText('Saved',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'snapshot-added-mobile.png'),fullPage:true});
  record('Snapshot: real scrubbed/first/last JPEG pixels, 1536px aspect-preserving bound, download, upload failure/retry, duplicate/close guards, remove/undo/reload, single-image replacement; no GPU jobs');
  return {assetId:last.asset.id,sha256:last.asset.sha256,sourceUnchanged:true,firstFrameRed:true,lastAndScrubbedBlue:true,download:true,reload:true};
}
