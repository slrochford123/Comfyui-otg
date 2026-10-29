import {afterEach,describe,expect,it,vi} from "vitest";
import {audioTransportReady,audioWorkerScript,audioControllerPython} from "@/lib/audioEditing/transport";
import {execFileSync} from "node:child_process";
import path from "node:path";

afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("host-aware isolated audio execution",()=>{
  it("never executes a writable model interpreter from a root controller",()=>{
    vi.spyOn(process,"getuid").mockReturnValue(0);vi.stubEnv("OTG_ENV","prod");
    expect(audioControllerPython({python:"/operator/model-venv/bin/python"})).toBe("/usr/bin/python3");
    expect(()=>audioWorkerScript({localGpu:"rtx5060ti"},"rtx5060ti")).toThrow("unprivileged");
  });
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
  it("can isolate the local GPU behind its own unprivileged loopback worker",()=>{
    const cfg={localGpu:"rtx5060ti" as const,transports:{rtx5060ti:{protocol:"slr-audio-v1",qualified:true}}};
    expect(audioWorkerScript(cfg,"rtx5060ti","/release")).toBe("/release/scripts/audio-editing-restricted-remote.py");
    cfg.transports.rtx5060ti.qualified=false;expect(audioTransportReady(cfg,"rtx5060ti")).toBe(false);
  });
  it("does not reinterpret a legacy remote field after explicitly selecting the local host",()=>{
    expect(audioTransportReady({localGpu:"rtx5060ti",remote:{qualified:true}},"rtx3090")).toBe(false);
  });
  it("runs gateway containment, command denial, checksum, and supervisor regression tests",()=>{
    expect(()=>execFileSync("python3",[path.join(process.cwd(),"tests/audio_gateway_test.py")],{timeout:30000,stdio:"pipe"})).not.toThrow();
  });
});
