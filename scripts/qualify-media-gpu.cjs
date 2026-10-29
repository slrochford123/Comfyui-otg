/* Real built-app HTTP qualification, controlled synthetic workers. No AI inference. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {WebSocketServer}=require('ws');
const root=path.resolve(process.argv[2]||'');
assert(/^\/home\/shawn-rochford\/AI\/research\/media-gpu-routing-20261029-[A-Za-z0-9]+$/.test(root));
const final=process.argv.includes('--final');
const candidate=path.join(root,final?'qa-candidate-final':'qa-candidate'),data=path.join(root,final?'http-qa-data-final':'http-qa-data');
assert(!fs.existsSync(data),'Use fresh HTTP evidence storage.');fs.mkdirSync(data,{mode:0o700});
const report={kind:'Actual built-app HTTP with synthetic Comfy workers',gpuInferencePerformed:false,checks:[]};
const check=name=>{report.checks.push({name,passed:true});console.log(name);};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const states=[];let app;const base='http://127.0.0.1:3309';
const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',OTG_ENV:'test',OTG_AUDIO_ISOLATED_DEV:'1',
  OTG_MEDIA_GPU_ROUTING:'1',OTG_DATA_DIR:data,OTG_WORKER_CONTROL_STORE_DIR:path.join(data,'worker-control'),
  AUTH_SECRET:crypto.randomBytes(48).toString('hex'),NEXT_TELEMETRY_DISABLED:'1',PORT:'3309',HOSTNAME:'127.0.0.1',
  OTG_CLUSTER_COMFY_GENERATION_PORTS:'3311,3312,3313',OTG_5060_COMFY_HOSTS:'127.0.0.2',OTG_3090_COMFY_HOSTS:'127.0.0.1',
  OTG_MEDIA_3090_IMAGE_URL:'http://127.0.0.1:3311',OTG_MEDIA_3090_H3_URL:'http://127.0.0.1:3312',OTG_MEDIA_5060_URL:'http://127.0.0.2:3313'};
const urls=['http://127.0.0.1:3311','http://127.0.0.1:3312','http://127.0.0.2:3313'];
const config=JSON.parse(fs.readFileSync(path.join(candidate,'config/comfy-backends.json')));
config.backends=config.backends.filter(b=>['rtx3090','rtx5060ti'].includes(b.id)).map(b=>({...b,url:b.id==='rtx3090'?urls[0]:urls[2]}));
env.OTG_COMFY_BACKENDS_FILE=path.join(root,'http-fixture-backends.json');fs.writeFileSync(env.OTG_COMFY_BACKENDS_FILE,JSON.stringify(config));
const log=fs.openSync(path.join(root,final?'http-qa-server-final.log':'http-qa-server.log'),'a',0o600);
async function stopApp(){if(app&&app.exitCode===null){const done=once(app,'exit');app.kill('SIGTERM');const timer=setTimeout(()=>app.kill('SIGKILL'),8000);await done;clearTimeout(timer);}}
async function startApp(){app=spawn(process.execPath,['server.js'],{cwd:candidate,env,stdio:['ignore',log,log]});for(let i=0;i<150;i++){if(app.exitCode!==null)throw Error('QA app exited');try{if((await fetch(base+'/api/healthz')).ok)return;}catch{}await sleep(100);}throw Error('QA startup timed out');}
let accountCount=0;
async function account(){const first=accountCount++===0;
  const username=first&&process.env.OTG_MEDIA_GPU_UI_USER||'gpuqa_'+crypto.randomBytes(4).toString('hex'),
    password=first&&process.env.OTG_MEDIA_GPU_UI_PASSWORD||crypto.randomBytes(24).toString('base64url');
  const options={method:'POST',headers:{'content-type':'application/json'}};
  assert((await fetch(base+'/api/auth/signup',{...options,body:JSON.stringify({username,email:username+'@test.invalid',password})})).ok);
  const response=await fetch(base+'/api/auth/login',{...options,body:JSON.stringify({identifier:username,password})});assert(response.ok);
  return {username,cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};}
function request(owner,route,choice='auto',body){return fetch(base+route,{method:body?'POST':'GET',headers:{cookie:`${owner.cookie}; otg_media_gpu_v1=${choice}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
async function submit(owner,choice='auto'){const response=await request(owner,'/api/comfy',choice,{workflowId:'presets/image_z_image_turbo',requestKind:'create image',
  title:'Isolated GPU routing QA',prompt:{'1':{class_type:'EmptyImage',inputs:{width:64,height:64,batch_size:1,color:2351750}},'2':{class_type:'SaveImage',inputs:{images:['1',0],filename_prefix:'qa'}}}});
  const result=await response.json();assert(response.ok,JSON.stringify(result));assert(result.prompt_id);return result.prompt_id;}
async function until(test){for(let i=0;i<100;i++){if(await test())return;await sleep(100);}throw Error('Timed out waiting for queued job evidence.');}
(async()=>{
  const png=await require('sharp')({create:{width:64,height:64,channels:3,background:'green'}}).png().toBuffer();
  for(let index=0;index<3;index++){
    const state={busy:false,hold:false,posts:[],running:[],history:new Map(),server:null,sockets:null};states.push(state);
    const server=http.createServer(async(req,res)=>{
      const route=new URL(req.url,'http://worker').pathname;res.setHeader('content-type','application/json');
      if(route==='/system_stats')return res.end(JSON.stringify({devices:[{name:index===2?'NVIDIA GeForce RTX 5060 Ti':'NVIDIA GeForce RTX 3090',type:'cuda',torch_vram_total:0}]}));
      if(route==='/queue')return res.end(JSON.stringify({queue_running:state.busy?[[0,'external']]:state.running.map(id=>[0,id]),queue_pending:[]}));
      if(route.startsWith('/history')){const id=route.split('/').pop();return res.end(JSON.stringify(state.history.has(id)?{[id]:state.history.get(id)}:{}));}
      if(route==='/free')return res.end('{}');
      if(route==='/view'){res.setHeader('content-type','image/png');res.setHeader('content-length',png.length);return res.end(png);}
      if(route==='/prompt'){
        let bytes='';for await(const chunk of req)bytes+=chunk;const body=JSON.parse(bytes),id=body.prompt_id;
        state.posts.push(id);state.running.push(id);res.end(JSON.stringify({prompt_id:id,node_errors:{}}));
        setTimeout(()=>{state.running=state.running.filter(value=>value!==id);state.history.set(id,{status:{completed:true,status_str:'success'},outputs:{'2':{images:[{filename:id+'.png',type:'output',subfolder:''}]}}});},300);
        return;
      }
      res.writeHead(404);res.end('{}');
    });
    state.server=server;state.sockets=new WebSocketServer({server});
    server.listen(3311+index,index===2?'127.0.0.2':'127.0.0.1');await once(server,'listening');
  }
  await startApp();const owner=await account(),other=await account();
  assert.equal((await fetch(base+'/api/media-gpu')).status,401);
  const ready=await(await request(owner,'/api/media-gpu')).json();assert.equal(ready.enabled,true);check('Authenticated GPU controls enabled; anonymous access rejected');
  const first=await submit(owner);await until(()=>states[0].posts.includes(first));check('Automatic selects idle 3090');
  await until(()=>states[0].history.has(first));
  states[0].busy=true;
  const second=await submit(owner);await until(()=>states[2].posts.includes(second));check('Automatic uses 5060 Ti while 3090 is busy');
  await until(()=>states[2].history.has(second));
  const pinned=await submit(owner,'rtx3090');await sleep(2500);
  assert(!states.some(state=>state.posts.includes(pinned)));
  const mine=await(await request(owner,'/api/media-gpu')).json();assert(mine.jobs.some(job=>job.id===pinned&&job.gpu==='rtx3090'&&job.status==='queued'));
  assert.equal((await request(other,'/api/media-gpu','auto',{action:'cancel',id:pinned})).status,404);
  assert((await request(owner,'/api/media-gpu','auto',{action:'cancel',id:pinned})).ok);check('Manual pins busy 3090; queued job visible and only its owner can cancel');
  states[0].busy=false;
  states[2].busy=true;const pending=await submit(owner,'rtx5060ti');await stopApp();await startApp();states[2].busy=false;
  await until(()=>states[2].posts.includes(pending));assert.equal(states.flatMap(state=>state.posts).filter(id=>id===pending).length,1);check('Queued request survives web-process restart and executes once on its pinned GPU');
  await until(()=>states[2].history.has(pending));
  let delivered;await until(async()=>{delivered=await(await request(owner,'/api/progress?promptId='+pending)).json();return delivered.prompt_complete;});
  assert(delivered.fileName);const response=await request(owner,'/api/gallery/file?scope=user&name='+encodeURIComponent(delivered.fileName));
  assert(Buffer.from(await response.arrayBuffer()).equals(png));check('Completed queued output reaches the owner gallery and downloads byte-exactly');
  report.passed=true;
  if(process.argv.includes('--hold')){
    console.log(JSON.stringify({privateBrowserQa:base+'/app',harnessPid:process.pid}));
    await new Promise(resolve=>process.once('SIGTERM',resolve));
  }
})().catch(error=>{report.passed=false;report.error=String(error.stack||error);console.error(report.error);process.exitCode=1;}).finally(async()=>{
  await stopApp();for(const state of states){for(const socket of state.sockets.clients)socket.terminate();state.sockets.close();state.server.close();}
  fs.closeSync(log);fs.writeFileSync(path.join(root,final?'http-qualification-final.json':'http-qualification.json'),JSON.stringify(report,null,2),{mode:0o600});
});
