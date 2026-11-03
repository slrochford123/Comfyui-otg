// Additive, pinned TEST packaging. No service or production changes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||''),build=path.resolve(process.argv[3]||''),expected=process.argv[4];
if(!/^\/home\/shawn-rochford\/AI\/research\/(?:experimental-tabs|h3-nsfw-access)-\d{8}-\w+$/.test(evidence)||!build.startsWith(evidence+'/build-')||!fs.existsSync(path.join(evidence,'source-before.tar.gz')))throw Error('Expected backed-up isolated build');
const built=JSON.parse(fs.readFileSync(path.join(build,'../result.json'),'utf8'));
if(built.exitCode!==0||built.build!==build)throw Error('Successful exact build required');
// Narrow retirement-only qualification. All other web/runtime source must be
// byte-identical to the previously qualified Build 2.24. This exception never
// applies to model/runner changes or general feature releases.
const retirement=['--retire-dasiwa-v4','--retire-h3-models'].includes(process.argv[5]);
const retireBoth=process.argv[5]==='--retire-h3-models';
const refCards=process.argv[5]==='--character-refcards';
if(process.argv[5]&&!retirement&&!refCards)throw Error('Unknown qualification mode');
if(retirement){
  const baseline='453f9d654580f9466148fd8015b3d7449276407a';
  const previous=retireBoth?'/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-experimental-tabs-20261103T005548Z':'/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-build-2.24-20261102T205925Z';
  if(expected!==previous)throw Error('Retirement baseline changed');
  const allowed=new Set(['app/app/components/H3NsfwStudio.tsx','lib/experiments/apiHandlers.ts','lib/experiments/catalog.ts','lib/experiments/generation.ts','lib/experiments/store.ts','config/build-history.json']);
  const changed=execFileSync('git',['diff','--name-only',baseline,'--','app','lib','config','comfy_workflows','package.json','package-lock.json'],{cwd:source,encoding:'utf8'}).trim().split('\n').filter(Boolean);
  if(changed.length!==allowed.size||changed.some(file=>!allowed.has(file)))throw Error('Not a retirement-only web change');
  for(const file of execFileSync('git',['ls-files','app','lib','config','comfy_workflows','scripts','package.json','package-lock.json'],{cwd:source,encoding:'utf8'}).trim().split('\n')){
    if(!fs.readFileSync(path.join(source,file)).equals(fs.readFileSync(path.join(build,file))))throw Error('Qualified source changed: '+file);
    if(file.startsWith('scripts/')&&!file.startsWith('scripts/experiments/qa-')&&!['scripts/experiments/stage-test.cjs','scripts/deploy/package-story-media-prod.py','scripts/deploy/stage-story-media-prod.py','scripts/deploy/activate-story-media-prod.py'].includes(file)){
      // The source checkpoint also contains already-completed Android tooling;
      // it does not change the previously qualified web application.
      if(!execFileSync('git',['show','1424e53ee37f1b79a34baf0253ac7f3cafedcde8:'+file],{cwd:source}).equals(fs.readFileSync(path.join(build,file))))throw Error('Existing runtime/helper changed: '+file);
    }
  }
  const catalog=fs.readFileSync(path.join(build,'lib/experiments/catalog.ts'),'utf8');
  if(catalog.split('const RETIRED_EXPERIMENTS')[0].includes('dasiwa-v4')||!catalog.includes('isRetiredExperiment'))throw Error('Retirement catalog guard missing');
  if(retireBoth&&(catalog.split('const RETIRED_EXPERIMENTS')[0].includes('pinkcherry-v18')||JSON.parse(fs.readFileSync(path.join(build,'config/build-history.json'))).current!=='2.26'))throw Error('Combined retirement identity mismatch');
}
if(refCards){
  const baseline='cca28c6c21c734a3138425461086181f121532d3';
  if(expected!=='/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-experimental-tabs-20261103T012226Z')throw Error('RefCard baseline changed');
  const files=['app/api/h3/generation/route.ts','app/api/h3/smart-references/route.ts','app/api/h3/special/realism/generation/route.ts','app/api/h3/special/refmods/generation/route.ts','app/api/h3/special/refmods/library/route.ts','app/api/h3/special/refmods/character-card/route.ts','app/app/AppPageClient.tsx','app/app/components/CharacterHubPanel.tsx','app/app/components/H3SmartReferences.tsx','app/app/components/CharacterRefCardCreator.tsx','config/build-history.json','instrumentation.ts','lib/h3DirectJobs.ts','lib/h3SmartReferencesServer.ts','lib/h3SpecialModes/realismJobs.ts','lib/h3SpecialModes/refModCreation.ts','lib/h3SpecialModes/refMods.ts','lib/h3SpecialModes/refModsJobs.ts','lib/images/nativeImageBackend.ts','lib/h3SpecialModes/characterRefCard.ts','lib/h3SpecialModes/characterRefCardAccess.ts','lib/h3SpecialModes/characterRefCardContract.ts'];
  files.push('app/app/components/H3Panel.tsx');
  const allowed=new Set(files),scope=['app','lib','config','comfy_workflows','instrumentation.ts','package.json','package-lock.json'];
  const changed=[...new Set([...execFileSync('git',['diff','--name-only',baseline,'--',...scope],{cwd:source,encoding:'utf8'}).trim().split('\n'),...execFileSync('git',['ls-files','--others','--exclude-standard','--',...scope],{cwd:source,encoding:'utf8'}).trim().split('\n')].filter(Boolean))];
  if(changed.some(file=>!allowed.has(file))||files.some(file=>!changed.includes(file)))throw Error('Not the scoped Character RefCard feature');
  for(const file of [...execFileSync('git',['ls-files',...scope],{cwd:source,encoding:'utf8'}).trim().split('\n'),...files]){
    if(!fs.readFileSync(path.join(source,file)).equals(fs.readFileSync(path.join(build,file))))throw Error('Qualified source changed: '+file);
  }
  const scripts=execFileSync('git',['diff','--name-only',baseline,'--','scripts'],{cwd:source,encoding:'utf8'}).trim().split('\n').filter(Boolean);
  if(scripts.some(file=>file!=='scripts/experiments/stage-test.cjs'&&!file.startsWith('scripts/experiments/qa-')))throw Error('Unqualified runtime helper changed');
  if(fs.existsSync(path.join(evidence,'runtime-candidate.json'))||fs.existsSync(path.join(evidence,'testing-runtime-candidate.json')))throw Error('RefCards must not replace the existing experimental runtimes');
  if(JSON.parse(fs.readFileSync(path.join(build,'config/build-history.json'))).current!=='2.27')throw Error('Expected TEST Build 2.27');
}
const qa=fs.readdirSync(path.dirname(build)).filter(n=>n.startsWith('browser-')).map(n=>path.join(build,'..',n,'results.json')).filter(f=>fs.existsSync(f)).map(f=>JSON.parse(fs.readFileSync(f,'utf8')));
if(refCards){
  const real=qa.find(r=>r.ok&&r.buildId===built.buildId&&r.suite==='character-refcard'&&r.realInference&&r.paidCalls===0&&['rtx3090','rtx5060ti'].every(gpu=>r.gpus?.[gpu]?.h3Job?.status==='completed'&&r.gpus[gpu].viewIds?.length===4&&r.gpus[gpu].video?.probe?.format?.duration));
  if(!real||!real.gpus.rtx3090.individualRegeneration||real.uploadedEightEncoding?.shape?.[0]!==8||!real.immutableSavedPreview||!real.useInH3Routing)throw Error('Exact-build dual-GPU FIBO/RefMod/H3, Use in H3 routing, eight-image encoding and immutable-preview qualification required');
  const review=JSON.parse(fs.readFileSync(path.join(path.dirname(build),'refcard-quality-review.json')));
  if(review.buildId!==built.buildId||!review.ok||!review.distinctViews||!review.h3IdentityRecognizable||!review.limitations)throw Error('Recorded visual quality review required');
}
if(!qa.some(result=>result.ok&&result.buildId===built.buildId&&result.suite==='experimental-workspace'))throw Error('Exact build experimental workspace browser qualification required');
const accessCandidate=path.join(evidence,'runtime-candidate.json');
if(retirement&&!qa.some(r=>r.ok&&r.buildId===built.buildId&&r.suite==='h3-nsfw-compact'&&Object.values(r.retirementChecks||{}).length===7&&Object.values(r.retirementChecks).every(v=>v===true)))throw Error('Exact retirement browser/API/media qualification required');
if(retireBoth&&!qa.some(r=>r.ok&&r.buildId===built.buildId&&r.suite==='h3-nsfw-compact'&&JSON.stringify(r.retiredModels)===JSON.stringify(['dasiwa-v4','pinkcherry-v18'])))throw Error('Both removed models must pass historical-data and request-denial browser checks');
if(retirement&&(fs.existsSync(accessCandidate)||fs.existsSync(path.join(evidence,'testing-runtime-candidate.json'))))throw Error('Retirement cannot replace runtime configurations');
if(!retirement&&!refCards&&fs.existsSync(path.join(build,'lib/storyCreator/mediaExecution.ts'))){
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
  if(!retirement&&!refCards&&!qa.some(result=>result.ok&&result.buildId===built.buildId&&result.suite==='openai-billing'))throw Error('Exact combined build billing browser qualification required');
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
if(refCards)fs.writeFileSync(path.join(candidate,'public/character-refmod-cards.json'),JSON.stringify({feature:'character-refmod-cards',buildId:built.buildId,sourceHead,testOnly:true,version:'2.27',paths:['one-image-four-fibo-views','four-to-eight-owned-reference-images'],encoder:'H3 Full Reference',gpus:['rtx3090','rtx5060ti'],paidCalls:0}));
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
