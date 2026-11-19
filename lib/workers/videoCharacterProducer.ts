import {characterDevelopmentEnabled} from "@/lib/h3CharacterDevelopmentAvailability";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ComfyMediaPayload, MediaQueueJob } from "./mediaGpuQueue";
import {EXTRACTION_WORKERS} from "@/lib/videoCharacters/routingContract";

type State = "active" | "terminal" | "unavailable";
type Output = { job?: string; gpu?: string; baseUrl?: string; state?: string; master?: boolean };

/** Verify the durable parent before admission and again immediately before POST. */
export function videoCharacterProducerState(job: MediaQueueJob, dataRoot: string, environment: string | undefined): State {
  const payload = job.payload as ComfyMediaPayload, producer = payload.producer;
  if (producer?.kind !== "video-character" || !characterDevelopmentEnabled(environment) || !["rtx3090", "rtx5060ti", "rtx3060"].includes(job.gpu)) return "unavailable";
  if (!/^[a-f0-9-]{36}$/.test(producer.id) || !["video-character-qwen21", "video-character-refmod", "video-character-master"].includes(payload.workerId)) return "unavailable";
  const ownerHash = createHash("sha256").update(producer.ownerKey).digest("hex").slice(0, 24);
  try {
    const directory = path.join(dataRoot, "video-characters", ownerHash, producer.id);
    const workspace = JSON.parse(fs.readFileSync(path.join(directory, "workspace.json"), "utf8"));
    if (workspace.owner !== producer.ownerKey || workspace.id !== producer.id) return "unavailable";
    const outputs: Output[] = workspace.candidates.flatMap((candidate: {views: Output[]; bundle?: Output}) => [...candidate.views, ...(candidate.bundle ? [candidate.bundle] : [])]);
    const parent = outputs.find(output => output.job === job.id);
    if (!parent || parent.gpu !== job.gpu || parent.baseUrl !== payload.baseUrl || payload.body.client_id !== job.id) return "unavailable";
    if(job.gpu==="rtx3090"){
      // Only exact saved Qwen image requests are qualified on this new lane.
      // RefMod encodes, portrait upscales and arbitrary graphs stay excluded.
      if(payload.workerId!=="video-character-qwen21"||parent.master||payload.baseUrl!==EXTRACTION_WORKERS.rtx3090||payload.body.prompt_id!==job.id||!/^[a-f0-9-]{36}$/.test(job.id))return "unavailable";
      const graph=JSON.parse(fs.readFileSync(path.join(directory,job.id+".workflow.json"),"utf8"));
      if(!isDeepStrictEqual(graph,payload.body.prompt)||graph["474"]?.class_type!=="TextEncodeQwenImage21")return "unavailable";
    }
    if (payload.workerId === "video-character-master") {
      // A portrait master is the saved SeedVR2 request, never a Qwen view or an arbitrary graph.
      if (!parent.master || job.gpu !== "rtx5060ti" || payload.baseUrl !== "http://100.98.212.116:8188"
        || !/^[a-f0-9-]{36}$/.test(job.id) || payload.body.prompt_id !== job.id) return "unavailable";
      const graph = JSON.parse(fs.readFileSync(path.join(directory, job.id + ".workflow.json"), "utf8"));
      if (!isDeepStrictEqual(graph, payload.body.prompt)) return "unavailable";
    } else if (parent.master) return "unavailable";
    return ["queued", "dispatching", "running"].includes(parent.state || "") ? "active" : "terminal";
  } catch { return "unavailable"; }
}
