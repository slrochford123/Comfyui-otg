import {describe,it,expect} from "vitest";
import {scailSourceObjectIndex,scailFramePlan} from "@/lib/scailRuntime";
describe("SCAIL identity and timebase",()=>{
 it("does not mistake a single center/right subject for a nonexistent second/third person",()=>{
   expect(scailSourceObjectIndex("single adult man in the center")).toBe("0");
   expect(scailSourceObjectIndex("the person in a red coat on the right")).toBe("0");
   expect(scailSourceObjectIndex("second person")).toBe("1");
   expect(scailSourceObjectIndex("third person")).toBe("2");
 });
 it("pads conditioning to 4n+1 without dropping the final three real frames",()=>{
   expect(scailFramePlan(5)).toEqual({fps:24,outputFrames:120,conditioningFrames:121});
 });
});
