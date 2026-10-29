import path from "node:path";
import type { AudioGpu } from "./contracts";

/** Trusted engine configuration; never accept host/SSH options from HTTP. */
export type AudioRuntimeConfig = {
  localGpu?: Exclude<AudioGpu,"cpu">;
  remote?: { qualified?: boolean };
  transports?: Partial<Record<Exclude<AudioGpu,"cpu">,{protocol?:string;qualified?:boolean}>>;
};
export function audioTransportReady(config:AudioRuntimeConfig,gpu:AudioGpu) {
  if(gpu==="cpu"||gpu===(config.localGpu||"rtx3090"))return true;
  if(config.transports?.[gpu]?.protocol==="slr-audio-v1")return config.transports[gpu]?.qualified===true;
  return !config.localGpu && gpu==="rtx5060ti" && config.remote?.qualified===true;
}
export function audioWorkerScript(config:AudioRuntimeConfig,gpu:AudioGpu,cwd=process.cwd()) {
  if(!audioTransportReady(config,gpu))throw Error("The selected GPU audio connection is not qualified; existing workloads remain untouched.");
  if(gpu==="cpu"||gpu===(config.localGpu||"rtx3090"))
    return process.env.OTG_AUDIO_WORKER_SCRIPT||path.join(cwd,"scripts/audio-editing-worker.py");
  return path.join(cwd,"scripts",config.transports?.[gpu]?.protocol==="slr-audio-v1"
    ?"audio-editing-restricted-remote.py":"audio-editing-remote.py");
}
