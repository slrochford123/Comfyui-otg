// Start a TEST-only development server using the existing TEST process's
// environment in memory. No credential values are logged or copied to files.
const fs = require("node:fs");
const {spawn} = require("node:child_process");
const pid = Number(process.argv[2]);
if (!Number.isInteger(pid)||pid<2) throw Error("Supply the verified existing TEST PID.");
const entries=fs.readFileSync(`/proc/${pid}/environ`,"utf8").split("\0").filter(Boolean);
const env=Object.fromEntries(entries.map(e=>{const i=e.indexOf("=");return [e.slice(0,i),e.slice(i+1)];}));
if(env.OTG_ENV!=="test")throw Error("Refusing a non-TEST environment.");
Object.assign(env,{PORT:"3308",HOSTNAME:"100.75.162.64",NODE_ENV:"development",NEXT_TELEMETRY_DISABLED:"1",
  OTG_AUDIO_EDITING_ENABLED:"1",OTG_AUDIO_ISOLATED_DEV:"1",OTG_AUDIO_WORKER_SCRIPT:require("node:path").join(__dirname,"audio-editing-worker.py"),
  OTG_AUDIO_ENGINE_CONFIG:"/home/shawn-rochford/AI/runtime/test/unified-audio/engines.json"});
const child=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","100.75.162.64","--port","3308"],{env,stdio:"inherit"});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
child.on("exit",code=>process.exit(code||0));
