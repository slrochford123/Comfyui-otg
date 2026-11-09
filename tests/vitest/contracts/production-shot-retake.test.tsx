// @vitest-environment jsdom
import React from "react";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import ShotVideo from "@/app/app/components/production-studio/ShotVideo";
const approval=vi.hoisted(()=>({valid:true}));
vi.mock("@/lib/productionStudio/shotDirector",()=>({shotContext:(p:any)=>({shot:p.shot,settings:p.settings})}));
vi.mock("@/lib/productionStudio/shotPolicy",async original=>({...await original<object>(),plannedSeconds:()=>6}));
vi.mock("@/lib/productionStudio/shotDirection",()=>({directionApproved:()=>approval.valid}));
vi.mock("@/lib/productionStudio/clipConfiguration",()=>({startingImageReady:(p:any)=>p.settings.storyboardApproved}));
vi.mock("@/app/app/components/production-studio/ShotJob",()=>({default:()=>null}));
vi.mock("@/app/app/components/production-studio/CinematicAudio",()=>({default:()=>null}));
beforeEach(()=>{vi.stubGlobal("React",React);approval.valid=true;});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
function fixture(count=2){
 const takes=Array.from({length:count},(_,i)=>({id:`take-${i+1}`,assetId:`source-${i+1}`,generationJobId:`job-${i+1}`,version:i+1}));
 const assets=takes.flatMap(t=>[{id:t.assetId,sha256:t.id,metadata:{duration:10,quality:"sh"}},{id:`review-${t.version}`,metadata:{reviewFor:t.assetId,sourceSha256:t.id,plannedDuration:6,duration:6}}]);
 const s={saved:true,project:{id:"project",brief:{aspect:"landscape"},plan:{status:"approved"},settings:{storyboardApproved:true,model:"standard",approvedTakeId:""},shot:{id:"shot-1",shotNumber:1,generationApproach:"image-to-video",takes}},assets,jobs:[],commit:vi.fn(),job:vi.fn()};
 const props={s:s as any,shotId:"shot-1",busy:false,generate:vi.fn(),run:vi.fn(),editPrompt:vi.fn()};
 return {s,props};
}
describe("Shot review Retake",()=>{
 it("places one Retake immediately beside Use This Take and dispatches without approval or deletion",()=>{
  const {s,props}=fixture();const before=structuredClone(s.project);render(<ShotVideo {...props}/>);
  const retake=screen.getByRole("button",{name:"Change with AI",exact:true});
  expect(screen.getByRole("button",{name:"Use This Take",exact:true}).nextElementSibling).toBe(retake);
  expect(screen.queryByRole("button",{name:"Try Again",exact:true})).toBeNull();
  expect(screen.queryByRole("button",{name:"Generate Video",exact:true})).toBeNull();
  fireEvent.click(retake);expect(props.editPrompt).toHaveBeenCalledTimes(1);expect(props.generate).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Retake Same Prompt",exact:true}));expect(props.generate).toHaveBeenCalledExactlyOnceWith("preview",{retakeTakeId:"take-2"});expect(s.commit).not.toHaveBeenCalled();expect(s.project).toEqual(before);
 });
 it("retains the chosen review while pending or failed, selects a new completed take, and preserves earlier takes",()=>{
  const {s,props}=fixture();s.project.settings.approvedTakeId="take-1";
  const view=render(<ShotVideo {...props}/>);fireEvent.change(screen.getByRole("combobox",{name:"Take under review"}),{target:{value:"take-1"}});
  fireEvent.click(screen.getByRole("button",{name:"Retake Same Prompt",exact:true}));
  view.rerender(<ShotVideo {...props} busy/>);expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("take-1");
  view.rerender(<ShotVideo {...props}/>);expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("take-1");
  const next=fixture(3);next.s.project.settings.approvedTakeId="take-1";
  view.rerender(<ShotVideo {...props} s={next.s as any}/>);
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("take-3");expect(screen.getByLabelText("Play Video · Take 3").getAttribute("src")).toContain("review-3");
  expect(next.s.project.shot.takes).toHaveLength(3);expect(next.s.project.settings.approvedTakeId).toBe("take-1");
  fireEvent.click(screen.getByRole("button",{name:"Retake Same Prompt",exact:true}));expect(props.generate).toHaveBeenCalledTimes(2);
 });
 it.each(["busy","unsaved","unapproved","no storyboard"])("prevents submission when %s",reason=>{
  const {s,props}=fixture();if(reason==="busy")props.busy=true;if(reason==="unsaved")s.saved=false;if(reason==="unapproved")approval.valid=false;if(reason==="no storyboard")s.project.settings.storyboardApproved=false;
  render(<ShotVideo {...props}/>);const button=screen.getByRole("button",{name:"Retake Same Prompt",exact:true}) as HTMLButtonElement;expect(button.disabled).toBe(reason==="busy"||reason==="unsaved");fireEvent.click(button);if(reason==="busy"||reason==="unsaved")expect(props.generate).not.toHaveBeenCalled();else expect(props.generate).toHaveBeenCalledWith("preview",{retakeTakeId:"take-2"});expect(props.editPrompt).not.toHaveBeenCalled();
 });
 it("retakes high-quality output using the high-quality generation path",()=>{
  const {s,props}=fixture();s.assets.find(a=>a.id==="source-2")!.metadata.quality="hq";render(<ShotVideo {...props}/>);fireEvent.click(screen.getByRole("button",{name:"Retake Same Prompt",exact:true}));expect(props.generate).toHaveBeenCalledWith("regenerate",{retakeTakeId:"take-2"});
 });
 it("keeps Generate Video for a shot without takes",()=>{const {props}=fixture(0);render(<ShotVideo {...props}/>);expect(screen.queryByRole("button",{name:"Retake Same Prompt",exact:true})).toBeNull();fireEvent.click(screen.getByRole("button",{name:"Generate Video",exact:true}));expect(props.generate).toHaveBeenCalledWith("preview");});
});
