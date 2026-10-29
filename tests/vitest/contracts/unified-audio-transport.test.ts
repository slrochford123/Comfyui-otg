import {afterEach,describe,expect,it,vi} from "vitest";
import {audioTransportReady,audioWorkerScript} from "@/lib/audioEditing/transport";
import {execFileSync} from "node:child_process";
import path from "node:path";

afterEach(()=>vi.unstubAllEnvs());
describe("host-aware isolated audio execution",()=>{
  it("preserves the existing TEST configuration and legacy remote adapter",()=>{
    const cfg={remote:{qualified:true}};
    expect(audioTransportReady(cfg,"rtx3090")).toBe(true);
    expect(audioWorkerScript(cfg,"rtx5060ti","/release")).toBe("/release/scripts/audio-editing-remote.py");
  });
  it("executes the 5060 locally when the app runs on SLR",()=>{
    const cfg={localGpu:"rtx5060ti" as const};
    expect(audioWorkerScript(cfg,"rtx5060ti","/release")).toBe("/release/scripts/audio-editing-worker.py");
    expect(audioWorkerScript(cfg,"cpu","/release")).toBe("/release/scripts/audio-editing-worker.py");
    expect(()=>audioWorkerScript(cfg,"rtx3090")).toThrow("not qualified");
  });
  it("uses only the qualified restricted adapter to reach the 3090 from SLR",()=>{
    const cfg={localGpu:"rtx5060ti" as const,transports:{rtx3090:{protocol:"slr-audio-v1",qualified:true}}};
    expect(audioWorkerScript(cfg,"rtx3090","/release")).toBe("/release/scripts/audio-editing-restricted-remote.py");
    cfg.transports.rtx3090.qualified=false;
    expect(audioTransportReady(cfg,"rtx3090")).toBe(false);
  });
  it("does not reinterpret a legacy remote field after explicitly selecting the local host",()=>{
    expect(audioTransportReady({localGpu:"rtx5060ti",remote:{qualified:true}},"rtx3090")).toBe(false);
  });
  it("runs gateway containment, command denial, checksum, and supervisor regression tests",()=>{
    expect(()=>execFileSync("python3",[path.join(process.cwd(),"tests/audio_gateway_test.py")],{timeout:30000,stdio:"pipe"})).not.toThrow();
  });
});
