// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import H3SavedUploads from "@/app/app/components/H3SavedUploads";
beforeEach(()=>{vi.stubGlobal("React",React);vi.stubGlobal("URL",{createObjectURL:vi.fn(()=>"blob:thumb"),revokeObjectURL:vi.fn()});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("shows a thumbnail and separate Add back / Remove touch controls",()=>{
  const add=vi.fn(),remove=vi.fn();render(<H3SavedUploads items={[{id:"one",name:"boat.png",kind:"image",url:"/api/h3/nsfw/assets?id=one&thumbnail=1"}]} canAdd={()=>true} onAdd={add} onRemove={remove}/>);
  fireEvent.click(screen.getByText("Saved uploads · 1"));
  expect(screen.getByAltText("Preview of boat.png")).toHaveAttribute("loading","lazy");
  fireEvent.click(screen.getByRole("button",{name:"Add back boat.png"}));expect(add).toHaveBeenCalledWith("one");
  fireEvent.click(screen.getByRole("button",{name:"Remove saved upload boat.png"}));expect(remove).toHaveBeenCalledWith("one");
});
it("keeps Remove available when the render is full and revokes device preview URLs",()=>{
  const view=render(<H3SavedUploads items={[{id:"one",name:"boat.png",kind:"image",file:new File(["image"],"boat.png")}]} canAdd={()=>false} onAdd={()=>{}} onRemove={()=>{}}/>);
  fireEvent.click(screen.getByText("Saved uploads · 1"));expect(screen.getByRole("button",{name:"Add back boat.png"})).toBeDisabled();expect(screen.getByRole("button",{name:"Remove saved upload boat.png"})).toBeEnabled();
  view.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:thumb");
});
