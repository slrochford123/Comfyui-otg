const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root=path.resolve(__dirname,'../..'), data=fs.mkdtempSync(path.join(os.tmpdir(),'slr-audit-suite-'));
const env={...process.env,OTG_ENV:'test',OTG_DATA_DIR:data,OTG_DATA_ROOT:data,OTG_PERSISTENT_DATA_ROOT:data,OPENAI_API_KEY:'',OPENAI_ADMIN_API_KEY:'',ELEVENLABS_API_KEY:'',OPENAI_KILL_SWITCH:'true',OTG_MEDIA_GPU_LIVE_QA:'0',AUTH_SECRET:crypto.randomBytes(48).toString('hex'),NODE_OPTIONS:'--require='+path.join(__dirname,'offline-guard.cjs')};
const result=spawnSync(process.execPath,[path.join(root,'node_modules/vitest/vitest.mjs'),'run','tests/vitest/contracts'],{cwd:root,env,stdio:'inherit'});
console.log('Isolated test fixture directory:',data);process.exitCode=result.status??1;
