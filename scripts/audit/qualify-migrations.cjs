// Read live TEST databases only; exercise the packaged migration against copies.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const Database=require('better-sqlite3');
const evidence=path.resolve(process.argv[2]||'');
if(!evidence.startsWith('/home/shawn-rochford/AI/research/test-audit-remediation-'))throw Error('Expected audit directory');
const plan=JSON.parse(fs.readFileSync(path.join(evidence,'test-activation-plan.json'),'utf8'));
(async()=>{
  const pid=execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}).trim();
  const liveEnv=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
  const live='/home/shawn-rochford/AI/runtime/test/data';
  if(liveEnv.OTG_ENV!=='test'||liveEnv.OTG_DATA_DIR!==live)throw Error('TEST boundary changed');
  const root=fs.mkdtempSync(path.join(evidence,'package-migration-'));fs.chmodSync(root,0o700);
  for(const name of ['otg.db','story-creator/story-creator.sqlite','openai/usage.sqlite']){
    const source=path.join(live,name);if(!fs.existsSync(source))continue;
    const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    const db=new Database(source,{readonly:true,fileMustExist:true});try{await db.backup(target);}finally{db.close();}fs.chmodSync(target,0o600);
  }
  if(fs.existsSync(path.join(live,'openai/usage.json'))){fs.mkdirSync(path.join(root,'openai'),{recursive:true,mode:0o700});fs.copyFileSync(path.join(live,'openai/usage.json'),path.join(root,'openai/usage.json'));fs.chmodSync(path.join(root,'openai/usage.json'),0o600);}
  const env={PATH:process.env.PATH,HOME:process.env.HOME,OTG_ENV:'test',OTG_DATA_DIR:root,OTG_DATA_ROOT:root,OPENAI_API_KEY:'',OPENAI_KILL_SWITCH:'true',NODE_OPTIONS:'--require='+path.join(plan.candidate,'scripts/audit/offline-guard.cjs')};
  for(const key of ['ADMIN_IDENTIFIERS','ADMIN_EMAILS','ADMIN_USER_IDS'])if(liveEnv[key])env[key]=liveEnv[key];
  const result=JSON.parse(execFileSync(process.execPath,['-r',path.join(plan.candidate,'scripts/register-ts-worker.cjs'),path.join(evidence,'activation-helpers/migrate-candidate.cjs'),plan.candidate],{cwd:plan.candidate,env,encoding:'utf8'}));
  fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({...result,root,buildId:plan.buildId,liveDatabaseChanged:false},null,2),{mode:0o600});
  console.log(JSON.stringify({...result,root,liveDatabaseChanged:false}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
