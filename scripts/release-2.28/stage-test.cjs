// Pins the exact UI/API-qualified build. Stages TEST only; activation is separate.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||''),build=path.resolve(process.argv[3]||'');
if(!/^\/home\/shawn-rochford\/AI\/research\/build-2\.28-promotion-\d{8}-\w+$/.test(evidence)||!build.startsWith(evidence+'/build-')||!fs.existsSync(evidence+'/source-before.tar.gz'))throw Error('Backed-up isolated candidate required');
const result=JSON.parse(fs.readFileSync(build+'/../result.json')),qa=JSON.parse(fs.readFileSync(build+'/../browser-results.json'));
if(result.build!==build||result.exitCode!==0||!qa.ok||qa.buildId!==result.buildId||qa.paidCalls!==0||qa.gpuGenerationPerformed!==false||!['auto-upload-thumbnail-reuse-reload','image-first-last-reuse','reference-reuse','realism-reuse','remove-persists-selected-input-safe','nsfw-thumbnail-remove-reload-private-media-safe','owner-and-csrf-denials','device-library-owner-isolation'].every(check=>qa.checks.includes(check)))throw Error('Exact-build mobile browser/API/storage proof required');
const changed=[...new Set([...execFileSync('git',['diff','--name-only','81d0afa4e37a64f21d58f380402020f54f11235a'],{cwd:source,encoding:'utf8'}).trim().split('\n'),...execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:source,encoding:'utf8'}).trim().split('\n')].filter(Boolean))];
const exact=new Set(['config/build-history.json','app/app/page.tsx','instrumentation.ts','lib/h3SpecialModes/characterRefCard.ts','lib/h3SpecialModes/characterRefCardAvailability.ts','tests/character-refcard-production.test.ts','docs/build-2.28-release-notes.md','app/app/AppPageClient.tsx','app/api/images/before-after/route.ts','lib/images/beforeAfter.ts','lib/client/beforeAfter.ts','app/app/components/BeforeAfterPanel.tsx','app/app/components/ImageComparisonSlider.tsx','app/app/components/H3SavedUploads.tsx','lib/client/h3SavedUploads.ts','app/app/components/H3Panel.tsx','app/app/components/H3StudioControls.tsx','app/app/components/H3NsfwStudio.tsx','lib/experiments/store.ts','lib/experiments/assetHandlers.ts','app/api/h3/nsfw/assets/route.ts','tests/h3-saved-uploads.test.ts','tests/vitest/contracts/h3-saved-uploads-ui.test.tsx','tests/vitest/contracts/h3-nsfw-recovery-tools.test.tsx']);
if(changed.some(file=>!exact.has(file)&&!file.startsWith('scripts/release-2.28/')&&!file.startsWith('scripts/deploy/')&&!file.startsWith('scripts/before-after/')&&!file.startsWith('scripts/h3-saved-uploads/')&&!/^tests\/vitest\/contracts\/before-after/.test(file)))throw Error('Unrelated changes need review');
// QA and packaging scripts added after compilation contain no runtime app code.
fs.cpSync(source+'/scripts/release-2.28',build+'/scripts/release-2.28',{recursive:true});
for(const file of changed)if(!fs.readFileSync(source+'/'+file).equals(fs.readFileSync(build+'/'+file)))throw Error('Qualified source changed: '+file);
const root='/home/shawn-rochford/AI/deploy/otg-test',previous=fs.realpathSync(root+'/current');
if(previous!==root+'/releases/test3001-h3-saved-uploads-20261103T112436Z')throw Error('TEST baseline changed');
const candidate=root+'/releases/test3001-build-2.28-'+new Date().toISOString().replaceAll(/[-:]/g,'').split('.')[0]+'Z';
fs.mkdirSync(candidate);fs.writeFileSync(candidate+'/DO_NOT_ACTIVATE','Packaging incomplete');
const standalone=build+'/.next/standalone';
fs.cpSync(standalone,candidate,{recursive:true,filter:file=>{const relative=path.relative(standalone,file);return !['node_modules','data'].includes(relative)&&!relative.startsWith('data/')&&!relative.split(path.sep).some(part=>part.startsWith('.env'));}});
fs.cpSync(fs.realpathSync(standalone+'/node_modules'),candidate+'/node_modules',{recursive:true,verbatimSymlinks:true});
for(const directory of ['public','lib','scripts','config','comfy_workflows','workflows'])if(fs.existsSync(build+'/'+directory))fs.cpSync(build+'/'+directory,candidate+'/'+directory,{recursive:true});
fs.cpSync(build+'/.next/static',candidate+'/.next/static',{recursive:true});
const bootstrap="require('./scripts/audio-editing-release-bootstrap.cjs');\n";
if(fs.readFileSync(previous+'/server.js','utf8').startsWith(bootstrap)){
 if(!fs.readFileSync(previous+'/scripts/audio-editing-release-bootstrap.cjs').equals(fs.readFileSync(candidate+'/scripts/audio-editing-release-bootstrap.cjs')))throw Error('Audio bootstrap changed');
 fs.writeFileSync(candidate+'/server.js',bootstrap+fs.readFileSync(candidate+'/server.js','utf8'));
}
for(const [name,target] of Object.entries({'.env.local':'/home/shawn-rochford/AI/runtime/test/config/app-env/.env.local',data:'/home/shawn-rochford/AI/runtime/test/data'}))fs.symlinkSync(target,candidate+'/'+name);
for(const marker of ['experimental-workspace.json','openai-billing-fix.json','character-refmod-cards.json','before-after.json','h3-saved-uploads.json'])if(fs.existsSync(previous+'/public/'+marker)){
 const prior=JSON.parse(fs.readFileSync(previous+'/public/'+marker));fs.writeFileSync(candidate+'/public/'+marker,JSON.stringify({...prior,previousBuildId:prior.buildId,buildId:result.buildId,version:'2.28',savedUploadsIncluded:true}));
}
fs.writeFileSync(candidate+'/public/h3-saved-uploads.json',JSON.stringify({feature:'h3-saved-uploads',buildId:result.buildId,testOnly:true,version:'2.28',githubPushed:false,prodChanged:false}));
const helpers=evidence+'/helpers';fs.mkdirSync(helpers,{mode:0o700});
for(const [from,to] of [['scripts/deploy/systemd_runtime.py','helpers/systemd_runtime.py'],['scripts/deploy/activate_test_release.py','helpers/activate_test_release.py'],['scripts/audit/activate-test.py','helpers/audit_checks.py'],['scripts/release-2.28/activate-test.py','activate-test.py']])fs.copyFileSync(source+'/'+from,evidence+'/'+to,fs.constants.COPYFILE_EXCL);
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function inventory(base,relative=''){return fs.readdirSync(path.join(base,relative),{withFileTypes:true}).flatMap(entry=>{
 const file=path.join(relative,entry.name),absolute=path.join(base,file);if(['data','.env.local','DO_NOT_ACTIVATE'].includes(file))return [];
 if(entry.isDirectory())return inventory(base,file);if(entry.isSymbolicLink()){if(!fs.realpathSync(absolute).startsWith(base+'/'))throw Error('External package link');return [{file,link:fs.readlinkSync(absolute)}];}if(!entry.isFile())throw Error('Special package file');return [{file,sha256:digest(absolute)}];
});}
execFileSync(process.execPath,['-e',"new (require(process.argv[1]+'/node_modules/better-sqlite3'))(':memory:').close();require(process.argv[1]+'/node_modules/sharp')({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer().catch(()=>process.exit(1))",candidate]);
const plan={candidate,previous,buildId:result.buildId,files:inventory(candidate),helpers:['helpers/systemd_runtime.py','helpers/activate_test_release.py','helpers/audit_checks.py','activate-test.py'].map(file=>({file,sha256:digest(evidence+'/'+file)}))};
fs.writeFileSync(evidence+'/activation-plan.json',JSON.stringify(plan,null,2),{mode:0o600});fs.unlinkSync(candidate+'/DO_NOT_ACTIVATE');console.log(JSON.stringify({candidate,previous,buildId:result.buildId,activated:false}));
