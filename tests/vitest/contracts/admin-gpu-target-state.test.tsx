// @vitest-environment jsdom
import React from "react";
import {cleanup,fireEvent,render,screen,waitFor,act} from "@testing-library/react";
import {afterEach,describe,it,expect,vi} from "vitest";
import AdminGpuControls from "@/app/app/components/AdminGpuControls";

const ready={ok:true,status:{host:"qa-host",gpu:{name:"QA RTX 3090",usedMiB:500,totalMiB:24576},services:{comfy8188:{state:"active",http:"ready"},h38189:{state:"active",http:"ready"}}}};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
async function open(){const details=screen.getByLabelText("Admin GPU controls").closest("details")!;details.open=true;fireEvent(details,new Event("toggle"));}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("Admin maintenance target state",()=>{
 it("ignores a late 3090 status after selecting 5060 Ti",async()=>{
  let resolveOld!:(value:Response)=>void;
  const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{resolveOld=resolve;})).mockResolvedValue(response({ok:false,error:"QA remote agent unavailable"},503));
  vi.stubGlobal("fetch",fetcher);render(<AdminGpuControls/>);await open();
  await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Maintenance target GPU"),{target:{value:"5060ti"}});
  await screen.findByText("QA remote agent unavailable");
  await act(async()=>resolveOld(response(ready)));
  expect(screen.queryByText("GPU: QA RTX 3090")).toBeNull();
  expect((screen.getByRole("button",{name:"Reset ComfyUI"}) as HTMLButtonElement).disabled).toBe(true);
 });
 it("clears stale readiness when a later status request fails",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response(ready)).mockResolvedValue(response({ok:false,error:"QA status unavailable"},503));
  vi.stubGlobal("fetch",fetcher);render(<AdminGpuControls/>);await open();
  await screen.findByText("GPU: QA RTX 3090");
  fireEvent.click(screen.getByRole("button",{name:"Refresh GPU status"}));
  await screen.findByText("QA status unavailable");
  expect(screen.queryByText("Worker reachable; readiness checked · qa-host")).toBeNull();
  expect((screen.getByRole("button",{name:"Free VRAM"}) as HTMLButtonElement).disabled).toBe(true);
 });
});
