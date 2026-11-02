// Isolated, credential-free TEST build. Never changes a live release or service.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const source = path.resolve(__dirname, '../..'), evidence = path.resolve(process.argv[2] || '');
if (!/^\/home\/shawn-rochford\/AI\/research\/(?:experimental-tabs|h3-nsfw-access|h3-edit-recovery)-\d{8}-\w+$/.test(evidence) || !fs.existsSync(path.join(evidence,'source-before.tar.gz'))) throw Error('Explicit backed-up experiment evidence directory required');
const root = fs.mkdtempSync(path.join(evidence,'build-')), build = path.join(root,'source'), data = path.join(root,'data');
fs.mkdirSync(build); fs.mkdirSync(data,{mode:0o700});
const copied = spawnSync('rsync',['-a','--exclude=.git','--exclude=node_modules','--exclude=.next','--exclude=.cache','--exclude=data','--exclude=.env*','--exclude=*.tsbuildinfo',source+'/',build+'/'],{stdio:'inherit'});
if (copied.status !== 0) throw Error('Snapshot failed');
fs.symlinkSync(fs.realpathSync(path.join(source,'node_modules')),path.join(build,'node_modules'));
const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG:'C.UTF-8', NODE_ENV:'production', OTG_ENV:'test', NEXT_TELEMETRY_DISABLED:'1', AUTH_SECRET:crypto.randomBytes(48).toString('hex'), OTG_DATA_DIR:data, OTG_DATA_ROOT:data, OTG_EXPERIMENTS_ROOT:path.join(root,'experiments'), OTG_AUDIO_EDITING_ENABLED:'0', OPENAI_ENABLED:'0', OPENAI_KILL_SWITCH:'1', NODE_OPTIONS:'--max-old-space-size=6144' };
const startedAt = new Date().toISOString();
const log = fs.openSync(path.join(root,'build.log'),'wx',0o600);
console.log(JSON.stringify({root,build,log:path.join(root,'build.log')}));
const run = spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:build,env,stdio:['ignore',log,log]}); fs.closeSync(log);
const result = {source,build,data,startedAt,finishedAt:new Date().toISOString(),exitCode:run.status,buildId:fs.existsSync(path.join(build,'.next/BUILD_ID'))?fs.readFileSync(path.join(build,'.next/BUILD_ID'),'utf8').trim():null,testOnly:true,prodChanged:false};
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2),{mode:0o600}); console.log(JSON.stringify(result)); process.exitCode=run.status??1;
