import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

describe("media candidate retains the existing TEST audio bootstrap", () => {
  const bootstrap = fs.readFileSync(path.join(process.cwd(), "scripts/audio-editing-release-bootstrap.cjs"), "utf8");
  function environment(mode: string) {
    const env: Record<string, string> = { OTG_ENV: mode };
    vm.runInNewContext(bootstrap, {
      process: { env }, __dirname: "/isolated/release/scripts",
      require: (name: string) => { if (name !== "node:path") throw new Error("Unexpected dependency"); return path; },
    });
    return env;
  }
  it("restores the enabled flag and release-local worker only in TEST", () => {
    expect(environment("test")).toMatchObject({
      OTG_AUDIO_EDITING_ENABLED: "1",
      OTG_AUDIO_ENGINE_CONFIG: "/home/shawn-rochford/AI/runtime/test/unified-audio/engines.json",
      OTG_AUDIO_WORKER_SCRIPT: "/isolated/release/scripts/audio-editing-worker.py",
    });
  });
  it.each(["production", "prod", "development"])("leaves %s configuration unchanged", mode => {
    expect(environment(mode)).toEqual({ OTG_ENV: mode });
  });
  it("preserves explicitly configured isolated host paths and the audio kill switch",()=>{
    const env={OTG_ENV:"test",OTG_AUDIO_EDITING_ENABLED:"0",OTG_AUDIO_ENGINE_CONFIG:"/private/5060/engines.json",OTG_AUDIO_WORKER_SCRIPT:"/private/worker.py"};
    const original={...env};
    vm.runInNewContext(bootstrap,{process:{env},__dirname:"/release/scripts",require:()=>path});
    expect(env).toEqual(original);
  });
  it("packages the bootstrap after copying scripts and before reporting success", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/build-media-gpu-candidate.cjs"), "utf8");
    const copy = source.indexOf("['public','config','comfy_workflows','workflows','lib','scripts']");
    const prefix = source.indexOf("bootstrap=\"require('./scripts/audio-editing-release-bootstrap.cjs');");
    expect(copy).toBeGreaterThan(-1);
    expect(prefix).toBeGreaterThan(copy);
    expect(source.indexOf("if(!original.startsWith(bootstrap))")).toBeGreaterThan(prefix);
    expect(source.indexOf("candidate-final.json")).toBeGreaterThan(prefix);
  });
});
