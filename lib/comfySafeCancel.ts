type Queue = { queue_running: unknown[]; queue_pending: unknown[] };
export type ComfyCancelResult = { status:'canceled'|'canceling'|'completed'; mode:'queued'|'running'|'absent'; confirmedAt?:string };
export class ComfyCancelSafetyError extends Error { status=409; }
const inFlight = new Map<string,Promise<ComfyCancelResult>>();
function id(entry:unknown):string { return Array.isArray(entry)?String(entry[1]||''):''; }
async function json(url:string,init?:RequestInit) {
  const r=await fetch(url,{...init,cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw new Error(`Comfy cancellation verification failed (${r.status}).`);
  return r;
}
async function queue(base:string):Promise<Queue> {
  const q=await (await json(base+'/queue')).json();
  if(!Array.isArray(q.queue_running)||!Array.isArray(q.queue_pending))throw new Error('Comfy queue state is unavailable. Cancellation is not confirmed.');
  return q;
}
export function cancelComfyPrompt(baseUrl:string,promptId:string,options:{timeoutMs?:number;pollMs?:number}={}):Promise<ComfyCancelResult> {
  if(!promptId)return Promise.reject(new Error('A prompt ID is required to cancel backend work.'));
  const base=baseUrl.replace(/\/+$/,'');const key=base+':'+promptId;
  const previous=inFlight.get(key);if(previous)return previous;
  const task=(async():Promise<ComfyCancelResult>=>{
    const initial=await queue(base);
    const running=initial.queue_running.some(e=>id(e)===promptId);
    const pending=initial.queue_pending.some(e=>id(e)===promptId);
    const mode=running?'running':pending?'queued':'absent';
    if(pending)await json(base+'/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({delete:[promptId]})});
    // Recheck immediately before interruption. Older workers may ignore prompt_id,
    // so a worker-wide interrupt is permitted only with no unrelated queued work.
    const checked=await queue(base);
    if(checked.queue_running.some(e=>id(e)===promptId)) {
      if([...checked.queue_running,...checked.queue_pending].some(e=>id(e)!==promptId))throw new ComfyCancelSafetyError('Cannot safely interrupt this running job while another task is using the worker. Queued jobs can be removed individually.');
      await json(base+'/interrupt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt_id:promptId})});
    }
    const deadline=Date.now()+(options.timeoutMs??30000);let cleared=0;
    do {
      const q=await queue(base);
      if([...q.queue_running,...q.queue_pending].some(e=>id(e)===promptId))cleared=0;
      else if(++cleared>=2) {
        const h=await (await json(base+'/history/'+encodeURIComponent(promptId))).json();
        const record=h[promptId];
        const completed=record?.status?.completed===true&&record?.status?.status_str==='success';
        return {status:completed?'completed':'canceled',mode,confirmedAt:new Date().toISOString()};
      }
      await new Promise(r=>setTimeout(r,options.pollMs??500));
    }while(Date.now()<deadline);
    return {status:'canceling',mode};
  })();inFlight.set(key,task);void task.finally(()=>inFlight.delete(key)).catch(()=>{});return task;
}
