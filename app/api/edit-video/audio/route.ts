import fs from "node:fs";
import { mediaGpuRoutingEnabled, requestedMediaGpu } from "@/lib/mediaGpuRoutingServer";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser, SessionInvalidError } from "@/lib/sessionUser";
import { OTG_DATA_ROOT, safeSegment } from "@/lib/paths";
import { resolveFfprobePath, runCmd } from "@/lib/ffmpeg";
import { mediaFileResponse } from "@/lib/mediaResponse";
import { getGallerySourcesForRequest, resolveGalleryItemByName, safeGalleryName, writeMetaForFile } from "@/lib/gallery";
import { productionAudioMediaReadable } from "@/lib/productionAudioAccess";
import { newVoiceId, voicesSamplesDir, upsertVoice, getVoiceById, resolveVoicesFile } from "@/lib/voicesStudio";
import { loadCharacter, listCharacters, createCharacter, updateCharacterVoiceSelection } from "@/lib/characters/store";
import { audioLibrary } from "@/lib/audioEditing/library";
import { createVoiceCharacterAvatar } from "@/lib/audioEditing/characterVoice";
import { createSession, readSession, publicSession, updateSession, sessionRoot, appendAssets,
  assetFile, listSessions, containedFile } from "@/lib/audioEditing/store";
import { assertAudioTestEnabled, capabilities, sessionJobs, startJob, cancelJob } from "@/lib/audioEditing/jobs";
import { aukInstruction, numberWithin, type AudioGpu, type AudioAsset, STEMS } from "@/lib/audioEditing/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const json = (value: unknown, status = 200) => NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store"}});

async function metadata(file: string) {
  const result = await runCmd(resolveFfprobePath(),["-v","error","-show_streams","-show_format","-of","json",file],{timeoutMs:30000});
  if (result.code !== 0) throw Error("The file is not readable audio/video media.");
  const probe = JSON.parse(result.stdout);
  const audio = probe.streams.find((s: {codec_type:string})=>s.codec_type==="audio");
  const video = probe.streams.find((s: {codec_type:string})=>s.codec_type==="video");
  const duration = Number(probe.format?.duration || video?.duration || audio?.duration);
  if (!Number.isFinite(duration)||duration<=0||duration>7200) throw Error("Use a readable clip between 0 and 7200 seconds.");
  return {kind:video?"video":"audio",duration,sampleRate:Number(audio?.sample_rate||0),channels:Number(audio?.channels||0)} as const;
}
async function sha256(file: string) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function importFile(owner: string, id: string, input: string, name: string, origin: string, hints:Pick<AudioAsset,"suggestedLane"|"license">={}) {
  const root = path.join(sessionRoot(owner,id),"inputs");
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const file = path.join(root,`${crypto.randomUUID()}${path.extname(name).toLowerCase() || ".wav"}`);
  await fsp.copyFile(input,file,fs.constants.COPYFILE_EXCL);
  const asset: AudioAsset = {id:crypto.randomUUID(),file,name:name.slice(0,160),origin,...await metadata(file),sha256:await sha256(file),...hints};
  if (asset.kind==="video" && readSession(owner,id).sourceId) throw Error("Create a new session to change the source video; existing edits were retained.");
  const session = appendAssets(owner,id,[asset]);
  if (asset.kind === "video") {
    if (session.sourceId) throw Error("Create a new session to change the source video; existing edits were retained.");
    session.sourceId = asset.id;
    const {saveSession} = await import("@/lib/audioEditing/store");
    saveSession(owner,session);
  }
  return asset;
}
export async function GET(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    assertAudioTestEnabled();
    if (request.nextUrl.searchParams.get("library")==="1") return json({ok:true,items:audioLibrary(user.ownerKey).map(item=>({...item,file:""}))});
    const id = request.nextUrl.searchParams.get("session");
    if (!id) return json({ok:true,sessions:listSessions(user.ownerKey),capabilities:capabilities()});
    const jobs = sessionJobs(user.ownerKey,id);
    const session = readSession(user.ownerKey,id);
    const assetId = request.nextUrl.searchParams.get("asset");
    if (assetId) {
      const file = assetFile(user.ownerKey,session,assetId);
      return mediaFileResponse(request,file,{download:request.nextUrl.searchParams.get("download")==="1",
        cacheControl:"private, no-store",method:request.method==="HEAD"?"HEAD":"GET"});
    }
    return json({ok:true,session:publicSession(session),jobs,capabilities:capabilities()});
  } catch(error) { return failure(error); }
}
export const HEAD = GET;
export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser(request);
    assertAudioTestEnabled();
    const owner = user.ownerKey;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const id = String(form.get("session")||"");
      const session = readSession(owner,id);
      const file = form.get("file");
      if (!(file instanceof File)||file.size<=0||file.size>750*1024*1024) throw Error("Choose a media file up to 750 MB.");
      if (!/\.(mp4|webm|mov|mkv|wav|mp3|flac|ogg|m4a|aac)$/i.test(file.name)) throw Error("Choose a supported audio or video file.");
      if (session.sourceId && /\.(mp4|mov|mkv)$/i.test(file.name)) throw Error("Start a new session to replace the source video.");
      const uploadRoot = path.join(sessionRoot(owner,id),"uploads");
      fs.mkdirSync(uploadRoot,{recursive:true,mode:0o700});
      const upload = path.join(uploadRoot,`${crypto.randomUUID()}${path.extname(file.name).toLowerCase()}`);
      await pipeline(Readable.fromWeb(file.stream() as never),fs.createWriteStream(upload,{flags:"wx",mode:0o600}));
      const asset = await importFile(owner,id,upload,file.name,"upload");
      const job = asset.kind === "video" ? await startJob(owner,id,"import",asset.file,{},"cpu") : null;
      return json({ok:true,session:publicSession(readSession(owner,id)),assetId:asset.id,job});
    }
    const body = await request.json();
    if (body.action === "new") return json({ok:true,session:publicSession(createSession(owner))});
    const id = String(body.sessionId || "");
    const session = readSession(owner,id);
    const params = body.params && typeof body.params==="object" ? body.params : {};
    if (body.action === "update") return json({ok:true,session:publicSession(updateSession(owner,id,body.edit,Number(body.revision)))});
    if (body.action === "cancel") return json({ok:true,job:cancelJob(owner,id,String(body.jobId))});
    if (body.action === "prepare-dialogue") {
      if(!session.sourceId)throw Error("Select a video before opening dialogue replacement.");
      const source=assetFile(owner,session,session.sourceId);
      const root=path.join(OTG_DATA_ROOT,"edit_video_jobs",safeSegment(owner),`audio-handoff-${crypto.randomUUID()}`);
      fs.mkdirSync(root,{recursive:true,mode:0o700});
      const file=path.join(root,`source${path.extname(source)}`);
      await fsp.copyFile(source,file,fs.constants.COPYFILE_EXCL);
      return json({ok:true,source:{path:file,name:session.assets.find(a=>a.id===session.sourceId)?.name||path.basename(file),url:`/api/file?path=${encodeURIComponent(file)}`}});
    }
    if (body.action === "import-gallery") {
      const {sources} = await getGallerySourcesForRequest(request);
      const item = resolveGalleryItemByName({sources,name:String(body.name||""),scopeHint:body.scope||null});
      if (!item) throw Error("That gallery item is not available to this account.");
      const asset = await importFile(owner,id,item.path,item.name,"gallery");
      const job = asset.kind==="video"?await startJob(owner,id,"import",asset.file,{},"cpu"):null;
      return json({ok:true,session:publicSession(readSession(owner,id)),assetId:asset.id,job});
    }
    if (body.action === "import-library") {
      const selected = body.libraryId ? audioLibrary(owner).find(a=>a.id===body.libraryId) : null;
      const input = selected?.file || String(body.path||"");
      if (!selected && !await productionAudioMediaReadable(request,input)) throw Error("Audio is not available to this account.");
      const asset = await importFile(owner,id,input,path.basename(input),"audio-library",{suggestedLane:selected?.suggestedLane,license:selected?.license});
      return json({ok:true,session:publicSession(readSession(owner,id)),assetId:asset.id});
    }
    if (body.action === "save-gallery") {
      const input = assetFile(owner,session,String(body.assetId));
      const asset = session.assets.find(a=>a.id===body.assetId)!;
      if (asset.kind==="audio") {
        const root=path.join(OTG_DATA_ROOT,"edit_video","music",safeSegment(owner),"library");
        fs.mkdirSync(root,{recursive:true});
        const file=path.join(root,`${safeGalleryName(asset.name)||"audio"}-${Date.now()}${path.extname(input)}`);
        await fsp.copyFile(input,file,fs.constants.COPYFILE_EXCL);
        await fsp.writeFile(`${file}.json`,JSON.stringify({title:asset.name,source:"unified-audio-editing",sessionId:id,origin:asset.origin,suggestedLane:asset.suggestedLane,license:asset.license,createdAt:new Date().toISOString()}),{mode:0o600});
        return json({ok:true,saved:true});
      }
      const {sources} = await getGallerySourcesForRequest(request);
      const target = sources[0];
      if (!target) throw Error("Your gallery is not available.");
      const name = `${safeGalleryName(session.title)||"audio-edit"}-${Date.now()}${path.extname(input)}`;
      const file = path.join(target.dir,name);
      fs.mkdirSync(target.dir,{recursive:true});
      await fsp.copyFile(input,file,fs.constants.COPYFILE_EXCL);
      writeMetaForFile(file,{sourceType:"unified-audio-editing",ownerKey:owner,workflowTitle:"Audio Editing",
        audioMix:{sessionId:id,nonDestructive:true},createdAt:Date.now()},target);
      return json({ok:true,url:`/api/gallery/file?name=${encodeURIComponent(name)}&scope=${target.scope}`});
    }
    if (body.action === "save-voice") {
      const input = assetFile(owner,session,String(body.assetId));
      const asset = session.assets.find(a=>a.id===body.assetId)!;
      if (asset.kind!=="audio") throw Error("Choose an isolated speech audio asset first.");
      const existingCharacter=body.characterId ? loadCharacter(owner,String(body.characterId)) : null;
      if(body.characterId&&!existingCharacter)throw Error("Character not found for this account.");
      if(body.newCharacterName&&listCharacters(owner).some(c=>c.name.trim().toLocaleLowerCase()===String(body.newCharacterName).trim().toLocaleLowerCase()))throw Error("That character name already exists. Select the existing character or choose a new name.");
      const voiceId = newVoiceId(owner);
      const name = String(body.name||"Audio Editing Voice").slice(0,100);
      const ext = path.extname(input)||".wav";
      const output = path.join(voicesSamplesDir(voiceId),`reference${ext}`);
      await fsp.copyFile(input,output,fs.constants.COPYFILE_EXCL);
      const now = new Date().toISOString();
      const voice = upsertVoice(owner,{voiceId,name,tags:["reference","audio-editing",asset.origin],type:asset.origin.startsWith("AuK")?"created":"cloned",
        refText:String(body.text||"").slice(0,5000),refAudioRel:path.posix.join("samples",voiceId,`reference${ext}`),createdAt:now,updatedAt:now});
      if (body.characterId || body.newCharacterName) {
        const character = body.newCharacterName ? createCharacter(owner,{name:String(body.newCharacterName).slice(0,100),imagePath:await createVoiceCharacterAvatar(owner),description:"Voice-first character created in Audio Editing. Neutral audio icon; no visual identity supplied.",metadata:{voiceFirst:true,placeholderImage:true},voiceStyleDefinition:String(body.description||""),introLine:String(body.text||"")}) : existingCharacter;
        if (!character) throw Error("Character not found for this account.");
        updateCharacterVoiceSelection(owner,character.id,{referenceAudioPath:output,voiceEngineUsed:"auk-reference",
          metadata:{...character.metadata,audioEditingVoiceId:voiceId}});
      }
      return json({ok:true,voice});
    }
    if (body.action !== "process") throw Error("Unknown audio operation.");
    const gpu: AudioGpu | "auto" = body.gpu === "cpu" ? "cpu" : mediaGpuRoutingEnabled()
      ? await requestedMediaGpu(body.gpu) : ["rtx3090","rtx5060ti","cpu"].includes(body.gpu)?body.gpu:"cpu";
    let source = body.assetId ? assetFile(owner,session,String(body.assetId)) : undefined;
    const operation = String(body.operation);
    if (["import","separate","mix"].includes(operation)) {
      if (!session.sourceId) throw Error("Select a source video first.");
      source = assetFile(owner,session,session.sourceId);
    }
    if (operation === "separate") {
      if(!session.assets.find(a=>a.id===session.sourceId)?.channels)throw Error("This video has no original soundtrack. Use Add or Create to give it audio.");
      if(params.engine && !["tiger","bandit"].includes(String(params.engine)))throw Error("Choose an available separation method.");
      params.engine=params.engine==="bandit"?"bandit":"tiger";
      const selected=params.engine==="bandit"?"BandIt v2 English":"TIGER-DnR";
      if (STEMS.every(s=>session.stems[s])&&session.separation?.engine===selected) return json({ok:true,cached:true,session:publicSession(session)});
      params.cacheKey = `${session.assets.find(a=>a.id===session.sourceId)?.sha256}:${selected}:${params.engine==="bandit"?"d5563d90":"b7a59560"}`;
    }
    if (operation === "speech") {
      const text = String(params.text||"");
      if (params.characterId) {
        const character = loadCharacter(owner,String(params.characterId));
        if (!character?.referenceAudioPath) throw Error("This character has no saved reference voice.");
        const reference = containedFile(OTG_DATA_ROOT,character.referenceAudioPath);
        if(!await productionAudioMediaReadable(request,reference))throw Error("Character voice is not available to this account.");
        source = (await importFile(owner,id,reference,path.basename(reference),"character-reference")).file;
      } else if (params.voiceId) {
        const voice = getVoiceById(owner,String(params.voiceId));
        if (!voice) throw Error("Saved voice not found for this account.");
        const reference = containedFile(OTG_DATA_ROOT,resolveVoicesFile(voice.refAudioRel));
        if(!await productionAudioMediaReadable(request,reference))throw Error("Saved voice is not available to this account.");
        source = (await importFile(owner,id,reference,path.basename(reference),"voice-reference")).file;
      }
      params.instruction = aukInstruction(text,String(params.description||"Natural, clear adult voice"),!!source,String(params.expression||""));
      params.seconds = numberWithin(params.seconds,Math.max(2,text.split(/\s+/).length/2.6),.5,gpu==="rtx5060ti"?5:8);
      params.seed = Math.floor(numberWithin(params.seed,42,0,2147483647));
      params.variant = params.variant==="base"?"base":"flash";
    }
    if (operation === "enhance" || operation === "extract") {
      if (!source) throw Error("Choose an audio track or asset.");
      params.strength = numberWithin(params.strength,.5,0,1);
      params.start = numberWithin(params.start,0,0,7200);
      params.length = numberWithin(params.length,10,.1,7200);
      params.engine = params.engine === "mossformer" ? "mossformer" : "ffmpeg";
      params.sourceAssetId=String(body.assetId||"");
    }
    if (operation === "music") {
      params.prompt = String(params.prompt||"").trim().slice(0,2000);
      if (!params.prompt) throw Error("Describe the background music you want.");
      params.seconds = numberWithin(params.seconds,30,10,600);
      params.seed = Math.floor(numberWithin(params.seed,42,0,2147483647));
    }
    if (operation === "effects") {
      params.mode = params.mode==="manual"?"manual":"automatic";
      params.prompt = String(params.prompt||"").trim().slice(0,2000);
      params.start = numberWithin(params.start,0,0,7200);
      params.seed = Math.floor(numberWithin(params.seed,42,0,2147483647));
      if (params.mode==="automatic") {
        if (!session.sourceId) throw Error("Choose a video for automatic sound-effect generation.");
        const video=session.assets.find(a=>a.id===session.sourceId)!;
        source=assetFile(owner,session,session.sourceId);
        params.start=Math.min(Number(params.start),Math.max(0,video.duration-.1));
        params.seconds=numberWithin(params.seconds,video.duration-Number(params.start),.1,video.duration-Number(params.start));
        params.prompt ||= "Natural realistic sound effects and ambience synchronized with the visible actions. No speech, no music.";
      } else {
        if (!params.prompt) throw Error("Describe the sound effect you want.");
        source=undefined;
        params.seconds=numberWithin(params.seconds,5,.1,600);
      }
    }
    if (!["import","separate","mix","enhance","speech","extract","music","effects"].includes(operation)) throw Error("Unsupported audio operation.");
    const job = await startJob(owner,id,operation as Parameters<typeof startJob>[2],source,params,
      (["separate","speech","music","effects"].includes(operation)||operation==="enhance"&&params.engine==="mossformer")?gpu:"cpu");
    return json({ok:true,job});
  } catch(error) { return failure(error); }
}
function failure(error: unknown) {
  if (error instanceof SessionInvalidError) return json({ok:false,error:"Sign in to use Audio Editing."},401);
  const message = error instanceof Error ? error.message : "Audio operation failed.";
  return json({ok:false,error:message},/not found|not available to this account/.test(message)?404:/another tab|busy|active or queued|starting an operation|active operation/.test(message)?409:400);
}
