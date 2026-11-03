// @vitest-environment jsdom
import React from "react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import OrderedImageInputs from "@/app/app/components/OrderedImageInputs";
const photo=(name:string)=>new File([name],name+".png",{type:"image/png"});
beforeEach(()=>{URL.createObjectURL=vi.fn(()=>"blob:test");URL.revokeObjectURL=vi.fn();});
afterEach(cleanup);
describe("Ordered batch image selection",()=>{
  it("appends all selected images in picker order",()=>{
    const onChange=vi.fn(),original=photo("original"),b=photo("b"),a=photo("a");
    render(<OrderedImageInputs files={[original]} maximum={4} onChange={onChange}/>);
    const input=screen.getByLabelText("Add edit images") as HTMLInputElement;expect(input.multiple).toBe(true);expect(input.dataset.maxFiles).toBe("3");
    fireEvent.change(input,{target:{files:[b,a]}});expect(onChange).toHaveBeenCalledWith([original,b,a]);
  });
  it("rejects the entire over-limit selection without silently truncating",()=>{
    const onChange=vi.fn();render(<OrderedImageInputs files={[photo("original")]} maximum={2} onChange={onChange}/>);
    fireEvent.change(screen.getByLabelText("Add edit images"),{target:{files:[photo("b"),photo("c")]}});
    expect(onChange).not.toHaveBeenCalled();expect(screen.getByRole("alert").textContent).toContain("Nothing was discarded");
  });
  it("numbers thumbnails, allows changing the base image, and removes just one input",()=>{
    const onChange=vi.fn(),a=photo("a"),b=photo("b");render(<OrderedImageInputs files={[a,b]} maximum={16} onChange={onChange}/>);
    expect(screen.getByAltText("Image 1: a.png")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Move image 2 earlier"}));expect(onChange).toHaveBeenLastCalledWith([b,a]);
    fireEvent.click(screen.getByRole("button",{name:"Remove image 1"}));expect(onChange).toHaveBeenLastCalledWith([b]);
  });
});
