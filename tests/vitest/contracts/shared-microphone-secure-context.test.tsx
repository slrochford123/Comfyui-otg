// @vitest-environment jsdom
import React from "react";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,describe,it,expect,vi} from "vitest";
import SpeechInputButton from "@/app/app/components/SpeechInputButton";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("Shared microphone origin truthfulness",()=>{
 it("labels insecure HTTP accurately and explains HTTPS without attempting capture",()=>{
  vi.stubGlobal("isSecureContext",false);const status=vi.fn(),capture=vi.fn();
  vi.stubGlobal("navigator",{mediaDevices:{getUserMedia:capture}});
  render(<SpeechInputButton label="Story microphone" onTranscript={()=>{}} onStatus={status}/>);
  fireEvent.click(screen.getByRole("button",{name:"Microphone requires HTTPS"}));
  expect(capture).not.toHaveBeenCalled();expect(status).toHaveBeenCalledWith(expect.stringContaining("requires HTTPS"));
  expect(screen.getByText("Mic · HTTPS required")).toBeTruthy();
 });
 it("does not advertise an HTTPS restriction on a secure origin",()=>{
  vi.stubGlobal("isSecureContext",true);render(<SpeechInputButton label="Story microphone" onTranscript={()=>{}}/>);
  expect(screen.getByRole("button",{name:"Story microphone"})).toBeTruthy();
  expect(screen.queryByText("Mic · HTTPS required")).toBeNull();
 });
});
