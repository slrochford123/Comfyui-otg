import fs from "node:fs";
import {describe,it,expect} from "vitest";
const graph=JSON.parse(fs.readFileSync("comfy_workflows/internal/edit-video/video_wan21_scail2_character_replacement.api.json","utf8"));
describe("SCAIL runtime segment inputs",()=>{
  it("binds every arithmetic variable for both 81-frame segments with 5-frame overlap",()=>{
    for(const id of ["213:184","262:241"]){
      expect(graph[id].inputs).toMatchObject({"values.b":81,"values.c":5});
    }
    expect((81-5)*(graph["213:183"].inputs.value-1)).toBe(0);
    expect((81-5)*(graph["262:240"].inputs.value-1)).toBe(76);
  });
  it("preserves source geometry instead of stretching portrait input to landscape",()=>{
    for(const id of ["213:178","262:236"]) expect(graph[id].inputs.value).toEqual(["263",0]);
    for(const id of ["213:179","262:237"]) expect(graph[id].inputs.value).toEqual(["263",1]);
  });
});
