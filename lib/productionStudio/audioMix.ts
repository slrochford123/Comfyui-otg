import type { AudioClip, Timeline } from "./model";
import type {AudioPreparation} from "./clipAudio";
export function attachStems(t:Timeline,clipId:string,preparation:AudioPreparation):Timeline{
 const clip=t.clips.find(c=>c.id===clipId);if(!clip||clip.assetId!==preparation.sourceId)throw Error("This preparation belongs to another video take.");
 if(!preparation.stems.speech||!preparation.stems.effects||!preparation.stems.music)throw Error("Separate this soundtrack first.");
 const duration=preparation.samples/preparation.sampleRate;
 const tracks=([['speech','dialogue'],['effects','sfx'],['music','music']] as const).map(([stem,track])=>({id:`${clipId}-${stem}-${preparation.stems[stem]}`,assetId:preparation.stems[stem]!,track,start:preparation.sourceOffset,in:0,out:duration,volume:1,fadeIn:0,fadeOut:0,parentClipId:clipId,sourceAssetId:clip.assetId,label:stem==='effects'?'Effects + ambience':stem==='speech'?'Character dialogue':'Native music',regions:stem==='speech'?preparation.regions:[]} satisfies AudioClip));
 return {...t,clips:t.clips.map(c=>c.id===clipId?{...c,audioMode:'stems'}:c),audio:[...t.audio.filter(a=>a.parentClipId!==clipId),...tracks]};
}

export const AUDIO_TRACKS = ["dialogue", "sfx", "ambience", "music"] as const;
/** Positions follow the same overlapping transitions as the picture renderer. */
export function clipPositions(t: Timeline) {
  let cursor = 0;
  return t.clips.map((clip, i) => {
    if (i && clip.transition !== "cut") cursor -= clip.transitionSeconds;
    const start = cursor;
    cursor += clip.out - clip.in;
    return { clip, start, end: cursor };
  });
}
export function audioPlacement(t: Timeline, c: AudioClip) {
  const parent = c.parentClipId && clipPositions(t).find(v => v.clip.id === c.parentClipId);
  const fullLength = c.loop ? c.length ?? c.out - c.in : c.out - c.in;
  if (!c.parentClipId) return { start: c.start, skip: 0, length: fullLength };
  if (!parent || parent.clip.assetId !== c.sourceAssetId) return null;
  const from = Math.max(c.start, parent.clip.in), to = Math.min(c.start + fullLength, parent.clip.out);
  return to > from ? { start: parent.start + from - parent.clip.in, skip: from - c.start, length: to - from } : null;
}
export function activeAudio(t: Timeline, c: AudioClip) {
  const bus = t.mixTracks?.[c.track], anySolo = t.audio.some(a => a.solo && !a.muted) || AUDIO_TRACKS.some(k => t.mixTracks?.[k]?.solo);
  const parent = c.parentClipId && t.clips.find(v => v.id === c.parentClipId);
  return !c.muted && !c.localMix?.muted && !bus?.muted && (!anySolo || c.solo || bus?.solo) && (!parent || parent.audioMode === "stems" || parent.audioMode === "hybrid");
}
export function nativeVolume(t: Timeline, id: string, original = false) {
  const c = t.clips.find(c => c.id === id)!;
  if (original) return c.volume;
  return c.audioMode === "stems" || t.audio.some(a => a.solo && !a.muted) || AUDIO_TRACKS.some(k => t.mixTracks?.[k]?.solo) ? 0 : c.volume;
}
function number(v: unknown, min: number, max: number) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw Error("Invalid audio mixer value.");
}
export function validateAudioMix(t: Timeline) {
  for (const c of t.clips) {
    if (c.audioMode !== undefined && !["original", "stems", "hybrid"].includes(c.audioMode)) throw Error("Choose original, separated or explicit hybrid audio.");
    if (c.audioMode === "stems" && !t.audio.some(a => a.parentClipId === c.id && a.sourceAssetId === c.assetId)) throw Error("Prepare this clip's stems before selecting separated audio.");
  }
  for (const c of t.audio) {
    if(c.localMix){number(c.localMix.volume,0,4);if(c.localMix.pan!==undefined)number(c.localMix.pan,-1,1);for(const key of ['muted','solo'] as const)if(c.localMix[key]!==undefined&&typeof c.localMix[key]!=="boolean")throw Error("Invalid clip audio switch.");}
    if (c.pan !== undefined) number(c.pan, -1, 1);
    if (c.label !== undefined && (typeof c.label !== "string" || c.label.length > 200)) throw Error("Audio label is too long.");
    if (c.parentClipId && (!t.clips.some(v => v.id === c.parentClipId) || !c.sourceAssetId)) throw Error("Linked audio requires its original timeline clip.");
    if (c.loop) { number(c.length, .01, 86400); number(c.loopCrossfade ?? 0, 0, Math.min(2, (c.out-c.in)/2)); }
    if (c.treatment && !["none", "telephone", "room", "level"].includes(c.treatment)) throw Error("Unsupported audio treatment.");
    for (const key of ["muted", "solo", "loop"] as const) if (c[key] !== undefined && typeof c[key] !== "boolean") throw Error("Invalid audio switch.");
    if (c.regions && (!Array.isArray(c.regions) || c.regions.length > 200)) throw Error("Too many audio regions.");
    let end = -1;
    for (const r of [...c.regions || []].sort((a,b)=>a.start-b.start)) {
      number(r.start, c.in, c.out); number(r.end, r.start+.001, c.out); number(r.gain, 0, 4);
      if (r.start < end) throw Error("Overlapping events remain combined. Use one shared region, not independent overlapping controls.");
      end = r.end;
      if (typeof r.label !== "string" || r.label.length > 200) throw Error("Name the audio region.");
    }
    if (c.keyframes && (!Array.isArray(c.keyframes) || c.keyframes.length > 200)) throw Error("Too many gain keyframes.");
    let last = -1;
    for (const k of c.keyframes || []) { number(k.time, 0, c.loop ? c.length! : c.out-c.in); number(k.gain, 0, 4); if(k.time<=last)throw Error("Gain keyframes must increase in time."); last=k.time; }
  }
  for (const k of Object.keys(t.mixTracks || {})) {
    if (!AUDIO_TRACKS.includes(k as AudioClip["track"])) throw Error("Unknown audio track.");
    const bus = t.mixTracks![k as AudioClip["track"]]!;
    number(bus.volume, 0, 4); if (bus.pan !== undefined) number(bus.pan, -1, 1);
    for(const key of ["muted","solo"] as const)if(bus[key]!==undefined&&typeof bus[key]!=="boolean")throw Error("Invalid track switch.");
  }
}
/** Numeric-only sample envelope: local t is seconds after the source trim. */
export function gainExpression(c: AudioClip, offset = 0) {
  const time = `(t+${offset})`;
  let gain = String(c.volume);
  const keys = c.keyframes || [];
  if (keys.length) {
    let curve = String(keys.at(-1)!.gain);
    for(let i=keys.length-2;i>=0;i--){const a=keys[i],b=keys[i+1];curve=`if(lt(${time},${b.time}),${a.gain}+(${b.gain-a.gain})*(${time}-${a.time})/${b.time-a.time},${curve})`;}
    gain += `*if(lt(${time},${keys[0].time}),${keys[0].gain},${curve})`;
  }
  for(const r of c.regions || []) {
    const start=r.start-c.in,end=r.end-c.in,ramp=Math.min(.025,(end-start)/2);
    gain += `*(1+(${r.gain-1})*min(max((${time}-${start})/${ramp},0),min(max((${end}-${time})/${ramp},0),1)))`;
  }
  return gain;
}
/** Same rendering path for audio-only previews and final picture exports. */
export function audioFilters(t: Timeline, c: AudioClip, input: string, label: string, duration: number) {
  const p=audioPlacement(t,c); if(!p)return null;
  const bus=t.mixTracks?.[c.track],pan=Math.max(-1,Math.min(1,(c.pan||0)+(bus?.pan||0)+(c.localMix?.pan||0))),gain=`(${gainExpression(c,p.skip)})*${bus?.volume ?? 1}*${c.localMix?.volume ?? 1}`;
  const localLength=c.loop ? c.length! : c.out-c.in;
  const treatment = c.treatment === "telephone" ? ",highpass=f=300,lowpass=f=3400" : c.treatment === "room" ? ",aecho=0.8:0.85:17|31:0.10|0.06" : c.treatment === "level" ? ",acompressor=threshold=0.2:ratio=2:attack=20:release=200:makeup=1" : "";
  // 48 kHz sample delays, not millisecond-rounded region positions.
  const fades=(c.fadeIn>0?`,afade=t=in:d=${c.fadeIn}`:"")+(c.fadeOut>0?`,afade=t=out:st=${Math.max(0,localLength-c.fadeOut)}:d=${c.fadeOut}`:"");
  return `${input}aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${localLength},asetpts=PTS-STARTPTS${treatment}${fades},atrim=start=${p.skip}:duration=${p.length},asetpts=PTS-STARTPTS,aeval=exprs='val(0)*(${gain})*${1-Math.max(0,pan)}|val(1)*(${gain})*${1+Math.min(0,pan)}',adelay=${Math.round(p.start*48000)}S:all=1,apad,atrim=duration=${duration}[${label}]`;
}
