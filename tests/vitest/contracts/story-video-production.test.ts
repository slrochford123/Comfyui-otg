import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {createStudioStore} from "@/lib/productionStudio/store";
import {allShots} from "@/lib/productionStudio/model";
const mock=vi.hoisted(()=>({record:{} as any,source:""}));
vi.mock("@/lib/storyCreator/mediaStore",()=>({getStoryMedia:(owner:string,project:string,id:string)=>{if(owner!=="alice"||project!=="story"||id!=="clip")throw Error("Not found");return mock.record;}}));
vi.mock("@/lib/storyCreator/mediaExecution",()=>({storyMediaFile:()=>mock.source}));
import {sendStoryVideoToProduction} from "@/lib/storyCreator/mediaProduction";
let root:string,s:ReturnType<typeof createStudioStore>;
beforeEach(()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),"story-handoff-"));s=createStudioStore(path.join(root,"studio"));mock.source=path.join(root,"original.mp4");
 execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","testsrc2=size=160x96:rate=24","-f","lavfi","-i","sine=frequency=440","-t","1","-c:v","libx264","-threads","1","-c:a","aac",mock.source]);
 mock.record={id:"clip",projectId:"story",status:"ready",command:{operation:"video",name:"My clip",prompt:"A quiet scene"}};
});
afterEach(()=>{s.db.close();fs.rmSync(root,{recursive:true,force:true});});
it("imports one reusable owned take and preserves the original without approving or rendering",async()=>{
 const original=fs.readFileSync(mock.source),first=await sendStoryVideoToProduction(s,"alice","story","clip"),again=await sendStoryVideoToProduction(s,"alice","story","clip");
 expect(again).toEqual(first);expect(s.list("alice")).toHaveLength(1);expect(s.assets("alice",first.projectId)).toHaveLength(1);
 const p=s.get("alice",first.projectId),shot=allShots(p)[0];
 expect(shot.takes).toHaveLength(1);expect(shot.takes[0].status).toBe("complete");expect(p.shots[shot.id].approvedTakeId).toBeUndefined();expect(p.workflow?.workspace).toBe("Action");expect(s.jobs("alice",p.id)).toHaveLength(0);
 expect(fs.readFileSync(s.asset("alice",p.id,first.assetId).path)).toEqual(original);expect(fs.readFileSync(mock.source)).toEqual(original);
});
it("rejects another owner and unfinished media",async()=>{
 await expect(sendStoryVideoToProduction(s,"bob","story","clip")).rejects.toThrow("Not found");
 mock.record.status="running";await expect(sendStoryVideoToProduction(s,"alice","story","clip")).rejects.toThrow(/completed/);expect(s.list("alice")).toHaveLength(0);
});
