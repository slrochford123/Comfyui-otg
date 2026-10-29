// Included only in the separately staged Unified Audio Editing TEST artifact.
// Release-local settings disappear automatically when rolling back server.js.
const path=require('node:path');
if(process.env.OTG_ENV==='test'){
  process.env.OTG_AUDIO_EDITING_ENABLED??='1';
  process.env.OTG_AUDIO_ENGINE_CONFIG??='/home/shawn-rochford/AI/runtime/test/unified-audio/engines.json';
  process.env.OTG_AUDIO_WORKER_SCRIPT??=path.join(__dirname,'audio-editing-worker.py');
}
