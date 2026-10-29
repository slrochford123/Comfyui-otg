// Convenience acceptance assets: ONLY original/authorized QA media, TEST only,
// additive exclusive copies to the browser-observed owner's existing libraries.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const pid=Number(process.argv[2]),username=String(process.argv[3]||'');
if(!Number.isInteger(pid)||!/^[a-zA-Z0-9_-]{3,128}$/.test(username))throw Error('Verified TEST PID and observed browser owner required');
const env=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
if(env.OTG_ENV!=='test'||env.OTG_DATA_DIR!=='/home/shawn-rochford/AI/runtime/test/data')throw Error('TEST only');
const aliases=new Map(String(env.OTG_OWNER_ALIASES||'').split(',').map(s=>s.split(':'))),owner=(aliases.get(username.toLowerCase())||username).toLowerCase();
if(!/^[a-zA-Z0-9_-]{3,128}$/.test(owner))throw Error('Invalid owner namespace');
const evidence='/home/shawn-rochford/AI/runtime/test/unified-audio/evidence',batch=crypto.randomBytes(4).toString('hex');
const stock={author:'MathieuMD',title:'Ishikawa Zoo - Animals - 36 - 2016-04-22',license:'CC-BY-SA-4.0',url:'https://commons.wikimedia.org/wiki/File:Ishikawa_Zoo_-_Animals_-_36_-_2016-04-22.webm',changes:'Muted, trimmed 16-second derivative for private model evaluation.'};
const fixtures=[
 ['conversation-30s','native/conversation-30s.mp4',null,'Original procedural/synthetic test conversation'],
 ['lion-silent-16s','stock/lion-silent-16s.mp4',null,stock],
 ['finished-multitrack-3090','generation-api-rtx3090-1793288694548/generated-multitrack-16s.mp4',null,{...stock,modelLicense:'Woosh CC-BY-NC-4.0 private TEST evaluation'}],
 ['instrumental-music','generation-api-rtx3090-1793288694548/music.wav','music','ACE-Step MIT; original generated QA music'],
 ['door-bell-effect','generation-api-rtx3090-1793288694548/manual-effects.wav','effects','Woosh CC-BY-NC-4.0 private TEST evaluation; described generated effect'],
 ['original-created-voice','create-api-rtx3090-1793287567116/original-voice.wav','speech','Original synthetic voice; AuK MIT with Qwen Research non-commercial encoder'],
];
const files=[];
for(const [label,relative,lane,provenance] of fixtures){
 const input=path.join(evidence,relative);if(!fs.statSync(input).isFile())throw Error('Missing completed QA media');
 const name=`audio-qa-${label}-${batch}${path.extname(input)}`,dir=lane?path.join(env.OTG_DATA_DIR,'edit_video/music',owner,'library'):path.join(env.OTG_DATA_DIR,'user_galleries',owner);fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,name);fs.copyFileSync(input,file,fs.constants.COPYFILE_EXCL);
 const metadata={title:'Audio QA — '+label,ownerKey:owner,sourceType:'unified-audio-editing-qa',source:'unified-audio-editing',suggestedLane:lane,license:typeof provenance==='string'?provenance:provenance.modelLicense||provenance.license,provenance,createdAt:Date.now()};
 fs.writeFileSync(file+(lane?'.json':'.meta.json'),JSON.stringify(metadata,null,2),{flag:'wx',mode:0o600});files.push({name,file});
}
fs.writeFileSync(path.join(evidence,'owner-acceptance-fixtures.json'),JSON.stringify({testOnly:true,owner,files},null,2),{mode:0o600});console.log(JSON.stringify({testOnly:true,added:files.map(f=>f.name),existingMediaChanged:false}));
