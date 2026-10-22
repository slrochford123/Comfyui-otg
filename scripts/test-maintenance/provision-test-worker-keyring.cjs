// Credential provisioning: never emits token values. TEST boundary enforced.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const root='/home/shawn-rochford/AI/runtime/test/config';
const envFile=fs.realpathSync(path.join(root,'app-env/.env.local'));
if(!envFile.startsWith(root+'/'))throw Error('Unexpected environment boundary');
const unit='otg-character-indextts2-dataset-worker.service';
const pid=Number(cp.execFileSync('systemctl',['show',unit,'-p','MainPID','--value'],{encoding:'utf8'}));
const env=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(s=>s.includes('=')).map(s=>{let i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]}));
if(new URL(env.OTG_BASE_URL||'').port!=='3001')throw Error('Worker is not TEST');
const token=env.OTG_WORKER_TOKEN;
if(!token||token.length<24)throw Error('Invalid registered worker credential');
const target=path.join(root,'worker-previous.token');
if(fs.existsSync(target)&&fs.readFileSync(target,'utf8').trim()!==token)throw Error('Refusing unexpected credential replacement');
fs.writeFileSync(target,token+'\n',{mode:0o600});fs.chmodSync(target,0o600);
const original=fs.readFileSync(envFile,'utf8');
const key='OTG_WORKER_PREVIOUS_TOKEN_FILE';
if(!original.split('\n').some(line=>line.startsWith(key+'='))){
  const backup=path.join(root,'app-env-before-worker-keyring.backup');
  if(!fs.existsSync(backup))fs.writeFileSync(backup,original,{mode:0o600});
  fs.writeFileSync(envFile,original+'\n'+key+'='+target+'\n',{mode:0o600});
}
console.log('TEST registered-worker keyring provisioned; no credentials displayed.');
