import fs from "node:fs";
import path from "node:path";
import {runtimePath} from "@/lib/runtime/configPaths";

/** Server-selected runtimes only. PROD reuses the restricted Story Qwen worker. */
export function refVoiceRuntime(engine: string) {
  if (engine !== "qwen3") return null;
  if (process.env.OTG_ENV === "prod" && process.env.OTG_H3_CHARACTER_REFCARDS_ENABLED === "1") {
    const remoteConfig=process.env.OTG_STORY_QWEN_REMOTE_CONFIG;
    if(!remoteConfig||!path.isAbsolute(remoteConfig))return null;
    try {
      const stat=fs.lstatSync(remoteConfig);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077))return null;
      const cfg=JSON.parse(fs.readFileSync(remoteConfig,"utf8")),target=cfg.transports?.rtx3090;
      if(target?.protocol!=="slr-audio-v1"||target.qualified!==true||target.host!=="shawn-rochford@100.75.162.64")return null;
      return {engine,remoteConfig};
    }catch{return null;}
  }
  if(process.env.OTG_ENV!=="test")return null;
  const root = runtimePath("models", "qwen3-tts", "Qwen3-TTS-12Hz-1.7B-VoiceDesign");
  const model = root;
  const python = runtimePath("qwen3-tts-venv", "bin", "python");
  const bridge = path.join(process.cwd(), "scripts", "linux", "qwen3_voice_design_preview.py");
  const required = [python, bridge, path.join(model,"model.safetensors"), path.join(model,"config.json"), path.join(model,"speech_tokenizer","config.json")];
  if (!required.every(file => {try{return fs.statSync(file).isFile();}catch{return false;}})) return null;
  return {engine, root, model, python, bridge,remoteConfig:undefined};
}
