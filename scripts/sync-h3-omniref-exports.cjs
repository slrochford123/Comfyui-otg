#!/usr/bin/env node
// Regenerate the public/source export examples from the SAME runtime compiler.
// Does not contact a worker or submit a generation.
require('./register-ts-worker.cjs');
const fs=require('node:fs'),path=require('node:path');
const {buildH3Workflow}=require('../lib/production/h3Workflows.ts');
for(const backend of ['rtx3090','rtx5060ti']){
 const built=buildH3Workflow({backend,mode:'h3-reference-to-video',h3Quality:'hq',durationSeconds:5,finalPrompt:'Use <Picture 1> as <Subject 1>. Describe the desired motion here.',seed:424242,outputPrefix:'h3_reference_output',references:[{id:'reference-1',name:'Reference',sourceKind:'production-upload',pictureSlot:1,subjectSlot:1,workflowImage:'reference.png',uploadedFilename:'reference.png'}]});
 const files=[`comfy_workflows/internal/production-v2/minimax_h3_r2v_${backend}.json`];
 if(backend==='rtx3090')files.push('comfy_workflows/internal/story-creator/h3-story-preview-r2v-api.json');
 for(const file of files){fs.writeFileSync(path.join(__dirname,'..',file),JSON.stringify(built.graph,null,2)+'\n');console.log(file);}
}
