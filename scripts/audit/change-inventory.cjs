// Compare with the exact pre-task snapshot, not just HEAD: pre-existing work is excluded.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||''),archive=path.join(evidence,'source-before.tar.gz');
if(!evidence.startsWith('/home/shawn-rochford/AI/research/test-audit-remediation-')||!fs.existsSync(archive))throw Error('Expected baseline');
const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8',maxBuffer:8*1024*1024}).trim().split('\n');
if(names.some(n=>path.isAbsolute(n)||n.split('/').includes('..')))throw Error('Unsafe baseline archive');
const before=fs.mkdtempSync(path.join(evidence,'before-source-'));fs.chmodSync(before,0o700);execFileSync('tar',['-xzf',archive,'-C',before]);
const current=execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:source,encoding:'utf8',maxBuffer:8*1024*1024}).split('\0').filter(Boolean);
const digest=file=>{if(!fs.existsSync(file)||!fs.statSync(file).isFile())return null;return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');};
const changes=[...new Set([...names,...current])].sort().flatMap(file=>{
  const a=digest(path.join(before,file)),b=digest(path.join(source,file));if(a===b)return [];
  return [{file,status:!a?'added':!b?'removed':'modified',beforeSha256:a,afterSha256:b}];
});
const result={source,baselineArchive:archive,baselineExtract:before,sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),count:changes.length,changes};
fs.writeFileSync(path.join(evidence,'changed-files.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({count:changes.length,added:changes.filter(x=>x.status==='added').length,modified:changes.filter(x=>x.status==='modified').length,removed:changes.filter(x=>x.status==='removed').length}));
