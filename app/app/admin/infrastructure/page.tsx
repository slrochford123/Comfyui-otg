"use client";
import {useEffect,useState} from "react";
import AdminShell,{adminStyles as styles} from "../AdminShell";
type Backup={status:string;source_bytes?:number;pending_files?:number;pending_bytes?:number;verified_files?:number;source_files?:number;last_success?:number;last_restore_test?:number;all_current_files_verified?:boolean;offsiteRecoveryKitVerified?:boolean;coverageUpdatePending?:boolean;progressPercent?:number;error?:string};
type Host={host:string;error?:string;gpu?:{totalMiB?:number;freeMiB?:number;utilization?:number;error?:string};disks?:Array<{label:string;total?:number;available?:number;usedPercent?:number;error?:string}>;comfy?:Array<{label:string;healthy:boolean;running?:number;queued?:number;version?:string}>;queues?:Array<{environment:string;error?:string;counts?:Array<{gpu:string;status:string;count:number}>}>;backup?:Backup};
type Alert={id:string;active:boolean;level:string;message:string;firstSeen:number;lastSeen:number;resolvedAt?:number;delivery:string};
type State={checkedAt:number;stale:boolean;hosts:Host[];alerts?:Alert[];alertDelivery?:string;integrations:Record<string,{status:string;checkedAt?:number;message?:string;totalBytes?:number;freeBytes?:number}>};
const size=(n?:number)=>n===undefined?"Unknown":`${(n/1024**3).toFixed(1)} GiB`;
const when=(n?:number)=>n?new Date(n*1000).toLocaleString():"Not verified";
export default function Infrastructure(){
  const [data,setData]=useState<State|null>(null),[error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();let busy=false;
    async function refresh(){if(busy||document.hidden)return;busy=true;try{
      const response=await fetch("/api/admin/infrastructure",{cache:"no-store",signal:controller.signal});
      if(!response.ok){if(response.status===401||response.status===403)setData(null);throw Error(response.status===503?"Health collector has not reported yet.":"Unable to read admin health.");}
      setData(await response.json());setError("");
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Health unavailable");}finally{busy=false;}}
    void refresh();const timer=setInterval(()=>void refresh(),30000);document.addEventListener("visibilitychange",refresh);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[]);
  return <AdminShell title="Infrastructure" description="GPUs, services and protected backups">
    <p role="status">{error||(!data?"Loading health…":`${data.stale?"Stale report — ":"Updated "}${new Date(data.checkedAt).toLocaleString()}`)}</p>
    <p className={styles.muted}>Participating routes prefer the 3090, then a qualified 5060 Ti. Prepared jobs may remain tied to their original worker. A connection check is not a generation-quality test.</p>
    <section className={styles.card} aria-labelledby="infrastructure-alerts"><h2 id="infrastructure-alerts">Infrastructure alerts</h2>
      <p className={styles.muted}>{data?.alertDelivery||"Checking notification delivery…"}</p>
      {data?.alerts?.some(a=>a.active)?data.alerts.filter(a=>a.active).map(a=><div key={a.id}><p><strong>{a.level==="critical"?"Action needed":"Warning"}:</strong> {a.message}</p><p className={styles.muted}>Since {when(a.firstSeen)}{a.delivery==="retry_pending"?" · Notification delivery pending retry":""}</p></div>):<p>{data?"No active alerts in this report.":"Loading alerts…"}</p>}
      {data?.alerts?.some(a=>!a.active)?<details><summary>Resolved alerts</summary>{data.alerts.filter(a=>!a.active).map(a=><p key={a.id}>{a.message} · Resolved {when(a.resolvedAt)}</p>)}</details>:null}
    </section>
    <div className={styles.grid}>{data?.hosts.map(host=><section className={styles.card} key={host.host}>
      <h2>RTX {host.host==="3090"?"3090":"5060 Ti"}</h2>{host.error?<p role="alert">{host.error}</p>:<>
      <p>{host.gpu?.error||`${((host.gpu?.freeMiB||0)/1024).toFixed(1)} / ${((host.gpu?.totalMiB||0)/1024).toFixed(1)} GiB VRAM free · ${host.gpu?.utilization??"?"}% GPU`}</p>
      {host.comfy?.map(lane=><p key={lane.label}>{lane.label}: {lane.healthy?`${lane.running} running · ${lane.queued} queued · ComfyUI ${lane.version||"unknown"}`:"Unavailable"}</p>)}
      <h3>Storage</h3>{host.disks?.map(d=><div key={d.label}><p>{d.label}: {d.error||`${size(d.available)} free · ${d.usedPercent}% used`}</p>{d.usedPercent!==undefined?<progress aria-label={`${d.label} disk usage`} max={100} value={d.usedPercent} style={{width:"100%"}}/>:null}</div>)}
      <h3>Backups</h3><p>{host.backup?.status?.replaceAll("_"," ")||"Not configured"}</p>
      {host.backup?.progressPercent!==undefined?<progress aria-label={`${host.host} initial backup upload progress`} max={100} value={host.backup.progressPercent} style={{width:"100%"}}/>:null}
      <p>{host.backup?.all_current_files_verified?"Current inventory restored and verified":"Full backup coverage has not been verified"}</p>
      {host.backup?.coverageUpdatePending?<p>Expanded backup coverage will be included in the next run; the current upload is uninterrupted.</p>:null}
      <p>{host.backup?.verified_files??0} / {host.backup?.source_files??"?"} files verified · {size(host.backup?.source_bytes)}</p>
      <p>Waiting for finalized files: {host.backup?.pending_files??0} · {size(host.backup?.pending_bytes)}</p>
      {host.host==="3090"?<p>Both-PC recovery kit: {host.backup?.offsiteRecoveryKitVerified?"Cloud copy downloaded, decrypted and verified":"Owner password setup and cloud restore proof still needed"}</p>:null}
      <p>Last success: {when(host.backup?.last_success)}<br/>Last restore: {when(host.backup?.last_restore_test)}</p>
      {host.backup?.error?<p role="alert">{host.backup.error}</p>:null}
      <details><summary>Application jobs</summary>{host.queues?.map(q=><div key={q.environment}><h3>{q.environment}</h3>{q.error?<p>{q.error}</p>:q.counts?.map(c=><p key={c.gpu+c.status}>{c.gpu} · {c.status}: {c.count}</p>)}</div>)}</details>
      </>}
    </section>)}</div>
    <h2>Connected services</h2><div className={styles.grid}>{Object.entries(data?.integrations||{}).map(([name,service])=><section className={styles.card} key={name}><h3>{name}</h3><p>{service.status}</p><p>{service.message}</p>{service.freeBytes!==undefined?<p>{size(service.freeBytes)} free of {size(service.totalBytes)}</p>:null}<p className={styles.muted}>Checked: {when(service.checkedAt)}</p></section>)}</div>
    <p className={styles.muted}>This page is read-only. It cannot publish Android releases, delete backups or start paid generation.</p>
  </AdminShell>;
}
