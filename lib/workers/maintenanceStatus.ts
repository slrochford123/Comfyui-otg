type LocalStatus = {services: {comfy8188:{state:string;http:string};h38189:{state:string;http:string}}};
export async function with3090QueueStatus<T extends LocalStatus>(status:T, fetcher:typeof fetch=fetch):Promise<T> {
  const services={...status.services};
  await Promise.all(([['comfy8188','http://100.75.162.64:8188'],['h38189','http://100.75.162.64:8189']] as const).map(async([key,base])=>{
    const service={...services[key]};services[key]=service;
    if(service.state!=='active'){if(service.http==='ready')service.http='unverified';return;}
    try {
      const response=await fetcher(base+'/queue',{cache:'no-store',signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('Queue unavailable');
      const queue=await response.json();
      if(!Array.isArray(queue.queue_running)||!Array.isArray(queue.queue_pending))throw Error('Queue invalid');
      service.http=queue.queue_running.length||queue.queue_pending.length?'busy':service.http==='ready'?'ready':'unverified';
    }catch{service.http='unverified';}
  }));
  return {...status,services};
}
