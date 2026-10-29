import { readComfyQueue } from "@/lib/comfyTransport";
import { cancelQueuedMediaJob, getMediaQueueJob } from "@/lib/workers/mediaGpuQueue";
export type ComfyCancelResult = { status:'canceled'|'canceling'|'completed'; mode:'queued'|'running'|'absent'; confirmedAt?:string };
export class ComfyCancelSafetyError extends Error { status=409; }
const inFlight = new Map<string,Promise<ComfyCancelResult>>();
function id(entry:unknown):string { return Array.isArray(entry)?String(entry[1]||''):''; }
async function json(url:string,init?:RequestInit) {
  const r=await fetch(url,{...init,cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw new Error(`Comfy cancellation verification failed (${r.status}).`);
  return r;
}
const queue = readComfyQueue;
export function cancelComfyPrompt(baseUrl:string,promptId:string,options:{timeoutMs?:number;pollMs?:number}={}):Promise<ComfyCancelResult> {
  if(!promptId)return Promise.reject(new Error('A prompt ID is required to cancel backend work.'));
  const base=baseUrl.replace(/\/+$/,'');const key=base+':'+promptId;
  const previous=inFlight.get(key);if(previous)return previous;
  const task=(async():Promise<ComfyCancelResult>=>{
    if (cancelQueuedMediaJob(promptId,base)) return {status:'canceled',mode:'queued',confirmedAt:new Date().toISOString()};
    const local = getMediaQueueJob(promptId);
    if (local?.status === 'canceled' && local.kind === 'comfy' && (local.payload as {baseUrl:string}).baseUrl === base)
      return {status:'canceled',mode:'queued',confirmedAt:new Date().toISOString()};
    const initial=await queue(base);
    const running=initial.queue_running.some(e=>id(e)===promptId);
    const pending=initial.queue_pending.some(e=>id(e)===promptId);
    const mode=running?'running':pending?'queued':'absent';
    if(running || pending) {
      const response = await fetch(base+'/api/jobs/'+encodeURIComponent(promptId)+'/cancel', {
        method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000),
      });
      if(response.status===404 || response.status===405) {
        // Never fall back to a worker-wide interrupt: between a queue snapshot
        // and interruption, an unrelated prompt may have started.
        if(pending)await json(base+'/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({delete:[promptId]})});
        const checked=await queue(base);
        if(checked.queue_running.some(e=>id(e)===promptId))throw new ComfyCancelSafetyError('Cannot safely interrupt: this worker lacks atomic per-job cancellation. No unrelated work was interrupted.');
      } else if(!response.ok || typeof (await response.json()).cancelled !== 'boolean') {
        throw new Error('ComfyUI did not confirm a valid per-job cancellation request.');
      }
    }
    const deadline=Date.now()+(options.timeoutMs??30000);let cleared=0;
    do {
      const q=await queue(base);
      if([...q.queue_running,...q.queue_pending].some(e=>id(e)===promptId))cleared=0;
      else if(++cleared>=2) {
        const h=await (await json(base+'/history/'+encodeURIComponent(promptId))).json();
        const record=h[promptId];
        const completed=record?.status?.completed===true&&record?.status?.status_str==='success';
        if(mode==='absent' && !record)throw new ComfyCancelSafetyError('The prompt is absent from queue and history; cancellation cannot be confirmed. Reconcile the original job without resubmitting.');
        return {status:completed?'completed':'canceled',mode,confirmedAt:new Date().toISOString()};
      }
      await new Promise(r=>setTimeout(r,options.pollMs??500));
    }while(Date.now()<deadline);
    return {status:'canceling',mode};
  })();inFlight.set(key,task);void task.finally(()=>inFlight.delete(key)).catch(()=>{});return task;
}
