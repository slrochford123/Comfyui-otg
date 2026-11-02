// Additive, pinned TEST packaging. No service or production changes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||''),build=path.resolve(process.argv[3]||''),expected=process.argv[4];
if(!/^\/home\/shawn-rochford\/AI\/research\/(?:experimental-tabs|h3-nsfw-access)-\d{8}-\w+$/.test(evidence)||!build.startsWith(evidence+'/build-')||!fs.existsSync(path.join(evidence,'source-before.tar.gz')))throw Error('Expected backed-up isolated build');
const built=JSON.parse(fs.readFileSync(path.join(build,'../result.json'),'utf8'));
if(built.exitCode!==0||built.build!==build)throw Error('Successful exact build required');
const qa=fs.readdirSync(path.dirname(build)).filter(n=>n.startsWith('browser-')).map(n=>path.join(build,'..',n,'results.json')).filter(f=>fs.existsSync(f)).map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
if(!qa.some(result=>result.ok&&result.buildId===built.buildId&&result.suite==='experimental-workspace'))throw Error('Exact build experimental workspace browser qualification required');
const accessCandidate=path.join(evidence,'runtime-candidate.json');
if(fs.existsSync(path.join(build,'lib/storyCreator/mediaExecution.ts'))){
  if(!qa.some(r=>r.ok&&r.buildId===built.buildId&&r.suite==='story-media'))throw Error('Exact-build Story media browser qualification required');
  const real=fs.readdirSync(path.dirname(build)).filter(n=>n.startsWith('real-story-media-')).map(n=>path.join(build,'..',n,'results.json')).filter(f=>fs.existsSync(f)).map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
  if(!real.some(r=>r.ok&&r.realInference&&r.buildId===built.buildId&&r.suite==='story-media-real'))throw Error('Exact-build Story media real GPU qualification required');
  const files=['lib/storyCreator/mediaContract.ts','lib/storyCreator/mediaStore.ts','lib/storyCreator/mediaExecution.ts','lib/storyCreator/mediaVoice.ts','lib/storyCreator/conversationExecutor.ts','lib/openai/provider.ts','app/api/story-creator/turns/route.ts','app/api/story-creator/media/route.ts','app/api/story-creator/media/file/route.ts','app/app/components/StoryCreatorPanel.tsx','app/app/components/storyCreatorV2/IdeasTab.tsx','app/app/components/storyCreatorV2/StoryMediaCards.tsx','scripts/story-creator/qwen_media.py'];
  files.push('lib/storyCreator/mediaVideo.ts','lib/storyCreator/mediaAvailability.ts','scripts/story-creator/qwen_gateway_worker.py');
  for(const file of files)if(!fs.readFileSync(path.join(source,file)).equals(fs.readFileSync(path.join(build,file))))throw Error('Story media source changed since build: '+file);
}
if(fs.existsSync(path.join(build,'app/app/components/H3NsfwStudio.tsx'))){
  if(!qa.some(result=>result.ok&&result.buildId===built.buildId&&result.suite==='h3-nsfw-compact'))throw Error('Exact compact H3 browser qualification required');
  if(fs.readFileSync(path.join(build,'app/app/components/H3NsfwStudio.tsx'),'utf8').includes('VideoSnapshotPicker')&&!qa.some(result=>result.ok&&result.buildId===built.buildId&&result.suite==='h3-nsfw-compact'&&result.snapshotChecks?.immutableJobReference))throw Error('Exact H3 snapshot capture/upload/job-reference qualification required');
  for(const file of ['app/app/components/H3Panel.tsx','app/app/components/H3NsfwStudio.tsx'])if(!fs.readFileSync(path.join(source,file)).equals(fs.readFileSync(path.join(build,file))))throw Error('Compact H3 source changed since build: '+file);
}
const accessFiles=['app/app/components/H3Panel.tsx','app/app/components/H3NsfwAccessRequest.tsx','app/app/components/H3NsfwUserControl.tsx','app/app/components/SpinDialNav.tsx','app/app/AppPageClient.tsx','app/admin/users/users-client.tsx','app/api/admin/users/route.ts','app/api/admin/h3-nsfw-access/route.ts','app/api/h3/nsfw/route.ts','app/api/h3/nsfw/access/route.ts','app/api/h3/nsfw/assets/route.ts','lib/experiments/nsfwAccess.ts','lib/experiments/nsfwHttp.ts','lib/experiments/apiHandlers.ts','lib/experiments/assetHandlers.ts','lib/client/useH3NsfwAccess.ts'];
if(fs.existsSync(accessCandidate)){
  if(!qa.some(result=>result.ok&&result.realInference&&result.buildId===built.buildId&&result.suite==='h3-nsfw-access'))throw Error('Exact permission flow and real GPU browser qualification required');
  for(const file of accessFiles)if(!fs.readFileSync(path.join(source,file)).equals(fs.readFileSync(path.join(build,file))))throw Error('Access source changed since build: '+file);
}
const testingCandidate=path.join(evidence,'testing-runtime-candidate.json');
if(fs.existsSync(testingCandidate)){
  const real=fs.readdirSync(path.dirname(build)).filter(n=>n.startsWith('real-testing-')).map(n=>path.join(build,'..',n,'results.json')).filter(f=>fs.existsSync(f)).map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
  if(!real.some(r=>r.ok&&r.realInference&&r.buildId===built.buildId))throw Error('Exact Testing build must pass real GPU browser qualification');
}
for(const file of ['app/app/components/ExperimentLabPanel.tsx','app/api/experiments/route.ts','lib/experiments/catalog.ts','lib/experiments/store.ts','lib/experiments/generation.ts']){
  if(!fs.readFileSync(path.join(source,file)).equals(fs.readFileSync(path.join(build,file))))throw Error('Experiment source changed since build: '+file);
}
const test='/home/shawn-rochford/AI/deploy/otg-test',previous=fs.realpathSync(path.join(test,'current'));
if(previous!==expected||!previous.startsWith(test+'/releases/test3001-'))throw Error('Exact previous release changed');
const billingMarker=path.join(previous,'public/openai-billing-fix.json');
const billing=fs.existsSync(billingMarker)?JSON.parse(fs.readFileSync(billingMarker,'utf8')):null;
const billingFiles=['lib/openai/adminCredential.ts','lib/openai/billing.ts','lib/openai/connection.ts','app/api/admin/openai-billing/route.ts','app/app/admin/openai-billing/OpenAIBillingClient.tsx','scripts/install-openai-admin-key-test.py','scripts/install-openai-admin-key-test.sh'];
if(billing){
  if(!qa.some(result=>result.ok&&result.buildId===built.buildId&&result.suite==='openai-billing'))throw Error('Exact combined build billing browser qualification required');
  // The active standalone release retains lib/scripts, but not original app sources.
  for(const file of billingFiles){
    if(!fs.readFileSync(path.join(source,file)).equals(fs.readFileSync(path.join(build,file))))throw Error('Billing source changed since build: '+file);
    if(!file.startsWith('app/')&&!fs.readFileSync(path.join(previous,file)).equals(fs.readFileSync(path.join(build,file))))throw Error('Active billing runtime would be replaced: '+file);
  }
}
if(fs.existsSync(path.join(evidence,'activation-plan.json')))throw Error('Activation already staged');
const stamp=new Date().toISOString().replaceAll(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
const candidate=path.join(test,'releases','test3001-experimental-tabs-'+stamp),standalone=path.join(build,'.next/standalone');
fs.mkdirSync(candidate,{mode:0o755});fs.writeFileSync(path.join(candidate,'DO_NOT_ACTIVATE'),'Incomplete packaging\n');
fs.cpSync(standalone,candidate,{recursive:true,force:false,errorOnExist:true,filter:file=>{const rel=path.relative(standalone,file);return !['node_modules','data'].includes(rel)&&!rel.startsWith('data/')&&!rel.split(path.sep).some(p=>p.startsWith('.env'));}});
fs.cpSync(fs.realpathSync(path.join(standalone,'node_modules')),path.join(candidate,'node_modules'),{recursive:true,force:false,errorOnExist:true,verbatimSymlinks:true});
for(const name of ['public','scripts','lib','comfy_workflows','config'])if(fs.existsSync(path.join(build,name)))fs.cpSync(path.join(build,name),path.join(candidate,name),{recursive:true,force:true});
fs.cpSync(path.join(build,'.next/static'),path.join(candidate,'.next/static'),{recursive:true,force:true});
fs.copyFileSync(path.join(build,'package-lock.json'),path.join(candidate,'package-lock.json'));
const bootstrap="require('./scripts/audio-editing-release-bootstrap.cjs');\n";
if(fs.readFileSync(path.join(previous,'server.js'),'utf8').startsWith(bootstrap)){
  const old=fs.readFileSync(path.join(previous,'scripts/audio-editing-release-bootstrap.cjs'));
  const next=fs.readFileSync(path.join(candidate,'scripts/audio-editing-release-bootstrap.cjs'));
  if(!old.equals(next))throw Error('Audio bootstrap changed; review required');
  const server=path.join(candidate,'server.js');fs.writeFileSync(server,bootstrap+fs.readFileSync(server,'utf8'));
}
for(const [name,target] of Object.entries({'.env.local':'/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local',data:'/home/shawn-rochford/AI/runtime/test/data'})){
  if(fs.existsSync(path.join(candidate,name)))throw Error('Runtime data unexpectedly packaged');fs.symlinkSync(target,path.join(candidate,name));
}
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
fs.writeFileSync(path.join(candidate,'public/experimental-workspace.json'),JSON.stringify({feature:'experimental-workspace',buildId:built.buildId,sourceHead,includesLocalChanges:true,testOnly:true,executionAdapterInstalled:true,executionPolicy:'private-runtime-qualified-model-and-mode-only',promotionEnabled:false}));
if(billing)fs.writeFileSync(path.join(candidate,'public/openai-billing-fix.json'),JSON.stringify({...billing,buildId:built.buildId,sourceHead,experimentalTabsIncluded:true,billingFixPreserved:true}));
const helpers=path.join(evidence,'helpers');fs.mkdirSync(helpers,{mode:0o700});
for(const [from,to] of [['scripts/deploy/systemd_runtime.py','helpers/systemd_runtime.py'],['scripts/deploy/activate_test_release.py','helpers/activate_test_release.py'],['scripts/audit/activate-test.py','helpers/audit_checks.py'],['scripts/experiments/activate-test.py','activate-test.py']])fs.copyFileSync(path.join(source,from),path.join(evidence,to),fs.constants.COPYFILE_EXCL);
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function inventory(root,relative='') {return fs.readdirSync(path.join(root,relative),{withFileTypes:true}).flatMap(entry=>{
  const file=path.join(relative,entry.name),absolute=path.join(root,file);if(['data','.env.local','DO_NOT_ACTIVATE'].includes(file))return [];
  if(entry.isDirectory())return inventory(root,file);
  if(entry.isSymbolicLink()){if(!fs.realpathSync(absolute).startsWith(root+path.sep))throw Error('External package symlink: '+file);return [{file,link:fs.readlinkSync(absolute)}];}
  if(!entry.isFile())throw Error('Special package file');return [{file,sha256:digest(absolute)}];
});}
const plan={candidate,previous,buildId:built.buildId,sourceHead,billingFixPreserved:!!billing,files:inventory(candidate),helpers:['helpers/systemd_runtime.py','helpers/activate_test_release.py','helpers/audit_checks.py','activate-test.py'].map(file=>({file,sha256:digest(path.join(evidence,file))}))};
if(fs.existsSync(accessCandidate)){
  const original=path.join(evidence,'runtime-original.json');
  if(digest(original)!==digest('/home/shawn-rochford/AI/runtime/test/experiments/runtime.json'))throw Error('Live H3 runtime changed since candidate preparation');
  plan.accessRuntime={candidate:{file:accessCandidate,sha256:digest(accessCandidate)},original:{file:original,sha256:digest(original)}};
  const cfg=JSON.parse(fs.readFileSync(accessCandidate));if(cfg.permissionGuardVersion!==1)throw Error('Permission-aware runtime missing');
  for(const entry of cfg.files)if(digest(entry.path)!==entry.sha256)throw Error('Pinned access engine changed');
}
execFileSync(process.execPath,['-e',"const D=require(process.argv[1]+'/node_modules/better-sqlite3');new D(':memory:').close();require(process.argv[1]+'/node_modules/sharp')({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer().catch(()=>process.exit(1));",candidate]);
fs.writeFileSync(path.join(evidence,'activation-plan.json'),JSON.stringify(plan,null,2),{mode:0o600}); fs.unlinkSync(path.join(candidate,'DO_NOT_ACTIVATE'));
console.log(JSON.stringify({candidate,previous,buildId:built.buildId,files:plan.files.length,activated:false,prodChanged:false}));
