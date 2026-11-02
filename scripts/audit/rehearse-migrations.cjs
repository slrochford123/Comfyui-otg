// Online SQLite backup followed by isolated migration; never opens live DB writable.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const Database=require('better-sqlite3');
const source=path.resolve(__dirname,'../..'),evidence=path.resolve(process.argv[2]||'');
if(!evidence.startsWith('/home/shawn-rochford/AI/research/test-audit-remediation-'))throw Error('Expected audit evidence directory');
(async()=>{
  const pid=execFileSync('systemctl',['show','otg-test.service','-p','MainPID','--value'],{encoding:'utf8'}).trim();
  const environment=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').filter(Boolean).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}));
  if(environment.OTG_ENV!=='test'||environment.OTG_DATA_DIR!=='/home/shawn-rochford/AI/runtime/test/data')throw Error('Not the verified TEST service');
  const root=fs.mkdtempSync(path.join(evidence,'migration-rehearsal-'));fs.chmodSync(root,0o700);
  const live=new Database(path.join(environment.OTG_DATA_DIR,'otg.db'),{readonly:true,fileMustExist:true});
  try{await live.backup(path.join(root,'otg.db'));}finally{live.close();}fs.chmodSync(path.join(root,'otg.db'),0o600);
  const legacy=path.join(environment.OTG_DATA_DIR,'openai/usage.json');
  if(fs.existsSync(legacy)){fs.mkdirSync(path.join(root,'openai'),{mode:0o700});fs.copyFileSync(legacy,path.join(root,'openai/usage.json'),fs.constants.COPYFILE_EXCL);fs.chmodSync(path.join(root,'openai/usage.json'),0o600);}
  const snapshot=new Database(path.join(root,'otg.db'),{readonly:true});
  const before=snapshot.prepare('SELECT * FROM users ORDER BY id').all();snapshot.close();
  const hash=rows=>crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const env={PATH:process.env.PATH,HOME:process.env.HOME,OTG_ENV:'test',OTG_DATA_DIR:root,OTG_DATA_ROOT:root,AUTH_SECRET:crypto.randomBytes(48).toString('hex')};
  for(const key of ['ADMIN_IDENTIFIERS','ADMIN_EMAILS','ADMIN_USER_IDS'])if(environment[key])env[key]=environment[key];
  const probe=`const {db,ensureMigrations}=require('./lib/auth/db.ts');ensureMigrations();const {readLedgerUsage}=require('./lib/openai/usageLedger.ts');const usage=readLedgerUsage();console.log(JSON.stringify({users:db.prepare('SELECT * FROM users ORDER BY id').all(),roles:db.prepare("SELECT user_id FROM user_roles WHERE role='admin'").all().map(r=>r.user_id),quickCheck:db.pragma('quick_check',{simple:true}),usageRecords:usage.length}));`;
  const after=JSON.parse(execFileSync(process.execPath,['-r','./scripts/register-ts-worker.cjs','-e',probe],{cwd:source,env,encoding:'utf8'}));
  if(hash(before)!==hash(after.users)||after.quickCheck!=='ok')throw Error('Original user rows changed');
  const expected=new Set(['slrochford123@protonmail.com','slrochford123','slrochford',...(environment.ADMIN_IDENTIFIERS||'').split(',')].map(x=>x.trim().toLowerCase()));
  const originalAdmins=before.filter(u=>expected.has(String(u.email||'').toLowerCase())||expected.has(String(u.username||'').toLowerCase()));
  if(!originalAdmins.length||originalAdmins.some(u=>!after.roles.includes(u.id)))throw Error('Existing administrator preservation not verified');
  const result={ok:true,readOnlyLive:true,root,testPid:Number(pid),users:before.length,originalUserRowsUnchanged:true,existingAdminsPreserved:originalAdmins.length,newRoles:after.roles.length,quickCheck:after.quickCheck,legacyUsageImported:after.usageRecords,liveDatabaseChanged:false};
  fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
