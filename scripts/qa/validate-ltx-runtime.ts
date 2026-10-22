import {buildLtxStudioWorkflow,inspectLtxStudioRuntime,LTX_STUDIO_RUNTIME,type LtxStudioRuntimeTool} from "@/lib/ltxStudiosRuntime";
const base="http://100.75.162.64:8188";
async function main(){
const cache=new Map<string,any>();
for(const tool of Object.keys(LTX_STUDIO_RUNTIME) as LtxStudioRuntimeTool[]){
 const compatibility=await inspectLtxStudioRuntime(base,tool);if(!compatibility.compatible)throw Error(JSON.stringify({tool,...compatibility}));
 const built=buildLtxStudioWorkflow({tool,mediaFilename:"qa-input.mp4",lookFilename:"qa-look.png",sourceWidth:720,sourceHeight:1280,longerSide:512,durationSeconds:2,fps:24,seed:42,outputPrefix:"EditVideo/LTX_Edit_00000000-0000-0000-0000-000000000000",instruction:"A QA subject moves naturally.",negativePrompt:"blurry",speed:0.2});
 for(const node of Object.values(built.graph)){
  const type=node.class_type;if(!cache.has(type))cache.set(type,(await(await fetch(base+'/object_info/'+type)).json())[type]);
  const schema=cache.get(type);if(!schema)throw Error('Missing node '+type);
  for(const [name,spec] of Object.entries<any>(schema.input?.required||{})){
   if(!(name in node.inputs))throw Error(`${tool}: missing ${type}.${name}`);
   const value=node.inputs[name];if(Array.isArray(value))continue;
   const options=Array.isArray(spec[0])?spec[0]:spec[0]==="COMBO"?spec[1]?.options:null;
   // Image filenames are created by the authenticated upload immediately before submission.
   const uploadedMedia=(type==="LoadImage"&&name==="image")||(type==="VHS_LoadVideo"&&name==="video");
   if(options&&!uploadedMedia&&!options.includes(value))throw Error(`${tool}: invalid ${type}.${name}=${value}`);
  }
 }
 console.log(JSON.stringify({tool,compatible:true,nodes:Object.keys(built.graph).length,frames:built.frames,width:built.width,height:built.height}));
}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
