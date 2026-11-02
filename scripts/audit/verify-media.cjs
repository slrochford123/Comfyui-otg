const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(process.argv[2]||'');
if(!root.startsWith('/home/shawn-rochford/AI/research/test-audit-remediation-')||!path.basename(root).startsWith('http-qa-'))throw Error('Expected private HTTP QA outputs');
const frames=file=>execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-i',file,'-map','0:v:0','-f','framemd5','-'],{encoding:'utf8'}).split('\n').filter(x=>x&&!x.startsWith('#')).map(x=>x.split(',').at(-1).trim());
const original=frames(path.join(root,'source.mp4')),results=[];
for(let mask=0;mask<8;mask++){
  const file=path.join(root,`mix-${mask}.mp4`);assert.deepEqual(frames(file),original);
  const bytes=execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-i',file,'-map','0:a:0','-f','f32le','-'],{maxBuffer:8*1024*1024});
  let peak=0,sum=0;for(let i=0;i<bytes.length;i+=4){const value=bytes.readFloatLE(i);assert(Number.isFinite(value));peak=Math.max(peak,Math.abs(value));sum+=value*value;}
  const rms=Math.sqrt(sum/(bytes.length/4));assert(peak<=1);if(mask===0)assert.equal(peak,0);else assert(rms>0);
  results.push({mask,file,originalFramesIdentical:true,frames:original.length,peak,rms,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
}
fs.writeFileSync(path.join(root,'media-integrity.json'),JSON.stringify({ok:true,syntheticStemFixtures:true,aiSeparationQualityCertified:false,results},null,2));console.log(JSON.stringify({ok:true,frames:original.length,outputs:results.length,silentExportVerified:true}));
