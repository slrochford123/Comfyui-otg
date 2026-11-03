import {it,expect} from "vitest";
import {buildH3RefModCharacterVoiceWorkflow} from "@/lib/h3SpecialModes/refModCreationWorkflow";
// Explicit opt-in, GET only; never queues or runs a GPU graph.
it.skipIf(process.env.H3_VOICE_LIVE_SCHEMA!=="1")("matches the installed creation schemas on both physical GPU lanes",async()=>{
  const graph=buildH3RefModCharacterVoiceWorkflow({folder:"validation-only",name:"validation-only",subfolder:"validation-only",kind:"character",sourceCount:4,audioFilename:"validation-only.wav"}).graph;
  for(const base of ["http://100.75.162.64:8189","http://100.98.212.116:8188"]){
    const response=await fetch(base+"/object_info",{signal:AbortSignal.timeout(15000)});expect(response.ok).toBe(true);const info=await response.json();
    for(const node of Object.values(graph)){
      const schema=info[node.class_type];expect(schema,base+" "+node.class_type).toBeTruthy();
      const required=schema.input?.required||{},fields={...required,...schema.input?.optional};
      for(const key of Object.keys(required))expect(key in node.inputs,`${node.class_type}.${key} is required`).toBe(true);
      for(const [key,value]of Object.entries(node.inputs)){
        const descriptor=fields[key];expect(descriptor,`${node.class_type}.${key}`).toBeTruthy();
        if(Array.isArray(value)&&typeof value[0]==="string"&&typeof value[1]==="number"){
          const parent=graph[value[0]];expect(parent).toBeTruthy();const output=info[parent.class_type].output[value[1]];
          if(descriptor[0]!=="*")expect(output).toBe(descriptor[0]);
        }else if(Array.isArray(descriptor[0]))expect(descriptor[0]).toContain(value);
      }
    }
  }
},40000);
