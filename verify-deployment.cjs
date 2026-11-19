const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
async function main(){
  const env=process.env;
  assert.equal(env.OTG_ENV,'prod');
  const flags=['OTG_OPENAI_CONVERSATION_CREDITS','OTG_PRODUCTION_ALLOWANCE_READY','OTG_SHARED_3060_PRODUCTION','OTG_SHARED_3060_FENCE','OTG_LOCAL_AI_3060','OTG_PRIVATE_RESEARCH_MEDIA','OTG_MEDIA_GPU_ROUTING','OTG_PRODUCTION_STUDIO_ENABLED','OTG_STORY_MEDIA_ENABLED'];
  assert(flags.every(key=>env[key]==='1'),'Production safety flag missing');
  assert(Number.isFinite(Number(env.OPENAI_DAILY_GLOBAL_COST_LIMIT_USD))&&Number(env.OPENAI_DAILY_GLOBAL_COST_LIMIT_USD)>0,'Positive global cap required');
  assert(env.OPENAI_API_KEY && env.AUTH_SECRET,'Production credentials are required');
  for(const k of ['OTG_DATA_DIR','OTG_DATA_ROOT','OTG_MEDIA_GPU_QUEUE_DB','OTG_MEDIA_ADMISSION_CONFIG','OTG_COMFY_INSTANCE_PROBE_CONFIG','OTG_3060_ADMISSION_CONFIG'])
    assert(path.isAbsolute(env[k]||''),`Expected absolute ${k}`);
  const data=fs.realpathSync(env.OTG_DATA_DIR);
  assert.equal(data,fs.realpathSync(env.OTG_DATA_ROOT));
  const config=JSON.parse(fs.readFileSync('/etc/slr/3060-fence.json','utf8'));
  const adm=JSON.parse(fs.readFileSync(env.OTG_3060_ADMISSION_CONFIG,'utf8'));
  assert.equal(config.authority,env.OTG_3060_AUTHORITY_ID);
  assert.equal(adm.authorityId,config.authority);
  assert.equal(fs.realpathSync(path.join(path.dirname(adm.script),'admission.sqlite')),fs.realpathSync(config.ledger));
  assert.equal(path.resolve(env.OTG_MEDIA_GPU_QUEUE_DB),path.resolve(config.queues.prod));
  const queuedData=fs.realpathSync(path.dirname(path.dirname(path.resolve(config.queues.prod))));
  const visibleStat=fs.statSync(data),queueStat=fs.statSync(queuedData);
  assert(visibleStat.dev===queueStat.dev&&visibleStat.ino===queueStat.ino,'Production namespace data directory must match its queue root');
  const testData=fs.realpathSync(path.dirname(path.dirname(path.resolve(config.queues.test))));
  assert(data!==testData&&!data.startsWith(testData+'/')&&!testData.startsWith(data+'/'),'TEST and PROD data must be separate');
  for(const k of ['otg.db','openai','openai/usage.sqlite']){
    if(fs.existsSync(path.join(data,k))) {
      assert(fs.realpathSync(path.join(data,k)).startsWith(data+'/'),'Production DB must remain inside the PROD data root');
      if(fs.existsSync(path.join(testData,k))){
        const a=fs.statSync(path.join(data,k)), b=fs.statSync(path.join(testData,k));
        assert(a.dev!==b.dev||a.ino!==b.ino,'TEST and PROD must not share a database inode');
      }
    }
  }
  for(const port of [8190,11436]){
    const r=await fetch(`http://127.0.0.1:${port}/otg-admission`,{signal:AbortSignal.timeout(4000),redirect:'error'});
    assert(r.ok,'3060 fence unavailable');
    const proof=await r.json();
    assert.equal(proof.protocol,2);assert.equal(proof.uuid,config.gpu);assert.equal(proof.authority,config.authority);
  }
  console.log('Production candidate gates and shared 3060 identity verified.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
