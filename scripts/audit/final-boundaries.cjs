// Read-only system/queue snapshot. No generation, cancellation, restart or mutation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const evidence=path.resolve(process.argv[2]||'');if(!evidence.startsWith('/home/shawn-rochford/AI/research/test-audit-remediation-'))throw Error('Expected evidence directory');
const cmd=(program,args)=>execFileSync(program,args,{encoding:'utf8',timeout:30000}).trim();
const workers=['http://100.75.162.64:8188','http://100.75.162.64:8189','http://100.98.212.116:8188'];
const get=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();};
(async()=>{
  const services=Object.fromEntries(['otg-test.service','otg-comfyui.service','otg-comfyui-h3.service'].map(unit=>[unit,{pid:Number(cmd('systemctl',['show',unit,'-p','MainPID','--value'])),active:cmd('systemctl',['is-active',unit])}]));
  const health=await fetch('http://100.75.162.64:3001/api/healthz',{signal:AbortSignal.timeout(6000)});await health.arrayBuffer();
  const queues=[];for(const base of workers){const q=await get(base+'/queue');queues.push({base,running:q.queue_running.length,pending:q.queue_pending.length});}
  const data='/home/shawn-rochford/AI/runtime/test/data';
  const historic=[];for(const name of ['otg-ltx25-flf-smoke','otg-ltx25-i2v-smoke','otg-ltx25-smoke','test-wan-live-contract','test_profile']){
    const file=path.join(data,'content_state',name+'.json');if(!fs.existsSync(file))continue;
    const bytes=fs.readFileSync(file),state=JSON.parse(bytes);const histories=[];
    for(const base of workers){try{const h=await get(base+'/history/'+encodeURIComponent(state.promptId));histories.push({base,exists:Boolean(h[state.promptId])});}catch(e){histories.push({base,error:String(e.message)});}}
    historic.push({name,status:state.status,promptId:state.promptId,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),recordedOutput:Boolean(state.fileName),histories,changed:false});
  }
  const remote=cmd('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','otg-slr',"/usr/bin/python3 -c 'import json,subprocess,os,urllib.request; print(json.dumps({\"pid\":int(subprocess.check_output([\"systemctl\",\"show\",\"otg-prod.service\",\"-p\",\"MainPID\",\"--value\"])),\"release\":os.path.realpath(\"/opt/otg/current-prod\"),\"health\":urllib.request.urlopen(\"http://127.0.0.1:3000/api/healthz\",timeout=5).status,\"disk\":subprocess.check_output([\"df\",\"-B1\",\"--output=target,size,avail,pcent\",\"/\",\"/mnt/otg_fast\",\"/mnt/otg_bulk\"],text=True)}))'"]);
  const result={timestamp:new Date().toISOString(),readOnly:true,services,testRelease:fs.realpathSync('/home/shawn-rochford/AI/deploy/otg-test/current'),testHealth:health.status,queues,prod:JSON.parse(remote),historicState:historic,qaListener3339:cmd('ss',['-ltnH','sport = :3339']),jobsChanged:false,servicesChanged:false};
  fs.writeFileSync(path.join(evidence,'final-boundaries.json'),JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({...result,historicState:historic.map(x=>({name:x.name,status:x.status,historyExists:x.histories.some(h=>h.exists),changed:x.changed}))},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
