import {afterEach,describe,expect,it,vi} from 'vitest';
import {cancelComfyPrompt} from '@/lib/comfySafeCancel';
afterEach(()=>vi.unstubAllGlobals());
const entry=(id:string)=>[0,id,{},{}];
function backend(initial:{running:string[],pending:string[]},clear=true,atomic=true) {
  let running=[...initial.running],pending=[...initial.pending];
  const mock=vi.fn(async(input:string,init?:RequestInit)=>{
    const url=String(input);
    if(url.includes('/api/jobs/')) {
      if(!atomic)return new Response('',{status:404});
      const target=decodeURIComponent(url.split('/api/jobs/')[1].split('/')[0]);
      pending=pending.filter(x=>x!==target);if(clear)running=running.filter(x=>x!==target);
      return Response.json({cancelled:clear});
    }
    if(url.endsWith('/interrupt')) { if(clear)running=[];return new Response('{}'); }
    if(url.endsWith('/queue')&&init?.method==='POST'){ const ids=JSON.parse(String(init.body)).delete;pending=pending.filter(x=>!ids.includes(x));return new Response('{}'); }
    if(url.endsWith('/queue'))return Response.json({queue_running:running.map(entry),queue_pending:pending.map(entry)});
    return Response.json({});
  });vi.stubGlobal('fetch',mock);return mock;
}
describe('truthful Comfy cancellation',()=>{
  it('removes only the requested queued prompt without interrupting a different running job',async()=>{const f=backend({running:['other'],pending:['mine','other-queued']},true,false);expect((await cancelComfyPrompt('http://worker','mine',{pollMs:0})).status).toBe('canceled');expect(f.mock.calls.filter(c=>String(c[0]).endsWith('/interrupt'))).toHaveLength(0);expect(JSON.parse(String(f.mock.calls.find(c=>c[0].endsWith('/queue')&&c[1]?.method==='POST')?.[1]?.body))).toEqual({delete:['mine']});});
  it('uses atomic per-job cancel and confirms queue clearance',async()=>{const f=backend({running:['mine'],pending:['unrelated']});const r=await cancelComfyPrompt('http://worker','mine',{pollMs:0});expect(r.status).toBe('canceled');expect(r.confirmedAt).toBeTruthy();expect(f.mock.calls.some(c=>String(c[0]).endsWith('/api/jobs/mine/cancel'))).toBe(true);expect(f.mock.calls.some(c=>String(c[0]).endsWith('/interrupt'))).toBe(false);});
  it('refuses unsafe interruption on older workers',async()=>{const f=backend({running:['mine'],pending:['unrelated']},true,false);await expect(cancelComfyPrompt('http://worker','mine',{pollMs:0})).rejects.toThrow('Cannot safely interrupt');expect(f.mock.calls.some(c=>String(c[0]).endsWith('/interrupt'))).toBe(false);});
  it('does not report canceled while execution remains active',async()=>{backend({running:['mine'],pending:[]},false);expect((await cancelComfyPrompt('http://worker','mine',{timeoutMs:2,pollMs:1})).status).toBe('canceling');});
  it('does not treat an unavailable/malformed queue as cleared',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({})));await expect(cancelComfyPrompt('http://worker','mine',{pollMs:0})).rejects.toThrow('queue state is unavailable');});
  it('coalesces duplicate cancel requests',async()=>{const f=backend({running:['mine'],pending:[]});await Promise.all([cancelComfyPrompt('http://worker','mine',{pollMs:0}),cancelComfyPrompt('http://worker','mine',{pollMs:0})]);expect(f.mock.calls.filter(c=>String(c[0]).endsWith('/api/jobs/mine/cancel'))).toHaveLength(1);});
  it('does not call a missing prompt canceled without evidence',async()=>{backend({running:[],pending:[]});await expect(cancelComfyPrompt('http://worker','missing',{pollMs:0})).rejects.toThrow('cannot be confirmed');});
});
