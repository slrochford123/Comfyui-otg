// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {StoryImagePreview} from "@/app/app/components/storyCreatorV2/StoryPreview";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("opens the original HD source and supports two-finger zoom and reset",()=>{
  vi.stubGlobal("React",React);
  vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  class Pointer extends MouseEvent{pointerId:number;pointerType:string;constructor(type:string,options:any){super(type,options);this.pointerId=options.pointerId;this.pointerType="touch";}}
  vi.stubGlobal("PointerEvent",Pointer);
  render(<StoryImagePreview src="/original.png" alt="Temple" className="w-20"/>);
  fireEvent.click(screen.getByRole("button",{name:"Expand Temple"}));
  const dialog=screen.getByRole("dialog",{name:"Temple"}),image=within(dialog).getByRole("img");
  expect(image).toHaveAttribute("src","/original.png");
  const surface=image.parentElement!;surface.setPointerCapture=vi.fn();
  surface.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:400,bottom:600,width:400,height:600,toJSON:()=>({})});
  fireEvent.pointerDown(surface,{pointerId:1,clientX:100,clientY:200});
  fireEvent.pointerDown(surface,{pointerId:2,clientX:200,clientY:200});
  fireEvent.pointerMove(surface,{pointerId:2,clientX:300,clientY:200});
  expect(image.style.transform).toContain("scale(2)");
  fireEvent.pointerUp(surface,{pointerId:2});fireEvent.pointerMove(surface,{pointerId:1,clientX:140,clientY:200});
  expect(image.style.transform).toContain("140px");
  fireEvent.click(screen.getByRole("button",{name:"Reset image zoom"}));expect(image.style.transform).toContain("scale(1)");
  fireEvent.click(screen.getByRole("button",{name:"Close"}));expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
