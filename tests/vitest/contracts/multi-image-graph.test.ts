import fs from "node:fs";
import {describe,expect,it} from "vitest";
import {applyEditImageReferences,imageModelById,QWEN21_IMAGE_EDIT_WORKFLOW_ID} from "@/lib/imageGenerateWorkflows";
import {buildNativeImageGraph} from "@/lib/images/nativeImageModels";
import {submitNativeImageEdit} from "@/lib/client/nativeImages";
import {vi} from "vitest";
describe("All model references reach the exact graph in order",()=>{
  it("wires all 16 Qwen references and removes stale high slots when fewer inputs are used",()=>{
    const graph=JSON.parse(fs.readFileSync("comfy_workflows/presets/image_qwen_image_2_1_image_edit.json","utf8"));
    const images=Array.from({length:16},(_,i)=>`ref-${i+1}.png`);
    expect(imageModelById(QWEN21_IMAGE_EDIT_WORKFLOW_ID)?.maxInputImages).toBe(16);
    expect(applyEditImageReferences(graph,images,16).applied).toBe(16);
    for(let i=1;i<16;i++){const link=graph["474"].inputs[`images.image_${i+1}`],fit=graph[link[0]];expect(fit.class_type).toBe("ImageScaleToTotalPixels");expect(fit.inputs.megapixels).toBeLessThanOrEqual(4/15);expect(graph[fit.inputs.image[0]].inputs.image).toBe(images[i]);}
    applyEditImageReferences(graph,images.slice(0,2),16);expect(graph["474"].inputs["images.image_16"]).toBeUndefined();
    expect(()=>applyEditImageReferences(graph,[...images,"extra.png"],16)).toThrow(/at most 16/);
  });
  it.each(["fibo2-edit-turbo","fibo2-dev"] as const)("wires 4 inputs for %s, keeping source at slot 1",model=>{
    const images=["source.png","coat.png","style.png","scene.png"];
    const graph=buildNativeImageGraph({model,images,prompt:"Edit <image_1> using <image_2>",width:1024,height:1024,seed:42});
    for(let i=0;i<4;i++){const link=graph["474"].inputs[`images.image_${i+1}`] as [string,number];expect(graph[link[0]].inputs.image).toBe(images[i]);}
    expect(()=>buildNativeImageGraph({model,images:[...images,"extra.png"],prompt:"Edit",width:1024,height:1024,seed:42})).toThrow(/at most 4/);
  });
  it("submits all Fibo inputs without flattening them into one image",async()=>{
    const fetcher=vi.fn(async()=>Response.json({jobId:"job",promptId:"prompt"}));const image=new File(["x"],"source.png"),refs=[new File(["a"],"a.png"),new File(["b"],"b.png")];
    await submitNativeImageEdit({model:"fibo2-edit-turbo",image,referenceImages:refs,prompt:"Edit",seed:"0",fetchImpl:fetcher});
    expect((fetcher.mock.calls as unknown as [string,RequestInit][])[0][1].body).toBeInstanceOf(FormData);
    expect(((fetcher.mock.calls as unknown as [string,RequestInit][])[0][1].body as FormData).getAll("referenceImages").map(file=>(file as File).name)).toEqual(["a.png","b.png"]);
  });
});
